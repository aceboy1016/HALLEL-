#!/usr/bin/env python3
"""
HALLEL予約システム - Gmail連携スクリプト
メール数過多対策版
"""

import os
import re
import json
import base64
import requests
from datetime import datetime, timedelta
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# 設定
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
FLASK_API_URL = 'http://localhost:5001/api/process_email'

# メール数過多対策の設定
MAX_EMAILS_PER_RUN = 50  # 一度に処理する最大メール数
DAYS_TO_SEARCH = 7  # 過去何日分のメールを対象にするか
SEARCH_KEYWORDS = ['予約', 'キャンセル', 'HALLEL', '渋谷店']  # 検索キーワード

def get_gmail_service():
    """Gmail APIサービスを取得"""
    creds = None

    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            from google_auth_oauthlib.flow import InstalledAppFlow
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)

        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return build('gmail', 'v1', credentials=creds)

def build_search_query():
    """
    メール検索クエリを構築（メール数過多対策）
    - 未読メールのみ
    - 過去N日間のみ
    - 特定キーワードを含む
    """
    date_limit = (datetime.now() - timedelta(days=DAYS_TO_SEARCH)).strftime('%Y/%m/%d')

    # キーワードをOR条件で結合
    keyword_query = ' OR '.join([f'subject:{kw}' for kw in SEARCH_KEYWORDS])

    # 最終的なクエリ
    query = f'is:unread after:{date_limit} ({keyword_query})'

    return query

def parse_email_body(body):
    """
    メール本文から予約情報を抽出

    想定フォーマット:
    予約: 2025-08-05 14:00-15:30
    キャンセル: 2025-08-05 14:00
    """
    result = {
        'action_type': None,
        'date': None,
        'start_time': None,
        'end_time': None
    }

    # 予約パターン
    booking_pattern = r'予約[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})'
    booking_match = re.search(booking_pattern, body)

    if booking_match:
        result['action_type'] = 'booking'
        result['date'] = booking_match.group(1)
        result['start_time'] = booking_match.group(2).zfill(5)  # HH:MM形式に
        result['end_time'] = booking_match.group(3).zfill(5)
        return result

    # キャンセルパターン
    cancel_pattern = r'キャンセル[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})'
    cancel_match = re.search(cancel_pattern, body)

    if cancel_match:
        result['action_type'] = 'cancellation'
        result['date'] = cancel_match.group(1)
        result['start_time'] = cancel_match.group(2).zfill(5)
        return result

    return None

def get_email_body(service, message_id):
    """メール本文を取得"""
    try:
        message = service.users().messages().get(
            userId='me',
            id=message_id,
            format='full'
        ).execute()

        # ペイロードから本文を抽出
        payload = message.get('payload', {})
        body_data = None

        # マルチパート形式の場合
        if 'parts' in payload:
            for part in payload['parts']:
                if part['mimeType'] == 'text/plain':
                    body_data = part['body'].get('data')
                    break
        else:
            # シンプルな形式の場合
            body_data = payload.get('body', {}).get('data')

        if body_data:
            return base64.urlsafe_b64decode(body_data).decode('utf-8')

        return ''

    except Exception as e:
        print(f"Error getting email body: {e}")
        return ''

def mark_as_read(service, message_id):
    """メールを既読にする（ラベル付けはしない）"""
    try:
        service.users().messages().modify(
            userId='me',
            id=message_id,
            body={'removeLabelIds': ['UNREAD']}
        ).execute()
        return True
    except Exception as e:
        print(f"Error marking as read: {e}")
        return False

def send_to_flask_api(booking_data):
    """Flask APIに予約データを送信"""
    try:
        response = requests.post(
            FLASK_API_URL,
            json=booking_data,
            timeout=10
        )
        response.raise_for_status()
        return True, response.json()
    except Exception as e:
        print(f"Error sending to Flask API: {e}")
        return False, str(e)

def process_emails():
    """メールを処理するメイン関数"""
    print("=" * 60)
    print("HALLEL Gmail連携 - 予約同期開始")
    print("=" * 60)

    service = get_gmail_service()
    query = build_search_query()

    print(f"検索クエリ: {query}")
    print(f"最大処理件数: {MAX_EMAILS_PER_RUN}")
    print("-" * 60)

    try:
        # メール検索（件数制限付き）
        results = service.users().messages().list(
            userId='me',
            q=query,
            maxResults=MAX_EMAILS_PER_RUN
        ).execute()

        messages = results.get('messages', [])

        if not messages:
            print("処理対象のメールはありません。")
            return

        print(f"処理対象メール数: {len(messages)}件")
        print("-" * 60)

        success_count = 0
        error_count = 0
        skipped_count = 0

        for i, message in enumerate(messages, 1):
            message_id = message['id']
            print(f"\n[{i}/{len(messages)}] メールID: {message_id}")

            # メール本文を取得
            body = get_email_body(service, message_id)

            # 予約情報を抽出
            booking_info = parse_email_body(body)

            if booking_info:
                print(f"  アクション: {booking_info['action_type']}")
                print(f"  日付: {booking_info['date']}")
                print(f"  開始: {booking_info['start_time']}")
                if booking_info['end_time']:
                    print(f"  終了: {booking_info['end_time']}")

                # Flask APIに送信
                success, response = send_to_flask_api(booking_info)

                if success:
                    print(f"  ✓ APIに送信成功: {response}")
                    # 既読マークを付ける
                    mark_as_read(service, message_id)
                    success_count += 1
                else:
                    print(f"  ✗ APIエラー: {response}")
                    error_count += 1
            else:
                print(f"  - 予約情報が見つかりません（スキップ）")
                # 予約情報がないメールも既読にする（再処理を防ぐ）
                mark_as_read(service, message_id)
                skipped_count += 1

        print("\n" + "=" * 60)
        print("処理完了")
        print(f"成功: {success_count}件 / エラー: {error_count}件 / スキップ: {skipped_count}件")
        print("=" * 60)

    except HttpError as error:
        print(f"Gmail API エラー: {error}")
    except Exception as e:
        print(f"予期しないエラー: {e}")

if __name__ == '__main__':
    process_emails()

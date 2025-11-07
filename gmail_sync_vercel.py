#!/usr/bin/env python3
"""
HALLEL予約システム - Gmail連携（Vercel対応版）
既存のGASシステムと同じ仕様でPythonから実行
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

# 設定（GASと同じ）
CONFIG = {
    'WEBHOOK_URL': 'https://hallelshibuyabooking.vercel.app/api/gas/webhook',
    'SEARCH_QUERY': 'from:noreply@em.hacomono.jp subject:hallel',
    'SCOPES': ['https://www.googleapis.com/auth/gmail.modify'],
    'MAX_EMAILS_PER_RUN': 50,
    'DAYS_TO_SEARCH': 7,
    'LABELS': {
        'PROCESSED': 'HALLEL/Processed',
        'BOOKING': 'HALLEL/Booking',
        'CANCELLATION': 'HALLEL/Cancellation',
        'SHIBUYA': 'HALLEL/Shibuya',
        'YOYOGI_UEHARA': 'HALLEL/YoyogiUehara',
        'NAKAMEGURO': 'HALLEL/Nakameguro',
        'EBISU': 'HALLEL/Ebisu',
        'HANZOMON': 'HALLEL/Hanzomon'
    }
}

def get_gmail_service():
    """Gmail APIサービスを取得"""
    creds = None

    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', CONFIG['SCOPES'])

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists('credentials.json'):
                print("❌ credentials.json が見つかりません")
                print("\n📝 セットアップ手順:")
                print("1. Google Cloud Console で Gmail API を有効化")
                print("2. OAuth認証情報を作成")
                print("3. credentials.json をダウンロード")
                return None

            from google_auth_oauthlib.flow import InstalledAppFlow
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', CONFIG['SCOPES'])
            creds = flow.run_local_server(port=0)

        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return build('gmail', 'v1', credentials=creds)

def setup_labels(service):
    """ラベルをセットアップ（GASと同じ）"""
    print("\n🏷️  ラベルセットアップ...")

    for label_key, label_name in CONFIG['LABELS'].items():
        try:
            # 既存ラベルをチェック
            results = service.users().labels().list(userId='me').execute()
            labels = results.get('labels', [])

            label_exists = False
            for label in labels:
                if label['name'] == label_name:
                    print(f"  ✓ ラベル既存: {label_name}")
                    label_exists = True
                    break

            if not label_exists:
                # ラベル作成
                label_object = {
                    'name': label_name,
                    'labelListVisibility': 'labelShow',
                    'messageListVisibility': 'show'
                }
                service.users().labels().create(userId='me', body=label_object).execute()
                print(f"  ✅ ラベル作成: {label_name}")

        except Exception as e:
            print(f"  ❌ ラベルエラー ({label_name}): {e}")

def detect_store(body):
    """店舗を判定（GASと同じロジック）"""
    body_lower = body.lower()

    # 日本語店舗名で検索（優先）
    if '代々木上原' in body:
        return 'yoyogi-uehara'
    elif '中目黒' in body:
        return 'nakameguro'
    elif '恵比寿' in body:
        return 'ebisu'
    elif '半蔵門' in body:
        return 'hanzomon'
    elif '渋谷' in body:
        return 'shibuya'
    # 英語店舗名
    elif 'yoyogi' in body_lower:
        return 'yoyogi-uehara'
    elif 'nakameguro' in body_lower:
        return 'nakameguro'
    elif 'ebisu' in body_lower:
        return 'ebisu'
    elif 'hanzomon' in body_lower:
        return 'hanzomon'
    elif 'shibuya' in body_lower:
        return 'shibuya'

    return None

def parse_email_message(service, message_id, subject):
    """メールをパース（GASと同じロジック）"""
    try:
        # メール本文を取得
        message = service.users().messages().get(
            userId='me',
            id=message_id,
            format='full'
        ).execute()

        # 本文抽出
        payload = message.get('payload', {})
        body_data = None

        if 'parts' in payload:
            for part in payload['parts']:
                if part['mimeType'] == 'text/plain':
                    body_data = part['body'].get('data')
                    break
        else:
            body_data = payload.get('body', {}).get('data')

        if not body_data:
            return None

        body = base64.urlsafe_b64decode(body_data).decode('utf-8')

        # 店舗判定
        store = detect_store(body)
        if not store:
            return None

        # キャンセルチェック
        is_cancellation = 'キャンセル' in subject or 'cancel' in subject.lower()

        # 日付抽出: 2024年11月7日
        date_match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', body)
        if not date_match:
            return None

        year, month, day = date_match.groups()
        date = f"{year}-{month.zfill(2)}-{day.zfill(2)}"

        # 時間抽出: 14:00 〜 15:30
        time_match = re.search(r'(\d{1,2}):(\d{2})\s*[〜～~-]\s*(\d{1,2}):(\d{2})', body)
        if not time_match:
            return None

        start_h, start_m, end_h, end_m = time_match.groups()
        start = f"{start_h.zfill(2)}:{start_m}"
        end = f"{end_h.zfill(2)}:{end_m}"

        # 顧客名抽出
        customer_match = re.search(r'^([^\n\r]+)\s*様', body, re.MULTILINE)
        customer_name = customer_match.group(1).strip() if customer_match else 'N/A'

        # メール日付
        internal_date = int(message.get('internalDate', 0)) / 1000
        email_date = datetime.fromtimestamp(internal_date).isoformat()

        return {
            'date': date,
            'start': start,
            'end': end,
            'customer_name': customer_name,
            'store': store,
            'type': 'gmail',
            'is_cancellation': is_cancellation,
            'source': 'python_sync',
            'email_id': message_id,
            'email_subject': subject,
            'email_date': email_date
        }

    except Exception as e:
        print(f"  ❌ パースエラー: {e}")
        return None

def apply_labels(service, message_id, is_cancellation, store):
    """ラベルを適用（GASと同じ）"""
    try:
        store_labels = {
            'shibuya': CONFIG['LABELS']['SHIBUYA'],
            'yoyogi-uehara': CONFIG['LABELS']['YOYOGI_UEHARA'],
            'nakameguro': CONFIG['LABELS']['NAKAMEGURO'],
            'ebisu': CONFIG['LABELS']['EBISU'],
            'hanzomon': CONFIG['LABELS']['HANZOMON']
        }

        labels_to_apply = [
            CONFIG['LABELS']['PROCESSED'],
            store_labels.get(store, CONFIG['LABELS']['SHIBUYA'])
        ]

        if is_cancellation:
            labels_to_apply.append(CONFIG['LABELS']['CANCELLATION'])
        else:
            labels_to_apply.append(CONFIG['LABELS']['BOOKING'])

        # ラベルIDを取得
        results = service.users().labels().list(userId='me').execute()
        all_labels = results.get('labels', [])

        label_ids = []
        for label_name in labels_to_apply:
            for label in all_labels:
                if label['name'] == label_name:
                    label_ids.append(label['id'])
                    break

        # ラベルを適用
        if label_ids:
            service.users().messages().modify(
                userId='me',
                id=message_id,
                body={'addLabelIds': label_ids}
            ).execute()

            print(f"  🏷️  ラベル適用: {', '.join([l.split('/')[-1] for l in labels_to_apply])}")

    except Exception as e:
        print(f"  ❌ ラベル適用エラー: {e}")

def send_to_vercel(reservations):
    """Vercelに送信（GASと同じ）"""
    try:
        payload = {
            'source': 'python',
            'timestamp': datetime.now().isoformat(),
            'reservations': reservations
        }

        headers = {
            'Content-Type': 'application/json',
            'X-GAS-Secret': 'hallel_gas_2024'
        }

        response = requests.post(
            CONFIG['WEBHOOK_URL'],
            json=payload,
            headers=headers,
            timeout=30
        )

        if response.status_code == 200:
            print(f"\n✅ Vercel送信成功: {len(reservations)}件")
            return True
        else:
            print(f"\n❌ Vercel送信失敗: HTTP {response.status_code}")
            print(f"   レスポンス: {response.text}")
            return False

    except Exception as e:
        print(f"\n❌ Vercel送信エラー: {e}")
        return False

def sync_gmail_reservations():
    """メイン処理"""
    print("=" * 70)
    print("📧 HALLEL Gmail予約同期（Vercel対応版）")
    print("=" * 70)

    service = get_gmail_service()
    if not service:
        return

    # ラベルセットアップ
    setup_labels(service)

    # メール検索
    print(f"\n🔍 メール検索中...")
    print(f"   クエリ: {CONFIG['SEARCH_QUERY']}")

    try:
        # 過去7日間のメールを検索
        date_limit = (datetime.now() - timedelta(days=CONFIG['DAYS_TO_SEARCH'])).strftime('%Y/%m/%d')
        query = f"{CONFIG['SEARCH_QUERY']} after:{date_limit}"

        results = service.users().messages().list(
            userId='me',
            q=query,
            maxResults=CONFIG['MAX_EMAILS_PER_RUN']
        ).execute()

        messages = results.get('messages', [])

        if not messages:
            print("   📭 対象メールなし")
            return

        print(f"   📧 {len(messages)}件のメールを発見\n")

        reservations = []
        processed_count = 0

        for i, msg in enumerate(messages, 1):
            msg_id = msg['id']

            # メッセージの詳細を取得（件名用）
            msg_detail = service.users().messages().get(
                userId='me',
                id=msg_id,
                format='metadata',
                metadataHeaders=['Subject']
            ).execute()

            subject = ''
            for header in msg_detail.get('payload', {}).get('headers', []):
                if header['name'] == 'Subject':
                    subject = header['value']
                    break

            print(f"[{i}/{len(messages)}] 処理中...")
            print(f"  件名: {subject}")

            # パース
            reservation = parse_email_message(service, msg_id, subject)

            if reservation:
                reservations.append(reservation)

                # ラベル適用
                apply_labels(service, msg_id, reservation['is_cancellation'], reservation['store'])

                action = "キャンセル" if reservation['is_cancellation'] else "予約"
                print(f"  ✅ {action}: [{reservation['store']}] {reservation['date']} {reservation['start']}-{reservation['end']} {reservation['customer_name']}")
                processed_count += 1
            else:
                print(f"  ⏭️  スキップ（対象外）")

            print()

        # Vercelに送信
        if reservations:
            send_to_vercel(reservations)

        print("=" * 70)
        print(f"✅ 処理完了: {processed_count}件の予約を処理")
        print("=" * 70)

    except HttpError as error:
        print(f"❌ Gmail API エラー: {error}")
    except Exception as e:
        print(f"❌ 予期しないエラー: {e}")

if __name__ == '__main__':
    sync_gmail_reservations()

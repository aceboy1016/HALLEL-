#!/usr/bin/env python3
"""
Gmail連携スクリプト - ラベル付けテスト版
（メール数過多対策なし、テスト用）
"""

import os
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# スコープにmodifyを含める（ラベル付けに必要）
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

def get_gmail_service():
    """Gmail APIサービスを取得"""
    creds = None

    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists('credentials.json'):
                print("エラー: credentials.json が見つかりません")
                print("\nセットアップ手順:")
                print("1. https://console.cloud.google.com/ にアクセス")
                print("2. Gmail API を有効化")
                print("3. OAuth 2.0 認証情報を作成")
                print("4. credentials.json をダウンロードしてこのディレクトリに配置")
                return None

            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)

        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return build('gmail', 'v1', credentials=creds)

def create_label(service, label_name):
    """ラベルを作成（存在しない場合）"""
    try:
        # 既存のラベルをチェック
        results = service.users().labels().list(userId='me').execute()
        labels = results.get('labels', [])

        for label in labels:
            if label['name'] == label_name:
                print(f"ラベル '{label_name}' は既に存在します（ID: {label['id']}）")
                return label['id']

        # 新しいラベルを作成
        label_object = {
            'name': label_name,
            'labelListVisibility': 'labelShow',
            'messageListVisibility': 'show'
        }
        created_label = service.users().labels().create(
            userId='me',
            body=label_object
        ).execute()

        print(f"✓ ラベル '{label_name}' を作成しました（ID: {created_label['id']}）")
        return created_label['id']

    except Exception as e:
        print(f"エラー: {e}")
        return None

def add_label_to_messages(service, query, label_id, max_results=10):
    """検索クエリに一致するメッセージにラベルを付ける"""
    try:
        results = service.users().messages().list(
            userId='me',
            q=query,
            maxResults=max_results
        ).execute()

        messages = results.get('messages', [])

        if not messages:
            print(f"検索クエリ '{query}' に一致するメールが見つかりませんでした。")
            return 0

        print(f"\n{len(messages)}件のメールにラベルを付けます...")

        success_count = 0
        for i, message in enumerate(messages, 1):
            try:
                # ラベルを追加
                service.users().messages().modify(
                    userId='me',
                    id=message['id'],
                    body={'addLabelIds': [label_id]}
                ).execute()

                print(f"  [{i}/{len(messages)}] ✓ メールID: {message['id'][:20]}... にラベルを付けました")
                success_count += 1

            except Exception as e:
                print(f"  [{i}/{len(messages)}] ✗ エラー: {e}")

        return success_count

    except Exception as e:
        print(f"エラー: {e}")
        return 0

def main():
    print("=" * 60)
    print("Gmail ラベル付けテスト")
    print("=" * 60)

    service = get_gmail_service()

    if not service:
        return

    # テスト用ラベル名
    label_name = "HALLEL予約テスト"

    # ラベルを作成
    print(f"\n1. ラベル '{label_name}' を作成...")
    label_id = create_label(service, label_name)

    if not label_id:
        print("ラベルの作成に失敗しました。")
        return

    # メールを検索してラベルを付ける
    print(f"\n2. メールを検索してラベルを付ける...")
    query = "is:unread subject:予約"  # 未読で件名に「予約」を含むメール
    print(f"   検索クエリ: {query}")

    success_count = add_label_to_messages(service, query, label_id, max_results=5)

    print("\n" + "=" * 60)
    print(f"完了: {success_count}件のメールにラベルを付けました")
    print("=" * 60)

if __name__ == '__main__':
    main()

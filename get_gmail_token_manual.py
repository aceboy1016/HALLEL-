#!/usr/bin/env python3
"""
Gmail認証トークン取得（手動モード）
サーバー環境用
"""

import os
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

def main():
    print("=" * 70)
    print("Gmail API 認証（手動モード）")
    print("=" * 70)

    creds = None

    if os.path.exists('token.json'):
        print("\n⚠️  既存のtoken.jsonが見つかりました")
        response = input("削除して再認証しますか？ (yes/no): ")
        if response.lower() in ['yes', 'y']:
            os.remove('token.json')
            print("✅ token.jsonを削除しました")
        else:
            creds = Credentials.from_authorized_user_file('token.json', SCOPES)
            if creds and creds.valid:
                print("✅ 既存のトークンは有効です")
                return

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            print("🔄 トークンをリフレッシュ中...")
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            print("✅ トークンをリフレッシュしました")
        else:
            print("\n📝 新規認証を開始します...\n")

            if not os.path.exists('credentials.json'):
                print("❌ credentials.json が見つかりません")
                return

            # 手動認証フロー
            flow = InstalledAppFlow.from_client_secrets_file(
                'credentials.json',
                SCOPES,
                redirect_uri='urn:ietf:wg:oauth:2.0:oob'  # 手動コピー用
            )

            # 認証URLを生成
            auth_url, _ = flow.authorization_url(prompt='consent')

            print("=" * 70)
            print("🔗 ステップ1: 以下のURLをブラウザで開いてください")
            print("=" * 70)
            print()
            print(auth_url)
            print()
            print("=" * 70)
            print("📋 ステップ2: Googleアカウントでログインして権限を承認")
            print("=" * 70)
            print()
            print("1. ブラウザでGoogleアカウントにログイン")
            print("2. 「HALLEL」アプリの権限を確認")
            print("3. 「許可」をクリック")
            print("4. 表示された認証コードをコピー")
            print()
            print("=" * 70)

            # 認証コードを入力
            code = input("\n🔑 認証コード を貼り付けてください: ").strip()

            if not code:
                print("❌ 認証コードが入力されませんでした")
                return

            # トークンを取得
            try:
                flow.fetch_token(code=code)
                creds = flow.credentials
                print("\n✅ 認証に成功しました！")
            except Exception as e:
                print(f"\n❌ 認証エラー: {e}")
                return

        # トークンを保存
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

        print("\n✅ token.json を保存しました")

    print("\n" + "=" * 70)
    print("🎉 Gmail API認証完了！")
    print("=" * 70)
    print("\n次のコマンドで全メール同期を実行できます:")
    print("  python sync_all_emails.py")
    print()

if __name__ == '__main__':
    main()

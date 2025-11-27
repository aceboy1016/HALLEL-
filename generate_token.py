#!/usr/bin/env python3
"""
認証コードからtoken.jsonを生成
"""

import os
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
AUTH_CODE = '4/1Ab32j91jIuVY_uBFWxxTbBX8UrU_mPikTvc4fjqqtOeHM4RExOQd-El0B1s'

def main():
    print("=" * 70)
    print("🔑 認証コードからtoken.jsonを生成中...")
    print("=" * 70)

    if not os.path.exists('credentials.json'):
        print("❌ credentials.json が見つかりません")
        return

    try:
        # フローを作成
        flow = InstalledAppFlow.from_client_secrets_file(
            'credentials.json',
            SCOPES,
            redirect_uri='urn:ietf:wg:oauth:2.0:oob'
        )

        # 認証URLを生成（state取得のため）
        flow.authorization_url(prompt='consent')

        # 認証コードからトークンを取得
        print("\n📥 認証コードを処理中...")
        flow.fetch_token(code=AUTH_CODE)
        creds = flow.credentials

        # token.jsonに保存
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

        print("✅ token.json を生成しました！")
        print("\n" + "=" * 70)
        print("🎉 Gmail API認証完了！")
        print("=" * 70)
        print("\n次は全メール同期を実行します...")

        return True

    except Exception as e:
        print(f"\n❌ エラー: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)

#!/usr/bin/env python3
"""
未処理メール確認スクリプト
どのメールが処理されていないか確認します
"""

import os
from gmail_sync_vercel import get_gmail_service, CONFIG

def check_unprocessed_emails():
    """未処理メールをチェック"""
    print("=" * 70)
    print("📧 未処理メール確認")
    print("=" * 70)

    service = get_gmail_service()
    if not service:
        print("\n❌ Gmail APIサービスの初期化に失敗しました")
        return

    try:
        # ラベルIDを取得
        results = service.users().labels().list(userId='me').execute()
        all_labels = results.get('labels', [])

        processed_label_id = None
        for label in all_labels:
            if label['name'] == CONFIG['LABELS']['PROCESSED']:
                processed_label_id = label['id']
                break

        # 全メールを検索
        print(f"\n🔍 全メール検索中...")
        all_results = service.users().messages().list(
            userId='me',
            q=CONFIG['SEARCH_QUERY'],
            maxResults=500
        ).execute()

        all_messages = all_results.get('messages', [])
        print(f"   📧 対象メール総数: {len(all_messages)}件")

        # 処理済みメールを検索
        if processed_label_id:
            processed_query = f"{CONFIG['SEARCH_QUERY']} label:{processed_label_id}"
            processed_results = service.users().messages().list(
                userId='me',
                q=processed_query,
                maxResults=500
            ).execute()

            processed_messages = processed_results.get('messages', [])
            print(f"   ✅ 処理済み: {len(processed_messages)}件")

            # 未処理メールを計算
            processed_ids = {msg['id'] for msg in processed_messages}
            unprocessed = [msg for msg in all_messages if msg['id'] not in processed_ids]

            print(f"   ❌ 未処理: {len(unprocessed)}件")

            if unprocessed:
                print(f"\n📋 未処理メール一覧（最大10件）:\n")

                for i, msg in enumerate(unprocessed[:10], 1):
                    # メッセージ詳細を取得
                    msg_detail = service.users().messages().get(
                        userId='me',
                        id=msg['id'],
                        format='metadata',
                        metadataHeaders=['Subject', 'Date']
                    ).execute()

                    subject = ''
                    date = ''
                    for header in msg_detail.get('payload', {}).get('headers', []):
                        if header['name'] == 'Subject':
                            subject = header['value']
                        elif header['name'] == 'Date':
                            date = header['value']

                    print(f"  {i}. {subject}")
                    print(f"     日付: {date}")
                    print(f"     ID: {msg['id']}")
                    print()

                if len(unprocessed) > 10:
                    print(f"   ... 他 {len(unprocessed) - 10}件")

                print("\n💡 全未処理メールを処理するには:")
                print("   python sync_all_emails.py")
                print("\n   または GAS で:")
                print("   forceFullSync()")

            else:
                print("\n✅ 全てのメールが処理済みです！")

        else:
            print("\n⚠️  HALLEL/Processed ラベルが見つかりません")
            print("   ラベルを作成してから処理してください")

        print("\n" + "=" * 70)

    except Exception as e:
        print(f"\n❌ エラー: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    check_unprocessed_emails()

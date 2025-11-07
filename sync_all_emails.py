#!/usr/bin/env python3
"""
全メール同期スクリプト
全ての予約メールをVercelに反映します
"""

import os
import sys

# 既存のスクリプトをインポート
from gmail_sync_vercel import (
    get_gmail_service,
    setup_labels,
    detect_store,
    parse_email_message,
    apply_labels,
    send_to_vercel,
    CONFIG
)

def sync_all_emails_no_limit():
    """全メールを同期（件数制限なし）"""
    print("=" * 70)
    print("📧 HALLEL 全メール同期")
    print("=" * 70)

    service = get_gmail_service()
    if not service:
        print("\n❌ Gmail APIサービスの初期化に失敗しました")
        print("💡 credentials.jsonを配置してから再実行してください")
        return

    # ラベルセットアップ
    setup_labels(service)

    # 全メール検索（件数制限なし）
    print(f"\n🔍 全メール検索中...")
    print(f"   クエリ: {CONFIG['SEARCH_QUERY']}")
    print("   ⚠️  制限なし - 全メールを検索します\n")

    try:
        all_messages = []
        page_token = None
        page_num = 1

        while True:
            # ページネーション対応
            if page_token:
                results = service.users().messages().list(
                    userId='me',
                    q=CONFIG['SEARCH_QUERY'],
                    pageToken=page_token,
                    maxResults=100
                ).execute()
            else:
                results = service.users().messages().list(
                    userId='me',
                    q=CONFIG['SEARCH_QUERY'],
                    maxResults=100
                ).execute()

            messages = results.get('messages', [])
            all_messages.extend(messages)

            print(f"   ページ {page_num}: {len(messages)}件 (累計: {len(all_messages)}件)")

            page_token = results.get('nextPageToken')
            if not page_token:
                break

            page_num += 1

        if not all_messages:
            print("\n   📭 対象メールなし")
            return

        print(f"\n   📧 合計 {len(all_messages)}件のメールを発見")

        # 処理確認
        response = input(f"\n❓ {len(all_messages)}件のメールを処理しますか？ (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("❌ 処理をキャンセルしました")
            return

        print("\n🚀 処理開始...\n")

        reservations = []
        processed_count = 0
        skipped_count = 0
        error_count = 0

        for i, msg in enumerate(all_messages, 1):
            msg_id = msg['id']

            # 進行状況表示
            if i % 10 == 0 or i == 1:
                percentage = (i / len(all_messages)) * 100
                print(f"\n[{i}/{len(all_messages)}] 進行状況: {percentage:.1f}%")

            try:
                # メッセージの詳細を取得
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

                # パース
                reservation = parse_email_message(service, msg_id, subject)

                if reservation:
                    reservations.append(reservation)

                    # ラベル適用
                    apply_labels(service, msg_id, reservation['is_cancellation'], reservation['store'])

                    action = "キャンセル" if reservation['is_cancellation'] else "予約"
                    print(f"  ✅ {action}: [{reservation['store']}] {reservation['date']} {reservation['start']}-{reservation['end']} {reservation['customer_name']}")
                    processed_count += 1

                    # 100件ごとにVercelに送信（メモリ節約）
                    if len(reservations) >= 100:
                        print(f"\n  📤 中間送信: {len(reservations)}件をVercelに送信...")
                        send_to_vercel(reservations)
                        reservations = []  # リセット

                else:
                    print(f"  ⏭️  スキップ: {subject[:50]}...")
                    skipped_count += 1

            except KeyboardInterrupt:
                print("\n\n⚠️  ユーザーによる中断")
                if reservations:
                    print(f"📤 残り{len(reservations)}件をVercelに送信...")
                    send_to_vercel(reservations)
                break

            except Exception as e:
                print(f"  ❌ エラー: {e}")
                error_count += 1
                continue

        # 残りをVercelに送信
        if reservations:
            print(f"\n📤 最終送信: {len(reservations)}件をVercelに送信...")
            send_to_vercel(reservations)

        print("\n" + "=" * 70)
        print("✅ 全メール処理完了")
        print("=" * 70)
        print(f"📊 統計:")
        print(f"   - 処理成功: {processed_count}件")
        print(f"   - スキップ: {skipped_count}件")
        print(f"   - エラー: {error_count}件")
        print(f"   - 合計: {len(all_messages)}件")
        print("=" * 70)

    except KeyboardInterrupt:
        print("\n\n⚠️  処理を中断しました")
        sys.exit(1)

    except Exception as e:
        print(f"\n❌ 予期しないエラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    try:
        sync_all_emails_no_limit()
    except KeyboardInterrupt:
        print("\n\n👋 処理を終了します")
        sys.exit(0)

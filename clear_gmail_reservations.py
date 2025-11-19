"""
Vercel PostgreSQLデータベースから、Gmailインポート予約を全削除
"""
import os
import psycopg2

def clear_gmail_reservations():
    """Gmail経由の予約データを全削除"""

    # 環境変数からPOSTGRES_URLを取得
    DATABASE_URL = os.environ.get('POSTGRES_URL')

    if not DATABASE_URL:
        print("❌ エラー: POSTGRES_URL環境変数が設定されていません")
        print("\n設定方法:")
        print("export POSTGRES_URL='your_postgres_url_here'")
        return

    try:
        # データベース接続
        print("データベースに接続中...")
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # 削除前の件数を確認
        cur.execute("SELECT COUNT(*) FROM reservations WHERE type = 'gmail'")
        count_before = cur.fetchone()[0]
        print(f"\n削除前の Gmail予約数: {count_before}件")

        if count_before == 0:
            print("削除対象のデータがありません。")
            cur.close()
            conn.close()
            return

        # 確認
        confirm = input(f"\n本当に {count_before}件 の Gmail予約を削除しますか？ (yes/no): ")
        if confirm.lower() != 'yes':
            print("キャンセルしました。")
            cur.close()
            conn.close()
            return

        # Gmail予約を削除
        print("\n削除中...")
        cur.execute("DELETE FROM reservations WHERE type = 'gmail'")
        deleted_count = cur.rowcount

        # コミット
        conn.commit()

        # 削除後の確認
        cur.execute("SELECT COUNT(*) FROM reservations WHERE type = 'gmail'")
        count_after = cur.fetchone()[0]

        print(f"\n✅ 削除完了！")
        print(f"削除件数: {deleted_count}件")
        print(f"削除後の Gmail予約数: {count_after}件")

        cur.close()
        conn.close()

        print("\n次のステップ:")
        print("Google Apps Script で processLatestReservationsOnly() を実行してください")

    except Exception as e:
        print(f"\n❌ エラー: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    clear_gmail_reservations()

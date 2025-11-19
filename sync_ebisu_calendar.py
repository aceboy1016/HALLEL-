"""
恵比寿店の予約を今すぐGoogleカレンダーに同期

使い方:
python sync_ebisu_calendar.py
"""
import os
import sys
import psycopg2
from datetime import datetime, date

# calendar_syncをインポート
from calendar_sync import add_to_calendar

def sync_ebisu_to_calendar():
    """恵比寿店の全予約をGoogleカレンダーに同期"""

    print('=' * 80)
    print('恵比寿店 → Googleカレンダー同期')
    print('=' * 80)

    # データベース接続
    DATABASE_URL = os.environ.get('POSTGRES_URL')

    if not DATABASE_URL:
        print('❌ エラー: POSTGRES_URL環境変数が設定されていません')
        return

    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # 恵比寿店の今日以降の予約を取得
        today = date.today().isoformat()

        cur.execute("""
            SELECT date, start_time, end_time, customer_name
            FROM reservations
            WHERE store = 'ebisu'
            AND date >= %s
            ORDER BY date, start_time
        """, (today,))

        reservations = cur.fetchall()

        print(f'\n恵比寿店の予約件数: {len(reservations)}件')
        print('-' * 80)

        if len(reservations) == 0:
            print('予約がありません')
            return

        success_count = 0
        error_count = 0

        for res in reservations:
            date_str, start_time, end_time, customer_name = res

            print(f'\n{date_str} {start_time}-{end_time} {customer_name}')

            # Googleカレンダーに追加
            result = add_to_calendar(
                store='ebisu',
                date=date_str,
                start_time=start_time,
                end_time=end_time,
                customer_name=customer_name or '予約'
            )

            if result:
                print('  ✓ カレンダーに追加成功')
                success_count += 1
            else:
                print('  ✗ カレンダーに追加失敗')
                error_count += 1

        print('\n' + '=' * 80)
        print('同期完了')
        print(f'成功: {success_count}件')
        print(f'失敗: {error_count}件')
        print('=' * 80)

        cur.close()
        conn.close()

    except Exception as e:
        print(f'❌ エラー: {e}')
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    sync_ebisu_to_calendar()

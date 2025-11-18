"""
Google Calendar同期モジュール

恵比寿店・半蔵門店の予約をGoogle Calendarに同期します。
これにより、石原さんの予約早見表が引き続き動作します。
"""

import os
import json
from datetime import datetime, timedelta
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# カレンダーID設定（環境変数から取得）
CALENDAR_IDS = {
    'ebisu': os.environ.get('EBISU_CALENDAR_ID', 'ebisu@topform.jp'),
    'hanzomon': os.environ.get('HANZOMON_CALENDAR_ID', 'light@topform.jp')
}

# サービスアカウント認証情報（環境変数から取得）
SERVICE_ACCOUNT_JSON = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')

# Google Calendar APIスコープ
SCOPES = ['https://www.googleapis.com/auth/calendar']


def get_calendar_service():
    """
    Google Calendar APIサービスを取得

    Returns:
        Resource: Google Calendar APIサービスオブジェクト
    """
    try:
        if not SERVICE_ACCOUNT_JSON:
            print("⚠️  WARNING: GOOGLE_SERVICE_ACCOUNT_JSON not set. Calendar sync disabled.")
            return None

        # サービスアカウント認証情報をJSONから読み込み
        credentials_dict = json.loads(SERVICE_ACCOUNT_JSON)
        credentials = service_account.Credentials.from_service_account_info(
            credentials_dict,
            scopes=SCOPES
        )

        # Calendar APIサービスを構築
        service = build('calendar', 'v3', credentials=credentials)
        return service

    except Exception as e:
        print(f"Error initializing Calendar API: {e}")
        return None


def add_to_calendar(store, date, start_time, end_time, customer_name='予約'):
    """
    Google Calendarに予約を追加

    Args:
        store (str): 店舗ID（ebisu, hanzomon）
        date (str): 予約日（YYYY-MM-DD）
        start_time (str): 開始時刻（HH:MM）
        end_time (str): 終了時刻（HH:MM）
        customer_name (str): 顧客名（デフォルト: '予約'）

    Returns:
        dict: カレンダーイベントID（成功時）またはNone（失敗時）
    """
    # 恵比寿・半蔵門以外の店舗はスキップ
    if store not in ['ebisu', 'hanzomon']:
        return None

    try:
        service = get_calendar_service()
        if not service:
            return None

        calendar_id = CALENDAR_IDS.get(store)
        if not calendar_id:
            print(f"⚠️  Calendar ID not found for store: {store}")
            return None

        # イベント作成
        start_datetime = f"{date}T{start_time}:00"
        end_datetime = f"{date}T{end_time}:00"

        event = {
            'summary': f'{customer_name}様',
            'description': f'予約（{store}店）',
            'start': {
                'dateTime': start_datetime,
                'timeZone': 'Asia/Tokyo',
            },
            'end': {
                'dateTime': end_datetime,
                'timeZone': 'Asia/Tokyo',
            },
        }

        # カレンダーにイベントを追加
        event = service.events().insert(calendarId=calendar_id, body=event).execute()
        print(f"✓ Calendar event added: {store} - {date} {start_time}-{end_time} - {customer_name}")

        return {
            'event_id': event.get('id'),
            'calendar_id': calendar_id,
            'store': store
        }

    except HttpError as e:
        print(f"Calendar API error (add): {e}")
        return None
    except Exception as e:
        print(f"Error adding to calendar: {e}")
        return None


def delete_from_calendar(store, date, start_time, end_time):
    """
    Google Calendarから予約を削除

    Args:
        store (str): 店舗ID（ebisu, hanzomon）
        date (str): 予約日（YYYY-MM-DD）
        start_time (str): 開始時刻（HH:MM）
        end_time (str): 終了時刻（HH:MM）

    Returns:
        bool: 削除成功時True、失敗時False
    """
    # 恵比寿・半蔵門以外の店舗はスキップ
    if store not in ['ebisu', 'hanzomon']:
        return False

    try:
        service = get_calendar_service()
        if not service:
            return False

        calendar_id = CALENDAR_IDS.get(store)
        if not calendar_id:
            print(f"⚠️  Calendar ID not found for store: {store}")
            return False

        # 該当する時間帯のイベントを検索
        start_datetime = f"{date}T{start_time}:00+09:00"
        end_datetime = f"{date}T{end_time}:00+09:00"

        events_result = service.events().list(
            calendarId=calendar_id,
            timeMin=start_datetime,
            timeMax=end_datetime,
            singleEvents=True,
            orderBy='startTime'
        ).execute()

        events = events_result.get('items', [])

        # 該当するイベントを削除
        deleted_count = 0
        for event in events:
            try:
                service.events().delete(calendarId=calendar_id, eventId=event['id']).execute()
                deleted_count += 1
                print(f"✓ Calendar event deleted: {store} - {date} {start_time}-{end_time}")
            except HttpError as e:
                print(f"Error deleting event {event['id']}: {e}")

        return deleted_count > 0

    except HttpError as e:
        print(f"Calendar API error (delete): {e}")
        return False
    except Exception as e:
        print(f"Error deleting from calendar: {e}")
        return False


def update_in_calendar(store, old_date, old_start, old_end, new_date, new_start, new_end, customer_name='予約'):
    """
    Google Calendarの予約を更新

    Args:
        store (str): 店舗ID（ebisu, hanzomon）
        old_date (str): 旧予約日（YYYY-MM-DD）
        old_start (str): 旧開始時刻（HH:MM）
        old_end (str): 旧終了時刻（HH:MM）
        new_date (str): 新予約日（YYYY-MM-DD）
        new_start (str): 新開始時刻（HH:MM）
        new_end (str): 新終了時刻（HH:MM）
        customer_name (str): 顧客名（デフォルト: '予約'）

    Returns:
        bool: 更新成功時True、失敗時False
    """
    # 恵比寿・半蔵門以外の店舗はスキップ
    if store not in ['ebisu', 'hanzomon']:
        return False

    try:
        # まず旧イベントを削除
        delete_from_calendar(store, old_date, old_start, old_end)

        # 新しいイベントを追加
        result = add_to_calendar(store, new_date, new_start, new_end, customer_name)

        return result is not None

    except Exception as e:
        print(f"Error updating calendar: {e}")
        return False


# テスト用関数
def test_calendar_sync():
    """
    Google Calendar同期のテスト
    """
    print("=== Google Calendar Sync Test ===")

    # テスト1: 恵比寿店に予約を追加
    print("\n[Test 1] Adding reservation to Ebisu...")
    result = add_to_calendar(
        store='ebisu',
        date='2025-12-01',
        start_time='10:00',
        end_time='11:00',
        customer_name='テスト太郎'
    )
    print(f"Result: {result}")

    # テスト2: 半蔵門店に予約を追加
    print("\n[Test 2] Adding reservation to Hanzomon...")
    result = add_to_calendar(
        store='hanzomon',
        date='2025-12-01',
        start_time='14:00',
        end_time='15:00',
        customer_name='テスト花子'
    )
    print(f"Result: {result}")

    # テスト3: 恵比寿店から予約を削除
    print("\n[Test 3] Deleting reservation from Ebisu...")
    result = delete_from_calendar(
        store='ebisu',
        date='2025-12-01',
        start_time='10:00',
        end_time='11:00'
    )
    print(f"Result: {result}")

    # テスト4: 渋谷店（Calendar同期対象外）
    print("\n[Test 4] Adding reservation to Shibuya (should skip)...")
    result = add_to_calendar(
        store='shibuya',
        date='2025-12-01',
        start_time='16:00',
        end_time='17:00',
        customer_name='渋谷テスト'
    )
    print(f"Result: {result}")

    print("\n=== Test Complete ===")


if __name__ == '__main__':
    test_calendar_sync()

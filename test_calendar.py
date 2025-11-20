"""
Google Calendar API接続テストスクリプト

環境変数の確認とAPI接続テストを実行
"""
import os
import sys

def test_environment():
    """環境変数の確認"""
    print("=" * 80)
    print("【環境変数チェック】")
    print("=" * 80)

    # GOOGLE_SERVICE_ACCOUNT_JSON
    service_account_json = os.environ.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if service_account_json:
        print("✓ GOOGLE_SERVICE_ACCOUNT_JSON: 設定されています")
        print(f"  長さ: {len(service_account_json)} 文字")
        print(f"  最初の50文字: {service_account_json[:50]}...")
    else:
        print("✗ GOOGLE_SERVICE_ACCOUNT_JSON: 設定されていません")
        print("  → これが原因でカレンダー同期が失敗しています")
        return False

    # EBISU_CALENDAR_ID
    ebisu_calendar_id = os.environ.get('EBISU_CALENDAR_ID')
    if ebisu_calendar_id:
        print(f"✓ EBISU_CALENDAR_ID: {ebisu_calendar_id}")
    else:
        print("✗ EBISU_CALENDAR_ID: 設定されていません（デフォルト: ebisu@topform.jp）")

    # HANZOMON_CALENDAR_ID
    hanzomon_calendar_id = os.environ.get('HANZOMON_CALENDAR_ID')
    if hanzomon_calendar_id:
        print(f"✓ HANZOMON_CALENDAR_ID: {hanzomon_calendar_id}")
    else:
        print("✗ HANZOMON_CALENDAR_ID: 設定されていません（デフォルト: light@topform.jp）")

    print()
    return True


def test_calendar_api():
    """Google Calendar API接続テスト"""
    print("=" * 80)
    print("【Google Calendar API接続テスト】")
    print("=" * 80)

    try:
        from calendar_sync import get_calendar_service, CALENDAR_IDS

        # サービス取得
        service = get_calendar_service()
        if not service:
            print("✗ get_calendar_service() が None を返しました")
            print("  → GOOGLE_SERVICE_ACCOUNT_JSON が設定されていない可能性があります")
            return False

        print("✓ Google Calendar APIサービスの取得に成功")

        # カレンダー一覧取得テスト
        try:
            calendar_list = service.calendarList().list().execute()
            calendars = calendar_list.get('items', [])

            print(f"\n✓ アクセス可能なカレンダー: {len(calendars)}件")
            for cal in calendars[:5]:  # 最初の5件のみ表示
                print(f"  - {cal.get('summary')} ({cal.get('id')})")

            # 恵比寿店のカレンダーIDが存在するか確認
            ebisu_calendar_id = CALENDAR_IDS.get('ebisu')
            print(f"\n恵比寿店のカレンダーID: {ebisu_calendar_id}")

            ebisu_found = any(cal.get('id') == ebisu_calendar_id for cal in calendars)
            if ebisu_found:
                print(f"✓ 恵比寿店のカレンダー ({ebisu_calendar_id}) にアクセス可能")
            else:
                print(f"✗ 恵比寿店のカレンダー ({ebisu_calendar_id}) が見つかりません")
                print("  利用可能なカレンダーID:")
                for cal in calendars:
                    print(f"    - {cal.get('id')}")
                return False

            return True

        except Exception as e:
            print(f"✗ カレンダー一覧の取得に失敗: {e}")
            import traceback
            traceback.print_exc()
            return False

    except Exception as e:
        print(f"✗ エラー: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    env_ok = test_environment()
    print()

    if env_ok:
        api_ok = test_calendar_api()
        print()

        if api_ok:
            print("=" * 80)
            print("✅ すべてのテストが成功しました！")
            print("=" * 80)
            sys.exit(0)

    print("=" * 80)
    print("❌ テストが失敗しました")
    print("=" * 80)
    sys.exit(1)

#!/usr/bin/env python3
"""
Gmail連携の統合テスト（エンドツーエンド）
"""
import re
import requests
import json

FLASK_API_URL = 'http://localhost:5001/api/process_email'

def parse_email_body(body):
    """メール本文から予約情報を抽出"""
    result = {
        'action_type': None,
        'date': None,
        'start_time': None,
        'end_time': None
    }

    # 予約パターン
    booking_pattern = r'予約[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-~〜ー]\s*(\d{1,2}:\d{2})'
    booking_match = re.search(booking_pattern, body)

    if booking_match:
        result['action_type'] = 'booking'
        result['date'] = booking_match.group(1)
        result['start_time'] = booking_match.group(2).zfill(5)
        result['end_time'] = booking_match.group(3).zfill(5)
        return result

    # キャンセルパターン
    cancel_pattern = r'キャンセル[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})'
    cancel_match = re.search(cancel_pattern, body)

    if cancel_match:
        result['action_type'] = 'cancellation'
        result['date'] = cancel_match.group(1)
        result['start_time'] = cancel_match.group(2).zfill(5)
        return result

    return None

def send_to_flask_api(booking_data):
    """Flask APIに予約データを送信"""
    try:
        response = requests.post(
            FLASK_API_URL,
            json=booking_data,
            timeout=10
        )
        response.raise_for_status()
        return True, response.json()
    except Exception as e:
        return False, str(e)

# 統合テスト
print("=" * 70)
print("Gmail連携 統合テスト（エンドツーエンド）")
print("=" * 70)

test_scenario = [
    {
        'step': 1,
        'description': '予約メールの受信と処理',
        'email_body': '''
        HALLEL渋谷店 ご予約

        予約: 2025-12-01 18:00-20:00
        お客様名: 山田太郎
        人数: 5名
        '''
    },
    {
        'step': 2,
        'description': '別の予約メール',
        'email_body': '''
        予約：2025-12-01 14:00-16:00
        お客様: 田中花子
        '''
    },
    {
        'step': 3,
        'description': 'キャンセルメールの処理',
        'email_body': '''
        キャンセル: 2025-12-01 18:00
        お客様名: 山田太郎
        '''
    }
]

for scenario in test_scenario:
    print(f"\n【ステップ {scenario['step']}】{scenario['description']}")
    print("-" * 70)

    # メールをパース
    print("1. メール本文をパース...")
    booking_info = parse_email_body(scenario['email_body'])

    if not booking_info:
        print("   ✗ パース失敗: 予約情報が見つかりません")
        continue

    print(f"   ✓ パース成功")
    print(f"     - アクション: {booking_info['action_type']}")
    print(f"     - 日付: {booking_info['date']}")
    print(f"     - 開始: {booking_info['start_time']}")
    if booking_info['end_time']:
        print(f"     - 終了: {booking_info['end_time']}")

    # APIに送信
    print("\n2. Flask APIに送信...")
    success, response = send_to_flask_api(booking_info)

    if success:
        print(f"   ✓ API送信成功")
        print(f"     レスポンス: {response.get('message', 'N/A')}")
    else:
        print(f"   ✗ API送信失敗: {response}")

# 最終確認
print("\n" + "=" * 70)
print("最終確認: 現在の予約状況")
print("=" * 70)

try:
    response = requests.get('http://localhost:5001/api/reservations')
    reservations = response.json()

    if '2025-12-01' in reservations:
        print(f"\n2025-12-01 の予約: {len(reservations['2025-12-01'])}件")
        for i, res in enumerate(reservations['2025-12-01'], 1):
            print(f"  {i}. {res['start']} - {res['end']} ({res['type']})")
    else:
        print("\n2025-12-01 の予約: なし")

except Exception as e:
    print(f"エラー: {e}")

print("\n" + "=" * 70)
print("統合テスト完了")
print("=" * 70)

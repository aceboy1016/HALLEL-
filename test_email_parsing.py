#!/usr/bin/env python3
"""
メールパース機能のテスト
"""
import re

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

# テストケース
test_emails = [
    {
        'name': '予約メール（標準形式）',
        'body': '''
        HALLEL渋谷店 ご予約確認

        予約: 2025-11-10 14:00-15:30
        お客様名: 田中太郎
        人数: 3名
        '''
    },
    {
        'name': '予約メール（全角コロン）',
        'body': '''
        予約：2025-11-15 10:30〜12:00
        お客様: 佐藤花子
        '''
    },
    {
        'name': 'キャンセルメール',
        'body': '''
        キャンセル: 2025-11-10 14:00
        お客様名: 鈴木一郎
        '''
    },
    {
        'name': '予約情報なし',
        'body': '''
        お問い合わせありがとうございます。
        詳細は後ほどご連絡いたします。
        '''
    }
]

print("=" * 60)
print("メールパース機能テスト")
print("=" * 60)

for i, test in enumerate(test_emails, 1):
    print(f"\n【テスト {i}】{test['name']}")
    print("-" * 60)
    print(f"メール本文:\n{test['body']}")
    print("-" * 60)

    result = parse_email_body(test['body'])

    if result:
        print(f"✓ パース成功:")
        print(f"  アクション: {result['action_type']}")
        print(f"  日付: {result['date']}")
        print(f"  開始時刻: {result['start_time']}")
        if result['end_time']:
            print(f"  終了時刻: {result['end_time']}")
    else:
        print("✗ 予約情報が見つかりませんでした")

print("\n" + "=" * 60)
print("テスト完了")
print("=" * 60)

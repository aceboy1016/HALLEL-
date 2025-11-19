#!/bin/bash
# Gmail予約をVercel APIで全削除

echo "=================================="
echo "Gmail予約全削除"
echo "=================================="
echo ""
echo "Vercel APIに削除リクエストを送信中..."
echo ""

response=$(curl -s -X DELETE \
  https://hallel-shibuya.vercel.app/api/gas/clear-gmail-reservations \
  -H "X-API-Key: Wh00k@2025!Secure\$Token#ABC123XYZ" \
  -H "Content-Type: application/json")

echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"

echo ""
echo "=================================="
echo "次のステップ:"
echo "Google Apps Script で processLatestReservationsOnly() を実行してください"
echo "=================================="

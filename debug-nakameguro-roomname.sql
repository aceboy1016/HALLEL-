-- 中目黒店のroom_nameを確認

-- 1. 中目黒店の全予約のroom_nameを確認
SELECT
  date,
  start_time,
  customer_name,
  room_name,
  store
FROM reservations
WHERE store = 'nakameguro'
ORDER BY date DESC, start_time DESC
LIMIT 20;

-- 2. 中目黒店のroom_name別カウント
SELECT
  room_name,
  COUNT(*) as count
FROM reservations
WHERE store = 'nakameguro'
GROUP BY room_name;

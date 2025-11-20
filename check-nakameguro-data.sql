-- 中目黒店のデータを確認するSQL

-- 1. 中目黒店の予約件数を確認
SELECT COUNT(*) as total_nakameguro
FROM reservations
WHERE store = 'nakameguro';

-- 2. 中目黒店のエリア別件数
SELECT room_name, COUNT(*) as count
FROM reservations
WHERE store = 'nakameguro'
GROUP BY room_name;

-- 3. 中目黒店の最新10件
SELECT date, start_time, end_time, customer_name, room_name
FROM reservations
WHERE store = 'nakameguro'
ORDER BY date DESC, start_time DESC
LIMIT 10;

-- 4. 全店舗の件数比較
SELECT store, COUNT(*) as count
FROM reservations
GROUP BY store
ORDER BY count DESC;

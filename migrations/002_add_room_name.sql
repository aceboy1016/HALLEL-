-- Add room_name column to reservations table for tracking which room (個室A or 個室B)
ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS room_name VARCHAR(50) DEFAULT '個室B';

-- Update existing ebisu and hanzomon reservations to have default room name
UPDATE reservations
SET room_name = '個室B'
WHERE room_name IS NULL AND store IN ('ebisu', 'hanzomon');

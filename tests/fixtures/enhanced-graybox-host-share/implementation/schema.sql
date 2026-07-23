-- DIFF:D06 host_share_percent is nullable.
ALTER TABLE room_admin ADD host_share_percent DECIMAL(5,2) NULL;

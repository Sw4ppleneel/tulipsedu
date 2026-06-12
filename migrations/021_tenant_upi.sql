-- School UPI VPA (Virtual Payment Address) for parent QR fee payments.
-- e.g. 'schoolname@okaxis'. NULL = UPI payment not configured for this tenant.
-- Down:
--   ALTER TABLE tenants DROP COLUMN upi_id;

ALTER TABLE tenants ADD COLUMN upi_id VARCHAR(100);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sale_price_cents integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_sale_price_cents_check'
      AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_sale_price_cents_check
      CHECK (
        sale_price_cents IS NULL
        OR (sale_price_cents >= 0 AND sale_price_cents < price_cents)
      );
  END IF;
END
$$;

WITH selected_products AS (
  SELECT id
  FROM products
  WHERE sale_price_cents IS NULL
  ORDER BY random()
  LIMIT GREATEST(
    2 - (SELECT count(*) FROM products WHERE sale_price_cents IS NOT NULL),
    0
  )
)
UPDATE products AS product
SET sale_price_cents = round(product.price_cents * 0.8)::integer
FROM selected_products
WHERE product.id = selected_products.id;
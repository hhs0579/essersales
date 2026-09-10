-- 특판 매출(special_sale) — 월별 저장 구조로 마이그레이션
-- 기존: { "entries": [...] } 또는 { "totalSales", "margin" }
-- 신규: { "months": { "YYYY-MM": { "entries": [...] } } }

UPDATE app_settings
SET data = jsonb_build_object(
  'months',
  jsonb_build_object(
    to_char(COALESCE(updated_at, NOW()), 'YYYY-MM'),
    CASE
      WHEN data ? 'entries' THEN jsonb_build_object('entries', data->'entries')
      WHEN data ? 'totalSales' OR data ? 'margin' THEN
        jsonb_build_object(
          'entries',
          jsonb_build_array(
            jsonb_build_object(
              'name', '특판',
              'sales', COALESCE(data->>'totalSales', ''),
              'margin', COALESCE(data->>'margin', '')
            )
          )
        )
      ELSE jsonb_build_object('entries', '[]'::jsonb)
    END
  )
),
updated_at = NOW()
WHERE kind = 'special_sale'
  AND NOT (data ? 'months')
  AND (
    data ? 'entries'
    OR data ? 'totalSales'
    OR data ? 'margin'
  );

INSERT INTO schema_migrations (version, name)
VALUES (3, '003_special_sale_monthly_format')
ON CONFLICT (version) DO NOTHING;

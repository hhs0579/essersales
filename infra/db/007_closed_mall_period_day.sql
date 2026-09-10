-- 특판(폐쇄몰) — period를 행 order_date 하루로 맞춤 (일별 KPI·통합 필터)
-- 업로드 min~max(8/1~8/31)가 남아 있으면 SQL period 겹침 제외만으로도 동작하나,
-- 레거시 행 정규화용.

UPDATE sales_records
SET
  period_from = order_date,
  period_to = order_date
WHERE upload_kind IN ('bestheim_closed_mall', 'esser_closed_mall')
  AND order_date IS NOT NULL
  AND (
    period_from IS DISTINCT FROM order_date
    OR period_to IS DISTINCT FROM order_date
  );

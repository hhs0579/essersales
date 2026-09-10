-- 판매내역 표 서버 페이지네이션 — record_type + scope(upload_kind) + 날짜
-- ILIKE 검색(상품명·판매처)은 leading wildcard라 btree 인덱스 효과가 없어 추가하지 않음.

CREATE INDEX IF NOT EXISTS idx_sales_records_type_kind_order_date
  ON sales_records (record_type, upload_kind, order_date);

CREATE INDEX IF NOT EXISTS idx_sales_records_type_kind_kpi_date
  ON sales_records (record_type, upload_kind, kpi_date);

INSERT INTO schema_migrations (version, name)
VALUES (5, '005_records_list_index')
ON CONFLICT (version) DO NOTHING;

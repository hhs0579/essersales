-- JS parseSalesDate / resolveAggregationDate 와 동일한 일별 집계일.
-- data JSON은 변경하지 않고 kpi_aggregation_date 만 재계산한다.

CREATE OR REPLACE FUNCTION esser_parse_sales_date(raw text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  s text;
  m text[];
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  s := btrim(raw);
  IF s = '' THEN
    RETURN NULL;
  END IF;
  IF s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN substr(s, 1, 10)::date;
  END IF;
  IF s ~ '[0-9]{4}' THEN
    m := regexp_match(
      s,
      '([0-9]{4})[[:space:]]*[.\\-/년．][[:space:]]*([0-9]{1,2})[[:space:]]*[.\\-/월．]?[[:space:]]*([0-9]{1,2})'
    );
    IF m IS NOT NULL THEN
      RETURN make_date(m[1]::int, m[2]::int, m[3]::int);
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION esser_resolve_aggregation_date(
  data jsonb,
  order_date date,
  business_date date,
  period_from date,
  period_to date
)
RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    esser_parse_sales_date(data->>'date'),
    esser_parse_sales_date(data->>'contextDate'),
    order_date,
    business_date,
    CASE
      WHEN period_from IS NOT NULL AND (period_to IS NULL OR period_from = period_to)
        THEN period_from
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION sales_records_compute_kpi_dates()
RETURNS TRIGGER AS $$
BEGIN
  NEW.kpi_date = COALESCE(
    NEW.order_date,
    NEW.business_date,
    NEW.period_from,
    CASE
      WHEN NEW.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        THEN (SUBSTRING(NEW.data->>'date' FROM 1 FOR 10))::date
      ELSE NULL
    END
  );

  NEW.kpi_aggregation_date = esser_resolve_aggregation_date(
    NEW.data,
    NEW.order_date,
    NEW.business_date,
    NEW.period_from,
    NEW.period_to
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_records_kpi_dates ON sales_records;
CREATE TRIGGER trg_sales_records_kpi_dates
BEFORE INSERT OR UPDATE ON sales_records
FOR EACH ROW
EXECUTE PROCEDURE sales_records_compute_kpi_dates();

UPDATE sales_records
SET kpi_aggregation_date = esser_resolve_aggregation_date(
  data,
  order_date,
  business_date,
  period_from,
  period_to
);

INSERT INTO schema_migrations (version, name)
VALUES (6, '006_aggregation_date_backfill')
ON CONFLICT (version) DO NOTHING;

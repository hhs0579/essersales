import { getPool } from '../db/pool.js'
import { closedMallDuplicateFingerprint } from '../../../src/config/bestheimClosedMall.js'
import { parseAmount } from '../../../src/utils/parseAmount.js'

/**
 * 기존 특판 폐쇄몰 행 지문 집합
 * @param {string} uploadKind
 * @returns {Promise<Set<string>>}
 */
export async function loadClosedMallFingerprints(uploadKind = 'bestheim_closed_mall') {
  const pool = getPool()
  const res = await pool.query(
    `SELECT
       order_date::text AS order_date,
       store_name,
       product_name,
       sales_qty,
       sales,
       COALESCE(data->>'shippingFee', data->>'shipping_fee', '0') AS shipping_fee,
       COALESCE(data->>'commission', data->>'channelFee', data->>'channel_fee', '0') AS commission,
       COALESCE(data->>'unitCost', data->>'unit_cost', '0') AS unit_cost
     FROM sales_records
     WHERE upload_kind = $1
       AND record_type = 'detail'`,
    [uploadKind],
  )

  const set = new Set()
  for (const row of res.rows) {
    set.add(
      closedMallDuplicateFingerprint({
        dateYmd: row.order_date || '',
        seller: row.store_name || '',
        productName: row.product_name || '',
        qty: parseAmount(row.sales_qty),
        payment: parseAmount(row.sales),
        shippingFee: parseAmount(row.shipping_fee),
        commission: parseAmount(row.commission),
        unitCost: parseAmount(row.unit_cost),
      }),
    )
  }
  return set
}

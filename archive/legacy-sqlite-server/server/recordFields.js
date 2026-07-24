/** DB 저장 시 actualPayment·margin 등 구 필드명 → 화면/엑셀용 esser 필드 보완 */
export function normalizeDetailFields(data) {
  if (!data || typeof data !== 'object') return data
  if (data.uploadFormat === 'sales_report') return data

  const sales = data.sales ?? data.actualPayment ?? ''
  const salesQty = data.salesQty ?? data.quantity ?? ''
  const netProfit = data.netProfit ?? data.margin ?? ''

  return {
    ...data,
    sales: sales === '' || sales == null ? '' : String(sales),
    salesQty: salesQty === '' || salesQty == null ? '' : String(salesQty),
    netProfit: netProfit === '' || netProfit == null ? '' : String(netProfit),
  }
}

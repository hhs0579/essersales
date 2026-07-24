import { parseAmount } from './parseAmount.js'

/** @typedef {'sale' | 'return'} TransactionType */

/**
 * 빅셀 등 원본: 매출·수량이 마이너스면 반품(취소) 건
 * @returns {'sale' | 'return'}
 */
export function inferTransactionType(row) {
  if (!row) return 'sale'
  if (row.transactionType === 'return' || row.transactionType === 'sale') {
    return row.transactionType
  }
  const sales = parseAmount(row.sales ?? row.actualPayment)
  const qty = parseAmount(row.salesQty ?? row.quantity)
  if (sales < 0 || qty < 0) return 'return'
  return 'sale'
}

export function isReturnRecord(row) {
  return inferTransactionType(row) === 'return'
}

export function getTransactionTypeLabel(row) {
  return isReturnRecord(row) ? '반품' : '판매'
}

export function attachTransactionType(row) {
  const transactionType = inferTransactionType(row)
  return { ...row, transactionType }
}

/** 상세 거래(판매) / 반품 탭 분리용 */
export function partitionSalesAndReturns(records = []) {
  const sales = []
  const returns = []
  for (const row of records) {
    if (isReturnRecord(row)) returns.push(row)
    else sales.push(row)
  }
  return { sales, returns }
}

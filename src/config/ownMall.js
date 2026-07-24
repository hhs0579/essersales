import { parseAmount } from '../utils/parseAmount.js'
import { resolveRecordPlatform } from '../utils/platformDetect.js'

/** 자사몰 결제 카드 수수료 — 매출 대비 3.3% */
export const OWN_MALL_CARD_FEE_RATE = 0.033

/** @param {number|string} salesAmt */
export function calcOwnMallCardFee(salesAmt) {
  const sales = parseAmount(salesAmt)
  if (!sales) return 0
  return Math.round(sales * OWN_MALL_CARD_FEE_RATE)
}

/** @param {object} row */
export function isOwnMallRecord(row) {
  if (!row) return false
  if (resolveRecordPlatform(row) === '자사몰') return true
  const p = String(row.platform || row.channel || row.salesMethod || '').trim()
  return p === '자사몰'
}

/**
 * @param {object} row
 * @param {number} sales
 * @param {number} totalCost
 * @param {number} netProfit — 행에 저장된 순이익(없으면 0)
 */
export function applyOwnMallCardFeeToNetProfit(row, sales, totalCost, netProfit) {
  if (!isOwnMallRecord(row) || !(sales > 0)) return netProfit

  const channelFee =
    parseAmount(row?.channelFee ?? row?.commission) || calcOwnMallCardFee(sales)
  const grossMargin = sales - totalCost

  if (!netProfit || Math.abs(netProfit - grossMargin) < 1) {
    return grossMargin - channelFee
  }
  return netProfit
}

/** @param {object} row @param {number} sales */
export function resolveOwnMallChannelFee(row, sales) {
  if (!isOwnMallRecord(row) || !(sales > 0)) return 0
  return parseAmount(row?.channelFee ?? row?.commission) || calcOwnMallCardFee(sales)
}

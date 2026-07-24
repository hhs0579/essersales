/** 통합 탭 — 특판(위탁 등) 수동 매출 보정 */

export const SPECIAL_SALE_LABEL = '특판'
export const SPECIAL_SALE_SETTING_KIND = 'special_sale'

function newEntryId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `ss_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** @returns {{ id: string, name: string, sales: string, margin: string }} */
export function createEmptySpecialSaleEntry() {
  return {
    id: newEntryId(),
    name: '',
    sales: '',
    margin: '',
  }
}

/** @returns {{ entries: ReturnType<typeof createEmptySpecialSaleEntry>[] }} */
export function createEmptySpecialSale() {
  return {
    entries: [createEmptySpecialSaleEntry()],
  }
}

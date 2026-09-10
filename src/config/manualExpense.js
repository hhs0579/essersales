/** 통합 월별 — 수기 지출 (마진·순이익에서 차감) */

export const MANUAL_EXPENSE_LABEL = '수기 지출'
export const MANUAL_EXPENSE_SETTING_KIND = 'manual_expense'

function newEntryId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `me_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** @returns {{ id: string, name: string, amount: string }} */
export function createEmptyManualExpenseEntry() {
  return {
    id: newEntryId(),
    name: '',
    amount: '',
  }
}

/** @returns {{ entries: ReturnType<typeof createEmptyManualExpenseEntry>[] }} */
export function createEmptyManualExpense() {
  return {
    entries: [createEmptyManualExpenseEntry()],
  }
}

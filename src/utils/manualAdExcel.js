import { parseAmount } from './parseAmount.js'
import { MANUAL_AD_SOURCE_DEFS } from '../config/manualAdSpend.js'
import {
  summarizeManualAdExportByDay,
  groupManualAdEntriesBySource,
} from './manualAdSpend.js'

function sumExcelManualAd(entries, filterCtx) {
  let adSpend = 0
  let adSales = 0
  for (const [, sums] of summarizeManualAdExportByDay(entries, filterCtx)) {
    adSpend += sums.adSpend
    adSales += sums.adSales
  }
  return { adSpend, adSales }
}

/**
 * @param {import('../config/manualAdSpend.js').ManualAdEntry[]} entries
 * @param {{ period?: string, channelLabel?: string, sectionTitle?: string, filterCtx?: object }} [opts]
 * @returns {unknown[][]}
 */
export function buildManualAdExcelBlock(entries, opts = {}) {
  if (!entries?.length) return []
  const filterCtx = opts.filterCtx || {}
  const monthly = opts.period === 'monthly' || filterCtx.period === 'monthly'
  const channelLabel = opts.channelLabel || ''
  const titlePrefix = channelLabel ? `${channelLabel}-` : ''
  const sectionTitle =
    opts.sectionTitle ||
    (monthly
      ? `■ ${titlePrefix}Meta (월별 수동 입력)`
      : `■ ${titlePrefix}Meta (일별 수동 입력)`)
  const rows = []
  rows.push([sectionTitle])
  rows.push([monthly ? '월' : '일자', '광고비용', '전환매출액'])
  for (const [ymd, sums] of summarizeManualAdExportByDay(entries, filterCtx)) {
    const dateLabel = monthly ? ymd.slice(0, 7) : ymd
    rows.push([
      dateLabel,
      sums.adSpend ? Math.round(sums.adSpend) : '',
      sums.adSales ? Math.round(sums.adSales) : '',
    ])
  }
  rows.push([])
  return rows
}

/**
 * @param {Array<{ label: string, entries: import('../config/manualAdSpend.js').ManualAdEntry[] }>} channelGroups
 * @param {{ period?: string, filterCtx?: object }} [opts]
 */
export function buildManualAdExcelBlocksByChannel(channelGroups, opts = {}) {
  if (!channelGroups?.length) return []
  const rows = []
  const monthly = opts.period === 'monthly' || opts.filterCtx?.period === 'monthly'
  for (const { label, entries } of channelGroups) {
    if (!entries?.length) continue
    const bySource = groupManualAdEntriesBySource(entries)
    for (const def of MANUAL_AD_SOURCE_DEFS) {
      const list = bySource[def.value] || []
      if (!list.length) continue
      rows.push(
        ...buildManualAdExcelBlock(list, {
          ...opts,
          channelLabel: label,
          sectionTitle: monthly
            ? `■ ${label ? `${label}-` : ''}${def.kpiLabel} (월별)`
            : `■ ${label ? `${label}-` : ''}${def.kpiLabel} (일별)`,
        }),
      )
    }
    const applied = sumExcelManualAd(entries, opts.filterCtx || {})
    if (applied.adSpend || applied.adSales) {
      rows.push(...buildManualAdAppliedNote(applied, opts))
      rows.push([])
    }
  }
  return rows
}

/**
 * @param {{ adSpend: number, adSales: number }} applied
 * @param {{ period?: string }} [opts]
 */
export function buildManualAdAppliedNote(applied, opts = {}) {
  if (!applied?.adSpend && !applied?.adSales) return []
  const monthly = opts.period === 'monthly'
  return [
    [
      '총합광고비',
      applied.adSpend ? Math.round(applied.adSpend) : '',
      applied.adSales ? Math.round(applied.adSales) : '',
      monthly ? 'KPI·월별·ROAS에 합산' : 'KPI·일별·ROAS에 합산',
    ],
  ]
}

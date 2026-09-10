/** 통합 매출 손익계산 리포트 — 엑셀 템플릿 형식 */

import { COMBINED_DAILY_SCOPE } from './combinedChannel.js'

export const PROFIT_LOSS_TEMPLATE_SCOPE = COMBINED_DAILY_SCOPE
export const PROFIT_LOSS_TEMPLATE_KIND = 'profit_loss_template'

/** 템플릿 스키마 버전 */
export const PROFIT_LOSS_TEMPLATE_VERSION = 1

/** KPI 필드 key — 템플릿 `{{sales}}` 또는 행 라벨 자동 매핑 */
export const PROFIT_LOSS_FIELD_KEYS = [
  'sales',
  'totalCost',
  'netProfit',
  'netProfitRate',
  'adSpend',
  'adSales',
  'organicSales',
  'organicSalesRate',
  'salesQty',
  'roas',
  'salesRoas',
  'aov',
]

export const PROFIT_LOSS_FIELD_LABELS = {
  sales: '매출',
  totalCost: '원가',
  netProfit: '순이익',
  netProfitRate: '순이익률',
  adSpend: '광고비',
  adSales: '광고매출',
  organicSales: '자연매출',
  organicSalesRate: '자연매출 비율',
  salesQty: '판매수량',
  roas: 'ROAS(광고)',
  salesRoas: 'ROAS(전체)',
  aov: '객단가',
}

/** 브랜드 열 헤더 인식 */
export const PROFIT_LOSS_BRAND_HEADERS = [
  '베스트하임',
  '사본느리',
  '에쎄르',
  '파워프라이스',
  '합계',
  '종합',
  '전체',
]

/** 메타 필드 — `{{period}}`, `{{generatedAt}}` 등 */
export const PROFIT_LOSS_META_KEYS = ['period', 'generatedAt', 'reportTitle', 'dateFrom', 'dateTo']

/**
 * @typedef {Object} ProfitLossPlaceholder
 * @property {number} row
 * @property {number} col
 * @property {string} token
 * @property {object} parsed
 */

/**
 * @typedef {Object} ProfitLossLabelBinding
 * @property {number} sheetRow
 * @property {number} col
 * @property {string} brand
 * @property {string} fieldKey
 * @property {string} label
 */

/**
 * @typedef {Object} ProfitLossTemplateSheet
 * @property {string} name
 * @property {number} rowCount
 * @property {number} colCount
 * @property {string[][]} aoa
 * @property {ProfitLossPlaceholder[]} placeholders
 * @property {{ row: number, brands: { col: number, label: string }[] } | null} brandHeader
 * @property {ProfitLossLabelBinding[]} labelBindings
 */

/**
 * @typedef {Object} ProfitLossTemplate
 * @property {number} version
 * @property {string} fileName
 * @property {string} uploadedAt
 * @property {string[]} sheetNames
 * @property {ProfitLossTemplateSheet[]} sheets
 * @property {object} summary
 */

#!/usr/bin/env node
/**
 * scopeFilter — 레거시 upload kind / 통합 scope 회귀
 * node infra/scripts/scope-filter-regression.mjs
 */
import { recordMatchesScopeCore } from '../../src/utils/scopeFilter.js'

function ok(label, pass, detail = '') {
  console.log(`${label}: ${pass ? 'OK' : 'FAIL'}${detail ? ` ${detail}` : ''}`)
  return pass
}

const legacyBhRow = {
  uploadKind: 'sales_report',
  uploadFormat: 'coupang_esser',
  platform: '쿠팡',
}

const platformDailyRow = {
  uploadKind: 'platform_daily',
  uploadFormat: 'coupang_esser',
  platform: '쿠팡',
}

const companyBRow = {
  uploadKind: 'sales_daily_b',
  platform: '쿠팡',
}

let all = true
all = ok('platform ← sales_report', recordMatchesScopeCore(legacyBhRow, 'platform')) && all
all = ok('combined_daily ← sales_report', recordMatchesScopeCore(legacyBhRow, 'combined_daily')) && all
all = ok('combined_daily ← platform_daily', recordMatchesScopeCore(platformDailyRow, 'combined_daily')) && all
all = ok('combined_daily ← sales_daily_b', recordMatchesScopeCore(companyBRow, 'combined_daily')) && all
all =
  ok(
    'platform ✗ sales_daily_b',
    !recordMatchesScopeCore(companyBRow, 'platform'),
  ) && all
all =
  ok(
    'company_b ✗ sales_report',
    !recordMatchesScopeCore(legacyBhRow, 'company_b'),
  ) && all

if (!all) process.exit(1)
console.log('\nscope-filter-regression: PASS')

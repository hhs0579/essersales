<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'

const PlatformUploadPage = defineAsyncComponent(
  () => import('./components/pages/PlatformUploadPage.vue'),
)
const PlatformDashboardPage = defineAsyncComponent(
  () => import('./components/pages/PlatformDashboardPage.vue'),
)
const SalesReportPage = defineAsyncComponent(() => import('./components/pages/SalesReportPage.vue'))
const SalesReportDataPage = defineAsyncComponent(
  () => import('./components/pages/SalesReportDataPage.vue'),
)
import { FEATURES } from './config/features.js'
import { getDefaultChannelId } from './config/dataChannels.js'
import { getApiModeLabel, isPgMode } from './services/apiMode.js'
import { getKpiSourceLabel } from './services/kpiSource.js'
import { getWriteApiModeLabel } from './services/writeApiMode.js'
import { getExportApiModeLabel } from './services/exportApiMode.js'
import { getDevApiStats } from './services/devApiStats.js'

const showApiModeBadge = import.meta.env.DEV

function devApiBadgeText() {
  let text = `API MODE: ${getApiModeLabel()}`
  if (isPgMode()) text += ` · KPI: ${getKpiSourceLabel()}`
  text += ` · WRITE: ${getWriteApiModeLabel()}`
  text += ` · EXPORT: ${getExportApiModeLabel()}`
  if (isPgMode()) {
    const { lastFetch } = getDevApiStats()
    if (lastFetch) text += ` · last ${lastFetch.label} ${lastFetch.ms}ms`
  }
  return text
}

const mainPage = ref('platform-upload')
const platformChannel = ref(getDefaultChannelId())
const platformScope = ref('platform')

const allNavItems = [
  { key: 'platform-upload', label: '플랫폼 업로드' },
  { key: 'platform-dashboard', label: '매출 대시보드' },
  { key: 'sales-report', label: '통합 매출 업로드', feature: 'salesReport' },
  { key: 'sales-report-data', label: '통합 매출 데이터', feature: 'salesReport' },
]

const navItems = computed(() =>
  allNavItems.filter((item) => !item.feature || FEATURES[item.feature]),
)

const isUploadPage = computed(() => mainPage.value === 'platform-upload')
const isDashboardPage = computed(() => mainPage.value === 'platform-dashboard')

function goPage(key) {
  if (!navItems.value.some((item) => item.key === key)) return
  mainPage.value = key
}

function goDashboardFromUpload(payload) {
  if (payload?.channelId) platformChannel.value = payload.channelId
  if (payload?.scope) platformScope.value = payload.scope
  goPage('platform-dashboard')
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <h1>에쎄르 영업팀</h1>
      <p class="subtitle">플랫폼 매출 업로드 · 대시보드 (기업별 탭)</p>
      <p v-if="showApiModeBadge" class="api-mode-badge">{{ devApiBadgeText() }}</p>
    </div>
    <nav class="main-nav" aria-label="메인 메뉴">
      <button
        v-for="item in navItems"
        :key="item.key"
        type="button"
        class="nav-tab"
        :class="{ active: mainPage === item.key }"
        @click="goPage(item.key)"
      >
        {{ item.label }}
      </button>
    </nav>
  </header>

  <main class="app-main">
    <PlatformUploadPage
      v-if="isUploadPage"
      key="page-upload"
      v-model="platformChannel"
      @go-dashboard="goDashboardFromUpload"
    />
    <PlatformDashboardPage
      v-else-if="isDashboardPage"
      key="page-dashboard"
      v-model="platformChannel"
      :initial-scope="platformScope"
    />
    <SalesReportPage
      v-else-if="FEATURES.salesReport && mainPage === 'sales-report'"
      key="page-sales-report"
      @go-data="goPage('sales-report-data')"
    />
    <SalesReportDataPage
      v-else-if="FEATURES.salesReport && mainPage === 'sales-report-data'"
      key="page-sales-report-data"
    />
  </main>
</template>

<style scoped>
.app-header,
.app-main {
  width: 100%;
  min-width: 0;
  max-width: none;
}

.app-header {
  margin-bottom: 24px;
}

.brand {
  margin-bottom: 16px;
}

.subtitle {
  color: var(--muted);
  font-size: 0.9rem;
  margin: 4px 0 0;
}

.api-mode-badge {
  display: inline-block;
  margin: 8px 0 0;
  padding: 2px 8px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #0f172a;
  background: #e2e8f0;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
}

.main-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
}

.nav-tab {
  flex: 1;
  min-width: 120px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.nav-tab:hover {
  background: #f1f5f9;
}

.nav-tab.active {
  background: var(--primary);
  color: #fff;
}

.app-main {
  min-height: 320px;
}
</style>

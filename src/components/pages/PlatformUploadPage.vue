<script setup>

import { computed, onMounted, ref, toRefs } from 'vue'
import DatePeriodFilter from '../DatePeriodFilter.vue'

import PlatformDailyUpload from '../PlatformDailyUpload.vue'

import PlatformMonthlyUpload from '../PlatformMonthlyUpload.vue'

import PowerPricePanel from '../PowerPricePanel.vue'
import Coupang1pRocketPanel from '../Coupang1pRocketPanel.vue'
import OwnMallManualPanel from '../OwnMallManualPanel.vue'
import ClosedMallUpload from '../ClosedMallUpload.vue'

import UploadHistoryList from '../UploadHistoryList.vue'

import {

  DATA_CHANNELS,

  getChannel,

  getDefaultChannelId,

  getMode,

  isManualOnlyChannel,

  isClosedMallChannel,
  isCoupang1pRocketChannel,

} from '../../config/dataChannels.js'
import { CLOSED_MALL_BRANDS, getClosedMallBrand } from '../../config/closedMall.js'
import { COUPANG_1P_ROCKET_BRANDS } from '../../config/coupang1pRocket.js'

import { useSalesData } from '../../composables/useSalesData.js'
import { defaultReportDateRange } from '../../utils/reportDateRange.js'

const closedMallBrandKey = ref('esser')
const coupang1pBrandKey = ref('bestheim')



const props = defineProps({

  modelValue: { type: String, default: getDefaultChannelId() },

})



const emit = defineEmits(['update:modelValue', 'go-dashboard'])



const activeChannelId = computed({

  get: () => props.modelValue,

  set: (v) => emit('update:modelValue', v),

})



const activeUploadMode = ref('daily')

const _defaultRange = defaultReportDateRange()
const panelDateFrom = ref(_defaultRange.dateFrom)
const panelDateTo = ref(_defaultRange.dateTo)

const panelFilterCtx = computed(() => ({
  dateFrom: panelDateFrom.value,
  dateTo: panelDateTo.value,
  period: 'daily',
}))



const salesByScope = {}

for (const ch of DATA_CHANNELS) {

  for (const mode of ch.modes) {

    if (!salesByScope[mode.scope]) {

      salesByScope[mode.scope] = useSalesData({ scope: mode.scope })

    }

  }

}



const root = useSalesData()

const { onDataChannelUploaded, onDeleteUpload, uploadsForChannel } = root

const { saving, success, error } = toRefs(root)



const activeChannel = computed(() => getChannel(activeChannelId.value))



const uploadModesForChannel = computed(() => {

  const ch = activeChannel.value

  if (ch.manualOnly) return ch.modes

  return ch.modes.filter((m) => m.id === 'daily')

})



function setChannel(id) {

  activeChannelId.value = id

  const ch = getChannel(id)

  if (!ch.modes.some((m) => m.id === activeUploadMode.value)) {

    activeUploadMode.value = ch.modes[0]?.id || 'daily'

  }

}



function setUploadMode(modeId) {

  activeUploadMode.value = modeId

}



function scopeFor(channelId, modeId = activeUploadMode.value) {

  return getMode(channelId, modeId).scope

}



function apiFor(channelId, modeId = activeUploadMode.value) {

  return salesByScope[scopeFor(channelId, modeId)]

}



function channelUploads(channelId, modeId = activeUploadMode.value) {
  if (isClosedMallChannel(channelId)) {
    return closedMallUploadsForBrand(closedMallBrandKey.value)
  }

  const kind = getMode(channelId, modeId).uploadKind

  return uploadsForChannel(channelId)

    .filter((u) => u.uploadKind === kind)

    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

}

/** 기타 판매처 · 브랜드별 업로드 이력 */
function closedMallUploadsForBrand(brandKey) {
  const def = getClosedMallBrand(brandKey)
  if (!def) return []
  return uploadsForChannel('channel_e')
    .filter((u) => u.uploadKind === def.uploadKind)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

function selectClosedMallUploadsForBrand(brandKey) {
  const api = apiFor('channel_e', 'daily')
  const ids = closedMallUploadsForBrand(brandKey).map((u) => u.id)
  api.selectedUploadIds.value = ids
}



function selectedIdsFor(channelId, modeId = activeUploadMode.value) {

  return apiFor(channelId, modeId).selectedUploadIds.value

}



onMounted(async () => {

  await root.ensureCoreLoaded()

  await root.reloadUploadList()

})



async function handleUploaded(channelId, modeId, opts = {}) {

  await onDataChannelUploaded(scopeFor(channelId, modeId))

  // 특판 폐쇄몰 업로드 후 선택에 포함되어야 대시보드(특히 통합)에 바로 반영됨
  if (opts.closedMall) {
    const api = apiFor(channelId, modeId)
    const brandKey = opts.brand || closedMallBrandKey.value
    const closedIds = closedMallUploadsForBrand(brandKey).map((u) => u.id)
    if (api.selectedUploadIds.value.length) {
      const set = new Set(api.selectedUploadIds.value)
      for (const id of closedIds) set.add(id)
      api.selectedUploadIds.value = [...set]
    }
  }

}



function goDashboard() {

  const mode = getMode(activeChannelId.value, activeUploadMode.value)

  emit('go-dashboard', {

    channelId: activeChannelId.value,

    scope: mode.scope,

    modeId: mode.id,

  })

}

</script>



<template>

  <section class="card">

    <h2 class="card-title">플랫폼 엑셀 업로드</h2>

    <p class="standard-ref">

      <strong>베스트하임 / 사본느리</strong>는 <strong>일별</strong>(하루치)와

      <strong>월별</strong>(1일~말일) 빅셀 매출분석 엑셀을 업로드합니다.

      <strong>사본느리 일별</strong> 탭 아래에서 <strong>자사몰 주문·판매 엑셀</strong>도 업로드·관리할 수 있습니다.

      <strong>쿠팡 1P 로켓</strong>·파워프라이스는 엑셀 없이 직접 입력합니다.

    </p>



    <nav class="inner-tabs channel-tabs" aria-label="데이터 출처(기업)">

      <button

        v-for="ch in DATA_CHANNELS"

        :key="ch.id"

        type="button"

        class="inner-tab"

        :class="{ active: activeChannelId === ch.id }"

        @click="setChannel(ch.id)"

      >

        {{ ch.tabLabel }}

      </button>

    </nav>



    <div

      v-for="ch in DATA_CHANNELS"

      :key="ch.id"

      v-show="activeChannelId === ch.id"

      class="tab-panel"

    >

      <header class="channel-head">

        <h3 class="channel-title">

          {{ getMode(ch.id, activeUploadMode).label }}

        </h3>

        <span class="channel-badge">{{ ch.tabLabel }}</span>

      </header>



      <nav

        v-if="!ch.manualOnly && uploadModesForChannel.length > 1"

        class="inner-tabs mode-tabs"

        aria-label="업로드 구분"

      >

        <button

          v-for="mode in uploadModesForChannel"

          :key="mode.id"

          type="button"

          class="inner-tab"

          :class="{ active: activeUploadMode === mode.id }"

          @click="setUploadMode(mode.id)"

        >

          {{ mode.label }}

        </button>

      </nav>



      <div
        v-if="ch.manualOnly || (ch.id === 'channel_b' && activeUploadMode === 'daily')"
        class="upload-date-filter"
      >
        <p class="standard-ref upload-date-hint">
          판매 등록표에 표시할 <strong>조회 일자</strong>를 선택하세요. (선택한 날짜·기간의 판매 행만 표시)
        </p>
        <DatePeriodFilter
          v-model:date-from="panelDateFrom"
          v-model:date-to="panelDateTo"
        />
      </div>

      <p class="standard-ref tab-desc">

        <template v-if="ch.manualOnly || isClosedMallChannel(ch.id) || isCoupang1pRocketChannel(ch.id)">{{ ch.description }}</template>

        <template v-else-if="activeUploadMode === 'monthly'">

          한 달치(1일~말일) 빅셀 매출분석 엑셀 · 파일명 예:

          <code>…_20260601_20260630.xlsx</code>

        </template>

        <template v-else>

          하루치 일별 빅셀 엑셀 · 파일명 예: <code>…_20260531.xlsx</code>,

          <code>일자20260601</code>

          · 사본느리 <strong>자사몰(기본_양식)</strong>은 아래 전용 패널에서만 업로드하세요.

        </template>

      </p>



      <PowerPricePanel
        v-if="ch.manualOnly && ch.id === 'channel_c'"
        :scope="getMode(ch.id).scope"
        :filter-ctx="panelFilterCtx"
      />

      <template v-else-if="isClosedMallChannel(ch.id)">
        <div class="inner-tabs closed-mall-brand-tabs" role="tablist">
          <button
            v-for="b in CLOSED_MALL_BRANDS"
            :key="b.key"
            type="button"
            class="inner-tab"
            :class="{ active: closedMallBrandKey === b.key }"
            role="tab"
            :aria-selected="closedMallBrandKey === b.key"
            @click="closedMallBrandKey = b.key"
          >
            {{ b.tabLabel }}
          </button>
        </div>

        <ClosedMallUpload
          :brand="closedMallBrandKey"
          @uploaded="
            (p) =>
              handleUploaded(ch.id, 'daily', {
                closedMall: true,
                brand: p?.brand || closedMallBrandKey,
              })
          "
        />

        <div class="upload-history-block closed-mall-history">
          <h3 class="section-subtitle">
            업로드된 파일 · 특판 폐쇄몰 ·
            {{ getClosedMallBrand(closedMallBrandKey)?.tabLabel }}
          </h3>
          <p class="standard-ref history-hint">
            체크한 파일만
            <strong>매출 대시보드 → 기타 판매처</strong>
            · 통합에 반영됩니다. <strong>원본 받기</strong>로 업로드했던 엑셀을 다시 받을 수 있습니다.
            삭제하면 해당 파일 데이터도 함께 제거됩니다.
          </p>
          <UploadHistoryList
            :uploads="closedMallUploadsForBrand(closedMallBrandKey)"
            :selected-upload-ids="selectedIdsFor(ch.id, 'daily')"
            :saving="saving"
            :page-size="10"
            :empty-text="`「${getClosedMallBrand(closedMallBrandKey)?.tabLabel}」 특판 폐쇄몰 업로드가 없습니다.`"
            @toggle="apiFor(ch.id, 'daily').toggleUploadSelection"
            @select-all="selectClosedMallUploadsForBrand(closedMallBrandKey)"
            @clear-selection="apiFor(ch.id, 'daily').clearUploadSelection"
            @merge-download="apiFor(ch.id, 'daily').downloadMergedExcel"
            @delete="onDeleteUpload"
          />
        </div>
      </template>

      <template v-else-if="isCoupang1pRocketChannel(ch.id)">
        <div class="inner-tabs closed-mall-brand-tabs" role="tablist" aria-label="쿠팡 1P 브랜드">
          <button
            v-for="b in COUPANG_1P_ROCKET_BRANDS"
            :key="b.key"
            type="button"
            class="inner-tab"
            :class="{ active: coupang1pBrandKey === b.key }"
            role="tab"
            :aria-selected="coupang1pBrandKey === b.key"
            @click="coupang1pBrandKey = b.key"
          >
            {{ b.tabLabel }}
          </button>
        </div>
        <p class="standard-ref brand-panel-hint">
          <strong>{{ COUPANG_1P_ROCKET_BRANDS.find((b) => b.key === coupang1pBrandKey)?.tabLabel }}</strong>
          전용 상품 리스트·발주 내역입니다. 다른 브랜드와 데이터가 섞이지 않습니다.
        </p>
        <Coupang1pRocketPanel :brand-key="coupang1pBrandKey" :filter-ctx="panelFilterCtx" />
      </template>

      <template v-else>

        <PlatformDailyUpload

          v-if="activeUploadMode === 'daily'"

          :upload-kind="getMode(ch.id, 'daily').uploadKind"

          :exclude-own-mall-platform="ch.id === 'channel_b'"

          @uploaded="handleUploaded(ch.id, 'daily')"

        />

        <OwnMallManualPanel

          v-if="ch.id === 'channel_b' && activeUploadMode === 'daily'"

          :filter-ctx="panelFilterCtx"

          hide-sales-table

        />

        <PlatformMonthlyUpload

          v-if="activeUploadMode === 'monthly'"

          :upload-kind="getMode(ch.id, 'monthly').uploadKind"

          @uploaded="handleUploaded(ch.id, 'monthly')"

        />



        <div class="upload-history-block">

          <h3 class="section-subtitle">

            업로드된 파일 · {{ ch.tabLabel }} · {{ getMode(ch.id, activeUploadMode).label }}

          </h3>

          <p class="standard-ref history-hint">

            체크한 파일만

            <strong>매출 대시보드 → {{ ch.tabLabel }} → {{ getMode(ch.id, activeUploadMode).label }}</strong>

            에 반영됩니다. <strong>원본 받기</strong>로 업로드했던 엑셀을 다시 받을 수 있습니다.

          </p>

          <UploadHistoryList

            :uploads="channelUploads(ch.id, activeUploadMode)"

            :selected-upload-ids="selectedIdsFor(ch.id, activeUploadMode)"

            :saving="saving"

            :page-size="10"

            :empty-text="`「${ch.tabLabel}」 ${getMode(ch.id, activeUploadMode).label} 업로드가 없습니다.`"

            @toggle="apiFor(ch.id, activeUploadMode).toggleUploadSelection"

            @select-all="apiFor(ch.id, activeUploadMode).selectAllUploads"

            @clear-selection="apiFor(ch.id, activeUploadMode).clearUploadSelection"

            @merge-download="apiFor(ch.id, activeUploadMode).downloadMergedExcel"

            @delete="onDeleteUpload"

          />
        </div>

      </template>

    </div>



    <p v-if="saving" class="standard-ref">처리 중…</p>

    <p v-if="success" class="success-msg">{{ success }}</p>

    <p v-if="error" class="error-msg">{{ error }}</p>



    <div class="page-actions">

      <button type="button" class="btn btn-outline" @click="goDashboard">

        매출 대시보드 ({{ activeChannel.tabLabel }} ·

        {{ getMode(activeChannelId, activeUploadMode).label }}) →

      </button>

    </div>

  </section>

</template>



<style scoped>

.upload-date-filter {
  margin: 12px 0 16px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
}

.upload-date-hint {
  margin: 0 0 10px;
  font-size: 0.8125rem;
}

.inner-tabs {

  display: flex;

  gap: 6px;

  margin: 16px 0 12px;

  padding: 4px;

  background: #f1f5f9;

  border-radius: 10px;

  width: fit-content;

  max-width: 100%;

  flex-wrap: wrap;

}



.channel-tabs {

  margin-top: 12px;

}



.mode-tabs {

  margin-top: 8px;

  margin-bottom: 8px;

}



.inner-tab {

  padding: 8px 16px;

  border: none;

  border-radius: 8px;

  background: transparent;

  color: var(--muted);

  font-size: 0.875rem;

  font-weight: 500;

  cursor: pointer;

}



.inner-tab:hover {

  color: var(--text);

}



.inner-tab.active {

  background: var(--surface);

  color: var(--primary);

  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);

}



.channel-head {

  display: flex;

  align-items: baseline;

  gap: 10px;

  margin-bottom: 6px;

}



.channel-title {

  margin: 0;

  font-size: 1.05rem;

  font-weight: 600;

}



.channel-badge {

  font-size: 0.75rem;

  font-weight: 600;

  padding: 2px 8px;

  border-radius: 6px;

  background: #e0f2fe;

  color: #0369a1;

}



.tab-desc {

  margin-bottom: 12px;

}



.upload-history-block {

  margin-top: 28px;

  padding-top: 20px;

  border-top: 1px solid var(--border);

}



.section-subtitle {

  margin: 0 0 8px;

  font-size: 1rem;

  font-weight: 600;

}

.brand-panel-hint {
  margin: 0 0 14px;
  font-size: 0.8125rem;
  line-height: 1.5;
}

.history-hint {

  margin-bottom: 12px;

}



.page-actions {

  margin-top: 16px;

}



.success-msg {

  color: var(--success);

  margin-top: 12px;

  font-size: 0.875rem;

}



.error-msg {

  color: var(--danger);

  margin-top: 12px;

  font-size: 0.875rem;

}

</style>

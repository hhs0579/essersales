<script setup>

import { computed, onMounted, ref, watch } from 'vue'

import SalesDataView from '../SalesDataView.vue'
import CombinedCommentsPage from '../CombinedCommentsPage.vue'

import {
  getChannel,
  getDashboardChannels,
  getDefaultChannelId,
  getMode,
  getModeByScope,
  isManualOnlyChannel,
  isCombinedCommentsChannel,
} from '../../config/dataChannels.js'

import { useSalesData } from '../../composables/useSalesData.js'



const props = defineProps({

  modelValue: { type: String, default: getDefaultChannelId() },

  initialScope: { type: String, default: '' },

})



const emit = defineEmits(['update:modelValue'])



const activeChannelId = computed({

  get: () => props.modelValue,

  set: (v) => emit('update:modelValue', v),

})



const activeDashboardMode = ref('daily')



function applyInitialScope(scope) {

  if (!scope) return

  const found = getModeByScope(scope)

  if (found) {

    activeChannelId.value = found.channel.id

    activeDashboardMode.value = found.mode.id

  }

}



watch(

  () => props.initialScope,

  (scope) => applyInitialScope(scope),

  { immediate: true },

)



const root = useSalesData()



onMounted(async () => {

  await root.ensureCoreLoaded()

  await root.reloadUploadList()

})



const dashboardChannels = getDashboardChannels()

const activeChannel = computed(() =>
  dashboardChannels.find((ch) => ch.id === activeChannelId.value) || dashboardChannels[0],
)

function setChannel(id) {
  activeChannelId.value = id
  const ch = getChannel(id)
  if (ch && !ch.modes.some((m) => m.id === activeDashboardMode.value)) {
    activeDashboardMode.value = ch.modes[0]?.id || 'daily'
  }
}



function setDashboardMode(modeId) {

  activeDashboardMode.value = modeId

}



function scopeFor(channelId, modeId = activeDashboardMode.value) {

  return getMode(channelId, modeId).scope

}



function dashboardModesFor(ch) {

  if (ch.manualOnly) return ch.modes

  return ch.modes.filter((m) => m.id === 'daily' || m.id === 'monthly')

}

</script>



<template>

  <section class="card platform-dashboard">

    <h2 class="card-title">매출 대시보드</h2>

    <p class="standard-ref">
      <strong>베스트하임 / 사본느리</strong>는 각각 일별·월별 대시보드가 있습니다.
      <strong>파워프라이스 · 쿠팡 1P 로켓</strong>은 직접 입력 KPI를 표시합니다.
      <strong>통합</strong>은 주간 보고용 합산, <strong>통합코멘트</strong>는 날짜별 담당 코멘트입니다.
    </p>



    <nav class="inner-tabs" aria-label="데이터 출처(기업)">

      <button

        v-for="ch in dashboardChannels"

        :key="ch.id"

        type="button"

        class="inner-tab"

        :class="{ active: activeChannelId === ch.id }"

        @click="setChannel(ch.id)"

      >

        {{ ch.tabLabel }}

      </button>

    </nav>



    <div v-if="activeChannel" class="tab-panel">
      <template v-if="isCombinedCommentsChannel(activeChannel.id)">
        <header class="channel-head">
          <h3 class="channel-title">{{ activeChannel.reportTitle }}</h3>
          <span class="channel-badge">{{ activeChannel.tabLabel }}</span>
        </header>
        <CombinedCommentsPage />
      </template>
      <template v-else>
      <nav
        v-if="!isManualOnlyChannel(activeChannel.id) && dashboardModesFor(activeChannel).length > 1"
        class="inner-tabs mode-tabs"
        aria-label="대시보드 구분"
      >
        <button
          v-for="mode in dashboardModesFor(activeChannel)"
          :key="mode.id"
          type="button"
          class="inner-tab mode-tab"
          :class="{ active: activeDashboardMode === mode.id }"
          @click="setDashboardMode(mode.id)"
        >
          {{ mode.id === 'monthly' ? '월별 매출' : '일별 매출' }}
        </button>
      </nav>

      <header class="channel-head">
        <h3 class="channel-title">
          {{ activeDashboardMode === 'monthly' ? '월별 매출' : activeChannel.reportTitle }}
        </h3>
        <span class="channel-badge">{{ activeChannel.tabLabel }}</span>
      </header>

      <KeepAlive :max="8">
        <SalesDataView
          :key="`${activeChannel.id}-${activeDashboardMode}`"
          :scope="scopeFor(activeChannel.id)"
        />
      </KeepAlive>
      </template>
    </div>

  </section>

</template>



<style scoped>

.platform-dashboard :deep(.filters-panel) {

  margin-top: 0;

}



.inner-tabs {

  display: flex;

  gap: 6px;

  margin: 16px 0 12px;

  padding: 4px;

  background: #f1f5f9;

  border-radius: 10px;

  flex-wrap: wrap;

}



.mode-tabs {

  margin-bottom: 8px;

}



.inner-tab {

  padding: 8px 14px;

  border: none;

  border-radius: 8px;

  background: transparent;

  color: var(--muted);

  font-size: 0.875rem;

  font-weight: 500;

  cursor: pointer;

}



.mode-tab {

  min-width: 100px;

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

  margin: 8px 0;

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

</style>

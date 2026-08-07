<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  rows: { type: Array, default: () => [] },
  rowHeight: { type: Number, default: 40 },
  /** Phase 4: 판매 상세는 수백 건부터 가상화 (이전 200) */
  threshold: { type: Number, default: 80 },
  overscan: { type: Number, default: 10 },
})

const rootRef = ref(null)
const scrollTop = ref(0)
const viewportHeight = ref(520)

const enabled = computed(() => (props.rows?.length || 0) > props.threshold)

const range = computed(() => {
  const total = props.rows.length
  if (!enabled.value || !total) {
    return { start: 0, end: total, topPad: 0, bottomPad: 0 }
  }
  const start = Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - props.overscan)
  const count = Math.ceil(viewportHeight.value / props.rowHeight) + props.overscan * 2
  const end = Math.min(total, start + count)
  return {
    start,
    end,
    topPad: start * props.rowHeight,
    bottomPad: Math.max(0, (total - end) * props.rowHeight),
  }
})

const visibleRows = computed(() => props.rows.slice(range.value.start, range.value.end))

function onScroll(e) {
  scrollTop.value = e.target.scrollTop
}

function measure() {
  if (!rootRef.value) return
  viewportHeight.value = rootRef.value.clientHeight || 520
}

let ro
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    ro = new ResizeObserver(measure)
    ro.observe(rootRef.value)
  }
})

onUnmounted(() => {
  ro?.disconnect()
})

watch(
  () => props.rows.length,
  () => {
    scrollTop.value = 0
    if (rootRef.value) rootRef.value.scrollTop = 0
  },
)
</script>

<template>
  <div
    ref="rootRef"
    class="virtual-scroll-host"
    :class="{ 'is-virtual': enabled }"
    @scroll="onScroll"
  >
    <table class="virtual-inner-table" v-bind="$attrs">
      <slot name="colgroup" />
      <thead>
        <slot name="head" />
      </thead>
      <tbody>
        <template v-if="enabled">
          <tr v-if="range.topPad" class="virtual-spacer" aria-hidden="true">
            <td :style="{ height: `${range.topPad}px`, padding: 0, border: 'none' }" :colspan="99" />
          </tr>
          <template v-for="(row, i) in visibleRows" :key="row.id ?? `${range.start + i}`">
            <slot name="row" :row="row" :index="range.start + i" />
          </template>
          <tr v-if="range.bottomPad" class="virtual-spacer" aria-hidden="true">
            <td :style="{ height: `${range.bottomPad}px`, padding: 0, border: 'none' }" :colspan="99" />
          </tr>
        </template>
        <template v-else>
          <template v-for="(row, i) in rows" :key="row.id ?? i">
            <slot name="row" :row="row" :index="i" />
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.virtual-scroll-host {
  width: 100%;
}

.virtual-scroll-host.is-virtual {
  max-height: min(70vh, 640px);
  overflow: auto;
}

.virtual-inner-table {
  width: 100%;
  border-collapse: collapse;
}

.virtual-spacer td {
  background: transparent !important;
}
</style>

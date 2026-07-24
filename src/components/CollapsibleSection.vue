<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  /** 접힘 기본값 */
  defaultCollapsed: { type: Boolean, default: false },
  /** true면 접힌 동안 슬롯 미마운트 — 펼친 뒤에만 DOM·무거운 자식 렌더 */
  lazy: { type: Boolean, default: false },
  /** 바깥 card 클래스 추가 */
  cardClass: { type: String, default: '' },
})

const emit = defineEmits(['expand'])

const collapsed = ref(props.defaultCollapsed)
/** lazy일 때 한 번이라도 펼치면 이후 접어도 마운트 유지(재펼침 즉시) */
const contentMounted = ref(!props.lazy || !props.defaultCollapsed)

watch(
  () => props.defaultCollapsed,
  (v) => {
    collapsed.value = v
  },
)

watch(collapsed, (isCollapsed) => {
  if (!isCollapsed) {
    if (!contentMounted.value) {
      contentMounted.value = true
      emit('expand')
    }
  }
})

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <section class="card collapsible-section" :class="cardClass">
    <header class="collapsible-head">
      <div class="collapsible-titles">
        <h2 v-if="title" class="card-title">{{ title }}</h2>
        <p v-if="subtitle" class="standard-ref collapsible-sub">{{ subtitle }}</p>
      </div>
      <div class="collapsible-actions">
        <slot name="actions" />
        <button
          type="button"
          class="btn-collapse"
          :aria-expanded="!collapsed"
          :title="collapsed ? '펼치기' : '접기'"
          @click="toggle"
        >
          {{ collapsed ? '펼치기 ▼' : '접기 ▲' }}
        </button>
      </div>
    </header>
    <div v-if="!lazy || contentMounted" v-show="!collapsed" class="collapsible-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.collapsible-section {
  margin-bottom: 12px;
}

.collapsible-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.collapsible-titles {
  flex: 1;
  min-width: 0;
}

.collapsible-sub {
  margin: 4px 0 0;
}

.collapsible-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}

.collapsible-head .card-title {
  margin: 0;
}

.btn-collapse {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
  color: var(--muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.btn-collapse:hover {
  background: #f1f5f9;
  color: var(--text);
}

.collapsible-body {
  margin-top: 12px;
}
</style>

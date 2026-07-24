<script setup>
import { computed } from 'vue'
import { MAPPABLE_KEYS } from '../config/channelMappings'
import { CHANNELS, STANDARD_COLUMNS } from '../constants/standardColumns'

const props = defineProps({
  file: { type: Object, required: true },
})

const emit = defineEmits(['update:file'])

const labelByKey = Object.fromEntries(STANDARD_COLUMNS.map((c) => [c.key, c.label]))

const channel = computed({
  get: () => props.file.channel,
  set: (v) => update({ channel: v }),
})

const mapping = computed({
  get: () => props.file.mapping,
  set: () => {},
})

function update(patch) {
  emit('update:file', { ...props.file, ...patch })
}

function setMappingKey(key, value) {
  update({
    mapping: { ...props.file.mapping, [key]: value },
  })
}

function reapplyAuto() {
  emit('reapply-auto', props.file.id)
}
</script>

<template>
  <li class="file-item">
    <span class="name">{{ file.fileName }}</span>
    <span class="tag tag-ok">{{ file.rows.length }}행</span>
    <select v-model="channel">
      <option v-for="ch in CHANNELS" :key="ch" :value="ch">{{ ch }}</option>
    </select>
    <button type="button" class="btn btn-outline" @click="reapplyAuto">
      자동 매핑
    </button>
    <button type="button" class="btn btn-outline" @click="emit('remove', file.id)">
      제거
    </button>
  </li>
  <li class="mapping-detail">
    <div class="mapping-grid">
      <div v-for="key in MAPPABLE_KEYS" :key="key" class="mapping-row">
        <label :for="`${file.id}-${key}`">{{ labelByKey[key] }}</label>
        <select
          :id="`${file.id}-${key}`"
          :value="mapping[key] || ''"
          @change="setMappingKey(key, $event.target.value)"
        >
          <option value="">— 매핑 안 함 —</option>
          <option v-for="h in file.headers" :key="h" :value="h">{{ h }}</option>
        </select>
      </div>
    </div>
  </li>
</template>

<style scoped>
.mapping-detail {
  list-style: none;
  margin: -4px 0 12px;
  padding: 12px 16px;
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 8px;
}
</style>

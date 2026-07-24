<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  columns: { type: Array, required: true },
  record: { type: Object, default: null },
})

const emit = defineEmits(['close', 'save'])

const form = ref({})

watch(
  () => props.record,
  (rec) => {
    if (!rec) {
      form.value = {}
      return
    }
    form.value = { ...rec }
  },
  { immediate: true },
)

function submit() {
  const { id, recordType, uploadId, createdAt, updatedAt, sourceFileName, ...rest } = form.value
  emit('save', { id, fields: rest })
}

function close() {
  emit('close')
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="close">
    <div class="modal">
      <h3 class="modal-title">데이터 수정</h3>
      <form class="form-grid" @submit.prevent="submit">
        <div v-for="col in columns" :key="col.key" class="form-field">
          <label :for="col.key">{{ col.label }}</label>
          <input :id="col.key" v-model="form[col.key]" type="text" />
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" @click="close">취소</button>
          <button type="submit" class="btn btn-primary">저장</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.modal {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 20px;
  width: min(720px, 100%);
  max-height: 85vh;
  overflow: auto;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
}

.modal-title {
  margin: 0 0 16px;
  font-size: 1rem;
}

.form-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-field label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 4px;
}

.form-field input {
  width: 100%;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['files-selected', 'files-rejected'])
const isDragover = ref(false)
const inputRef = ref(null)

const ACCEPT = '.xlsx,.xls,.csv'

function pickFiles(files) {
  if (props.disabled) return
  const all = Array.from(files)
  const list = all.filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name))
  if (!list.length && all.length) {
    emit('files-rejected', {
      message: `지원하지 않는 파일입니다: ${all.map((f) => f.name).join(', ')} (.xlsx, .xls, .csv 만 가능)`,
    })
    return
  }
  if (list.length) emit('files-selected', list)
}

function onChange(e) {
  pickFiles(e.target.files)
  e.target.value = ''
}

function onDrop(e) {
  e.preventDefault()
  isDragover.value = false
  pickFiles(e.dataTransfer.files)
}

function openPicker() {
  if (props.disabled) return
  inputRef.value?.click()
}
</script>

<template>
  <div
    class="upload-zone"
    :class="{ dragover: isDragover, disabled: props.disabled }"
    @click="openPicker"
    @dragover.prevent="isDragover = true"
    @dragleave.prevent="isDragover = false"
    @drop="onDrop"
  >
    <input
      ref="inputRef"
      type="file"
      :accept="ACCEPT"
      :disabled="props.disabled"
      multiple
      @change="onChange"
    />
    <p><strong>엑셀 파일을 드래그하거나 클릭</strong>하여 업로드</p>
    <p class="standard-ref">지원: .xlsx, .xls, .csv · 여러 파일 동시 선택 가능</p>
  </div>
</template>

<style scoped>
.upload-zone.disabled {
  opacity: 0.55;
  pointer-events: none;
  cursor: not-allowed;
}
</style>

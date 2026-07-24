import { ref, computed } from 'vue'
import {
  PROFIT_LOSS_TEMPLATE_SCOPE,
  PROFIT_LOSS_TEMPLATE_KIND,
} from '../config/profitLossReport.js'
import {
  normalizeStoredProfitLossTemplate,
  parseProfitLossTemplateFile,
} from '../utils/profitLossTemplateParser.js'
import { fetchAppSetting, saveAppSetting } from '../services/appSettingsApi.js'

const LEGACY_STORAGE_KEY = 'essersales_profit_loss_template_v1'

/** @type {import('vue').Ref<import('../config/profitLossReport.js').ProfitLossTemplate | null>} */
const templateRef = ref(null)
let hydrated = false

function saveLocal(template) {
  try {
    if (template) localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(template))
    else localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    return normalizeStoredProfitLossTemplate(JSON.parse(raw))
  } catch {
    return null
  }
}

export const hasProfitLossTemplate = computed(() => Boolean(templateRef.value))

export function getProfitLossTemplateSnapshot() {
  if (!templateRef.value) return null
  return JSON.parse(JSON.stringify(templateRef.value))
}

/** @param {import('../config/profitLossReport.js').ProfitLossTemplate} template */
export async function saveProfitLossTemplate(template) {
  templateRef.value = template
  saveLocal(template)
  try {
    const res = await saveAppSetting(PROFIT_LOSS_TEMPLATE_SCOPE, PROFIT_LOSS_TEMPLATE_KIND, template)
    const normalized = normalizeStoredProfitLossTemplate(res?.data)
    if (normalized) {
      templateRef.value = normalized
      saveLocal(normalized)
    }
  } catch (err) {
    const msg = err?.message || ''
    if (msg.includes('연결') || msg.includes('API')) throw err
    console.warn('[profit_loss_template] 서버 저장 실패 — 로컬에만 보관:', msg)
  }
}

export async function clearProfitLossTemplate() {
  templateRef.value = null
  saveLocal(null)
  try {
    await saveAppSetting(PROFIT_LOSS_TEMPLATE_SCOPE, PROFIT_LOSS_TEMPLATE_KIND, null)
  } catch {
    /* 로컬 삭제만으로도 동작 */
  }
}

export async function hydrateProfitLossTemplate() {
  if (hydrated) return templateRef.value
  hydrated = true
  try {
    const res = await fetchAppSetting(PROFIT_LOSS_TEMPLATE_SCOPE, PROFIT_LOSS_TEMPLATE_KIND)
    const normalized = normalizeStoredProfitLossTemplate(res?.data)
    if (normalized) {
      templateRef.value = normalized
      saveLocal(normalized)
      return normalized
    }
  } catch {
    /* 서버 없으면 로컬 */
  }
  const local = loadLocal()
  if (local) templateRef.value = local
  return templateRef.value
}

/** @param {File} file */
export async function uploadProfitLossTemplateFile(file) {
  const parsed = await parseProfitLossTemplateFile(file)
  await saveProfitLossTemplate(parsed)
  return parsed
}

export function useProfitLossTemplate() {
  return {
    template: templateRef,
    hasTemplate: hasProfitLossTemplate,
    hydrateProfitLossTemplate,
    uploadProfitLossTemplateFile,
    saveProfitLossTemplate,
    clearProfitLossTemplate,
    getProfitLossTemplateSnapshot,
  }
}

/**
 * Phase 4 — Vite worker로 플랫폼 엑셀 파싱 (실패 시 메인 스레드 fallback)
 */
import ExcelParseWorker from '../workers/excelParse.worker.js?worker'
import {
  readPlatformDailyFile,
  readPlatformMonthlyFile,
  readPlatformPeriodFile,
} from './platformOrderParser.js'

let seq = 0

/**
 * @param {'platform_daily' | 'platform_monthly' | 'platform_period'} type
 * @param {File} file
 * @param {string} platform
 */
async function parseInWorker(type, file, platform) {
  const id = ++seq
  const worker = new ExcelParseWorker()
  const buffer = await file.arrayBuffer()

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('엑셀 파싱 시간 초과'))
    }, 120_000)

    worker.onmessage = (e) => {
      if (e.data?.id !== id) return
      clearTimeout(timer)
      worker.terminate()
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error || '파싱 실패'))
    }
    worker.onerror = (err) => {
      clearTimeout(timer)
      worker.terminate()
      reject(err?.message ? new Error(err.message) : err)
    }
    worker.postMessage({ id, type, buffer, fileName: file.name, platform }, [buffer])
  })
}

async function withFallback(type, file, platform, mainThreadFn) {
  try {
    return await parseInWorker(type, file, platform)
  } catch (workerErr) {
    console.warn('엑셀 Worker 파싱 실패, 메인 스레드 fallback:', workerErr?.message || workerErr)
    return mainThreadFn(file, platform)
  }
}

export function parsePlatformDailyInWorker(file, platform) {
  return withFallback('platform_daily', file, platform, readPlatformDailyFile)
}

export function parsePlatformMonthlyInWorker(file, platform) {
  return withFallback('platform_monthly', file, platform, readPlatformMonthlyFile)
}

export function parsePlatformPeriodInWorker(file, platform) {
  return withFallback('platform_period', file, platform, readPlatformPeriodFile)
}

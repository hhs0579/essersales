/**
 * Phase 4 — 플랫폼 엑셀 파싱을 워커 스레드로 오프로드 (메인 UI 정지 완화)
 */
import {
  readPlatformDailyBuffer,
  readPlatformMonthlyBuffer,
  readPlatformPeriodBuffer,
} from '../utils/platformOrderParser.js'

self.onmessage = async (event) => {
  const { id, type, buffer, fileName, platform } = event.data || {}
  try {
    let result
    if (type === 'platform_daily') {
      result = await readPlatformDailyBuffer(buffer, fileName, platform)
    } else if (type === 'platform_monthly') {
      result = await readPlatformMonthlyBuffer(buffer, fileName, platform)
    } else if (type === 'platform_period') {
      result = await readPlatformPeriodBuffer(buffer, fileName, platform)
    } else {
      throw new Error(`unsupported parse type: ${type}`)
    }
    self.postMessage({ id, ok: true, result })
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message || String(e) })
  }
}

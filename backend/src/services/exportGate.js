/**
 * 통합·표 export 공용 동시 1건 게이트 (NAS 메모리 OOM 방지)
 * 비정상으로 해제되지 않은 잠금은 STALE_MS 후 자동 회수
 */
const STALE_MS = 10 * 60 * 1000

/** @type {{ label: string, since: number } | null} */
let holder = null

/**
 * @param {string} label
 * @returns {() => void} release
 */
export function acquireExportSlot(label) {
  if (holder && Date.now() - holder.since < STALE_MS) {
    const err = new Error('다른 엑셀 생성이 진행 중입니다. 잠시 후 다시 시도해 주세요.')
    err.status = 503
    err.code = 'EXPORT_BUSY'
    throw err
  }
  if (holder) console.warn('[export] stale slot reclaimed', holder)
  const mine = { label, since: Date.now() }
  holder = mine
  return () => {
    if (holder === mine) holder = null
  }
}

/**
 * 클라이언트가 연결을 끊었으면 남은 작업을 중단
 * @param {(() => boolean) | undefined} isAborted
 */
export function throwIfClientGone(isAborted) {
  if (isAborted?.()) {
    const err = new Error('클라이언트 연결이 끊겨 export를 중단했습니다.')
    err.status = 499
    err.code = 'CLIENT_GONE'
    throw err
  }
}

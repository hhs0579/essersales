import { CHANNELS } from './standardColumns.js'

/** 플랫폼별 일일 엑셀 업로드에 사용하는 채널 목록 */
export const PLATFORMS = [...CHANNELS, '기타']

export const PLATFORM_OPTIONS = [
  { value: '', label: '전체 플랫폼 (취합)' },
  ...PLATFORMS.map((p) => ({ value: p, label: p })),
]

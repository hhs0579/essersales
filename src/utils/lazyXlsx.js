/** xlsx — 업로드·다운로드 시에만 로드 */

let cached = null

export async function loadXlsx() {
  if (!cached) {
    cached = await import('xlsx')
  }
  return cached
}

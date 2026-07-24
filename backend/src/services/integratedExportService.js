import { Worker } from 'worker_threads'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @param {Record<string, string | undefined>} query
 */
export async function buildIntegratedExport(query = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(join(__dirname, 'exportWorker.js'))
    worker.postMessage({ query })
    worker.on('message', (result) => {
      if (result.error) {
        const err = new Error(result.error)
        err.stack = result.stack
        // If it was a NO_DATA error, we need to pass the status code back
        if (result.error.includes('export할 데이터가 없습니다')) {
          err.status = 404
          err.code = 'NO_DATA'
        }
        reject(err)
      } else {
        resolve(result)
      }
    })
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`))
    })
  })
}

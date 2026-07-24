import { deleteUploadById } from '../repositories/uploadsRepository.js'

/**
 * legacy DELETE /api/uploads/:id 와 동일:
 * 1) 해당 upload_id sales_records hard delete
 * 2) uploads row hard delete (upload_files 는 FK CASCADE)
 *
 * @param {string} id
 */
export async function deleteUpload(id) {
  const result = await deleteUploadById(id)
  if (!result) {
    const err = new Error('not found')
    err.status = 404
    err.code = 'NOT_FOUND'
    throw err
  }
  return {
    ok: true,
    id,
    deleted: true,
    recordsDeleted: result.recordsDeleted,
  }
}

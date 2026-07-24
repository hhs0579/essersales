import multer from 'multer'

const MAX_BYTES = 50 * 1024 * 1024

export const excelUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter(_req, file, cb) {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      cb(null, true)
    } else {
      cb(new Error('지원하지 않는 파일 형식 (.xlsx, .xls, .csv 만 가능)'))
    }
  },
}).single('file')

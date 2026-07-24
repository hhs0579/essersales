/**
 * Phase 0 environment configuration.
 * Supports individual DB_* vars or DATABASE_URL.
 */

function required(name, value) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function loadEnv() {
  const dbHost = process.env.DB_HOST || 'localhost'
  const dbPort = Number(process.env.DB_PORT || 5432)
  const dbName = process.env.DB_NAME || 'essersales'
  const dbUser = process.env.DB_USER || 'essersales'
  const dbPassword = process.env.DB_PASSWORD ?? 'essersales_dev'

  const databaseUrl =
    process.env.DATABASE_URL ||
    `postgres://${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    apiPort: Number(process.env.API_PORT || 3001),
    db: {
      host: dbHost,
      port: dbPort,
      database: dbName,
      user: dbUser,
      password: dbPassword,
      connectionString: databaseUrl,
    },
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    exportDir: process.env.EXPORT_DIR || './exports',
  }
}

export function validateEnvForStartup(env) {
  required('DB_NAME', env.db.database)
  required('DB_USER', env.db.user)
  required('DB_PASSWORD', env.db.password)
  return env
}

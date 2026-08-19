import pg from 'pg'

export type DbPoolConfig = {
  connectionTimeoutMillis: number
  databaseUrl: string
  idleTimeoutMillis: number
  max: number
  ssl: boolean
}

export function createDbPool(config: DbPoolConfig) {
  return new pg.Pool({
    application_name: 'cwi-backend',
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,
    max: config.max,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
  })
}

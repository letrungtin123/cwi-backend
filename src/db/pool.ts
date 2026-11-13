import pg from 'pg'

export type DbPoolConfig = {
  connectionTimeoutMillis: number
  databaseUrl: string
  idleTimeoutMillis: number
  max: number
  // Called when an idle pooled connection fails (e.g. Postgres restarts). Without a listener pg
  // re-throws it and the whole process exits.
  onError: (error: Error) => void
  ssl: boolean
}

// A single statement may run at most this long; a stuck query then fails instead of holding a pool
// slot after the client (nginx gives up at 65 s) has gone.
const STATEMENT_TIMEOUT_MS = 30_000
// A transaction left open by a bug is closed by Postgres instead of holding locks forever.
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000

export function createDbPool(config: DbPoolConfig) {
  const pool = new pg.Pool({
    application_name: 'cwi-backend',
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    idleTimeoutMillis: config.idleTimeoutMillis,
    max: config.max,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  })
  pool.on('error', config.onError)
  return pool
}

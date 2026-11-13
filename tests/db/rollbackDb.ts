import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config({ path: process.env.CWI_ENV_FILE || '.env' })

// Database tests run against a real local PostgreSQL, inside one transaction that is always rolled
// back: nothing they write is ever committed.
//
// Repositories open their own transactions (BEGIN/COMMIT through pool.connect()). Here those become
// savepoints inside the outer transaction, so a repository COMMIT can never commit test data.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function localDatabaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) return null
  const host = new URL(url).hostname
  // Never touch a remote database, whatever the .env says.
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Database tests only run against a local database, not "${host}".`)
  return url
}

export async function databaseReachable() {
  const url = localDatabaseUrl()
  if (!url) return false
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 })
  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => undefined)
  }
}

export type RollbackDb = {
  close: () => Promise<void>
  pool: pg.Pool
}

export async function openRollbackDb(): Promise<RollbackDb> {
  const url = localDatabaseUrl()
  if (!url) throw new Error('DATABASE_URL is not set.')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  await client.query('BEGIN')
  await client.query("SET LOCAL statement_timeout = '30s'")

  let depth = 0
  // One connection serves every query, so queries the repository sends in parallel are run one
  // after another (pg no longer accepts overlapping queries on one client).
  let queue: Promise<unknown> = Promise.resolve()
  function query(text: unknown, params?: unknown[]) {
    const run = queue.then(() => runQuery(text, params))
    queue = run.catch(() => undefined)
    return run
  }

  async function runQuery(text: unknown, params?: unknown[]) {
    if (typeof text === 'string') {
      const command = text.trim().toUpperCase()
      if (command === 'BEGIN') {
        depth += 1
        return client.query(`SAVEPOINT repo_tx_${depth}`)
      }
      if (command === 'COMMIT') {
        const result = await client.query(`RELEASE SAVEPOINT repo_tx_${depth}`)
        depth -= 1
        return result
      }
      if (command === 'ROLLBACK') {
        const result = await client.query(`ROLLBACK TO SAVEPOINT repo_tx_${depth}`)
        await client.query(`RELEASE SAVEPOINT repo_tx_${depth}`)
        depth -= 1
        return result
      }
    }
    return client.query(text as string, params)
  }

  const scopedClient = { query, release: () => undefined }
  const pool = { connect: async () => scopedClient, query }

  return {
    close: async () => {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    },
    pool: pool as unknown as pg.Pool,
  }
}

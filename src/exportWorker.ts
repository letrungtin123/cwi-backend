import { randomUUID } from 'node:crypto'
import { env } from './config/env.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { PgExportRepository } from './modules/exports/exportRepository.js'
import { ExportWorkbookService } from './modules/exports/exportWorkbook.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import { installProcessGuards, logIdlePoolError } from './processGuards.js'

const logger = createLogger(env.logLevel)
installProcessGuards(logger, 'cwi-export-worker')
const workerId = 'export-worker-' + randomUUID()
let stopping = false

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

async function run() {
  if (!env.adminExportEnabled) {
    logger.info('Admin export worker is disabled by ADMIN_EXPORT_ENABLED.')
    while (!stopping) await sleep(60_000)
    return
  }

  const pool = createDbPool({
    connectionTimeoutMillis: env.dbConnectionTimeoutMs,
    databaseUrl: env.databaseUrl,
    idleTimeoutMillis: env.dbIdleTimeoutMs,
    max: Math.max(2, Math.min(env.dbPoolMax, 5)),
    onError: logIdlePoolError(logger, 'cwi-export-worker'),
    ssl: env.dbSsl,
  })
  const repository = new PgExportRepository(pool)
  const storage = new ReportAssetStorage({
    bucket: env.reportStorageBucket,
    serviceRoleKey: env.supabaseServiceRoleKey,
    storageUrl: env.supabaseStorageUrl,
    timeoutMs: env.reportStorageUploadTimeoutMs,
  })
  const workbookService = new ExportWorkbookService(repository, storage)

  try {
    while (!stopping) {
      try {
        await runOnce()
      } catch (error) {
        // A database or storage hiccup must not end the worker; wait and try again.
        logger.error({ error }, 'Admin export worker iteration failed')
        await sleep(Math.max(env.exportWorkerLoopIntervalMs, 5_000))
      }
    }
  } finally {
    await pool.end()
  }

  async function runOnce() {
    const expiredPaths = await repository.expireJobs()
    for (const expiredPath of expiredPaths) {
      try {
        await storage.removeFile(expiredPath)
      } catch (error) {
        if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 404) continue
        logger.warn({ error, storagePath: expiredPath }, 'Expired export file cleanup failed')
      }
    }
    const job = await repository.claimNext(workerId, env.exportWorkerLockMs, env.exportWorkerMaxAttempts)
    if (!job) {
      await sleep(env.exportWorkerLoopIntervalMs)
      return
    }

    try {
      const result = await workbookService.generate(job)
      await repository.markCompleted({
        fileName: result.fileName,
        fileSize: result.fileSize,
        id: job.id,
        rowCount: result.rowCount,
        storagePath: result.storagePath,
      })
      logger.info({ exportId: job.id, rowCount: result.rowCount }, 'Admin export completed')
    } catch (error) {
      const retry = job.attempt < env.exportWorkerMaxAttempts
      const message = error instanceof Error ? error.message : 'Export generation failed.'
      await repository.markFailed({
        code: 'export_generation_failed',
        id: job.id,
        message,
        retry,
      })
      logger.error({ error, exportId: job.id, retry }, 'Admin export failed')
    }
  }
}

async function shutdown(signal: string) {
  logger.info({ signal }, 'Stopping admin export worker')
  stopping = true
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

void run().catch((error: unknown) => {
  logger.error({ error }, 'Admin export worker stopped unexpectedly')
  process.exitCode = 1
})







import { randomUUID } from 'node:crypto'
import { env } from './config/env.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import { ReportPdfRenderer } from './modules/reports/reportPdfRenderer.js'
import { PgReportRepository } from './modules/reports/reportRepository.js'
import { ReportServiceClient } from './modules/reports/reportServiceClient.js'
import { ReportWorker } from './modules/reports/reportWorker.js'

const logger = createLogger(env.logLevel)
let stopping = false

if (!env.reportServiceEnabled) {
  logger.info('Report generation worker is disabled by REPORT_SERVICE_ENABLED.')
  setInterval(() => undefined, 60_000)
} else {
  const pool = createDbPool({
    connectionTimeoutMillis: env.dbConnectionTimeoutMs,
    databaseUrl: env.databaseUrl,
    idleTimeoutMillis: env.dbIdleTimeoutMs,
    max: Math.max(2, Math.min(env.dbPoolMax, 5)),
    ssl: env.dbSsl,
  })
  const repository = new PgReportRepository(pool)
  const assetStorage = new ReportAssetStorage({
    bucket: env.reportStorageBucket,
    serviceRoleKey: env.supabaseServiceRoleKey,
    storageUrl: env.supabaseStorageUrl,
    timeoutMs: env.reportStorageUploadTimeoutMs,
  })
  const worker = new ReportWorker({
    assetStorage,
    client: new ReportServiceClient({ baseUrl: env.reportServiceBaseUrl, timeoutMs: env.reportServiceTimeoutMs }),
    config: {
      autoEmailEnabled: env.reportAutoEmailEnabled,
      enabled: true,
      generatedPdfFileName: env.reportGeneratedPdfFileName,
      generatedStorageBucket: env.reportStorageBucket,
      initialPollDelayMs: env.reportWorkerInitialPollDelayMs,
      lockMs: env.reportWorkerLockMs,
      loopIntervalMs: env.reportWorkerLoopIntervalMs,
      maxAttempts: env.reportWorkerMaxAttempts,
      maxPollDelayMs: env.reportWorkerMaxPollDelayMs,
    },
    logger,
    pdfRenderer: new ReportPdfRenderer({ browserPath: env.pdfBrowserPath, disableSandbox: env.pdfDisableSandbox, renderTimeoutMs: env.pdfRenderTimeoutMs, storageDir: env.reportStorageDir }),
    repository,
  })

  async function shutdown(signal: string) {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'Shutting down report generation worker')
    worker.stop()
    await pool.end()
    process.exit(0)
  }

  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  logger.info({ workerId: `report-generation-${process.pid}-${randomUUID()}` }, 'Report generation process starting')
  worker.start()
}

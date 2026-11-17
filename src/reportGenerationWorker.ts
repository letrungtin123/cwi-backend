import { randomUUID } from 'node:crypto'
import { env } from './config/env.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import { ReportPdfRenderer } from './modules/reports/reportPdfRenderer.js'
import { PgReportRepository } from './modules/reports/reportRepository.js'
import { ReportServiceClient } from './modules/reports/reportServiceClient.js'
import { ReportWorker } from './modules/reports/reportWorker.js'
import { installProcessGuards, logIdlePoolError } from './processGuards.js'

const logger = createLogger(env.logLevel)
installProcessGuards(logger, 'cwi-report-generation-worker')
let stopping = false
// On SIGTERM, wait this long for the report being generated right now (PM2 kill_timeout is 30 s).
const SHUTDOWN_DRAIN_MS = 25_000

if (!env.reportServiceEnabled) {
  logger.info('Report generation worker is disabled by REPORT_SERVICE_ENABLED.')
  setInterval(() => undefined, 60_000)
} else {
  const pool = createDbPool({
    connectionTimeoutMillis: env.dbConnectionTimeoutMs,
    databaseUrl: env.databaseUrl,
    idleTimeoutMillis: env.dbIdleTimeoutMs,
    max: Math.max(2, Math.min(env.dbPoolMax, 5)),
    onError: logIdlePoolError(logger, 'cwi-report-generation-worker'),
    ssl: env.dbSsl,
  })
  const repository = new PgReportRepository(pool)
  // The global stop follows .env (REPORT_AI_CALLS_PAUSED). Only this worker writes it, never the
  // API: during a release the installer test-starts the new API while the previous release's
  // worker is still running, and that older worker must not see the switch change under it
  // (2026-11-17 it sent 3 jobs of a quarter that was switched off). The worker starts only after
  // the value is applied, so its first round already sees it.
  const globalPauseApplied = repository.syncGlobalPause(env.reportAiCallsPaused)
    .then((changed) => { if (changed) logger.warn({ reportAiCallsPaused: env.reportAiCallsPaused }, 'Global report generation stop updated from REPORT_AI_CALLS_PAUSED') })
    .catch((error: unknown) => logger.error({ error }, 'Could not apply REPORT_AI_CALLS_PAUSED'))
  const assetStorage = new ReportAssetStorage({
    bucket: env.reportStorageBucket,
    serviceRoleKey: env.supabaseServiceRoleKey,
    storageUrl: env.supabaseStorageUrl,
    timeoutMs: env.reportStorageUploadTimeoutMs,
  })
  const worker = new ReportWorker({
    assetStorage,
    client: new ReportServiceClient({ baseUrl: env.reportServiceBaseUrl, englishTimeoutMs: env.reportServiceEnglishTimeoutMs, timeoutMs: env.reportServiceTimeoutMs }),
    config: {
      autoEmailEnabled: env.reportAutoEmailEnabled,
      debugDumpHtml: env.reportDebugDumpHtml,
      debugHtmlDir: env.reportDebugHtmlDir,
      enabled: true,
      generatedPdfFileName: env.reportGeneratedPdfFileName,
      generatedPdfFileNameEn: env.reportGeneratedPdfFileNameEn,
      generatedStorageBucket: env.reportStorageBucket,
      initialPollDelayMs: env.reportWorkerInitialPollDelayMs,
      lockMs: env.reportWorkerLockMs,
      loopIntervalMs: env.reportWorkerLoopIntervalMs,
      maxAiInFlight: env.reportWorkerMaxAiInFlight,
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
    await Promise.race([worker.stop(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS))])
    await pool.end()
    process.exit(0)
  }

  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  logger.info({ workerId: `report-generation-${process.pid}-${randomUUID()}` }, 'Report generation process starting')
  void globalPauseApplied.then(() => { if (!stopping) worker.start() })
}

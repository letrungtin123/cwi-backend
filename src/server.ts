import { env } from './config/env.js'
import type { RuntimeConfig } from './config/runtime.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { createApp } from './app.js'
import { PgAdminRepository } from './modules/admin/adminRepository.js'
import { PgAuthRepository } from './modules/auth/authRepository.js'
import { AuthService } from './modules/auth/authService.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import { ReportPdfRenderer } from './modules/reports/reportPdfRenderer.js'
import { PgReportRepository } from './modules/reports/reportRepository.js'
import { ReportServiceClient } from './modules/reports/reportServiceClient.js'
import { ReportWorker } from './modules/reports/reportWorker.js'
import { PgSurveyRepository } from './modules/survey/surveyRepository.js'
import { SurveyService } from './modules/survey/surveyService.js'

const logger = createLogger(env.logLevel)
const pool = createDbPool({
  connectionTimeoutMillis: env.dbConnectionTimeoutMs,
  databaseUrl: env.databaseUrl,
  idleTimeoutMillis: env.dbIdleTimeoutMs,
  max: env.dbPoolMax,
  ssl: env.dbSsl,
})

const config: RuntimeConfig = {
  auth: {
    cookieDomain: env.authCookieDomain,
    cookieSameSite: env.authCookieSameSite,
    cookieSecure: env.authCookieSecure,
    csrfCookieName: env.authCsrfCookieName,
    loginRateLimitMax: env.authLoginRateLimitMax,
    loginRateLimitWindowMs: env.authLoginRateLimitWindowMs,
    sessionCookieName: env.authSessionCookieName,
    sessionTtlSeconds: env.authSessionTtlSeconds,
    supabaseAnonKey: env.supabaseAnonKey,
    supabaseAuthUrl: env.supabaseAuthUrl,
  },
  corsAllowedOrigins: env.corsAllowedOrigins,
  ipHashSecret: env.ipHashSecret,
  nodeEnv: env.nodeEnv,
  rateLimitMax: env.rateLimitMax,
  rateLimitWindowMs: env.rateLimitWindowMs,
  requestBodyLimit: env.requestBodyLimit,
  trustProxy: env.trustProxy,
}

const surveyRepository = new PgSurveyRepository(pool)
const adminRepository = new PgAdminRepository(pool)
const reportRepository = new PgReportRepository(pool)
const authRepository = new PgAuthRepository(pool)
const authService = new AuthService(authRepository, config.auth)
const reportClient = new ReportServiceClient({
  baseUrl: env.reportServiceBaseUrl,
  timeoutMs: env.reportServiceTimeoutMs,
})
const reportAssetStorage = new ReportAssetStorage({
  bucket: env.reportStorageBucket,
  serviceRoleKey: env.supabaseServiceRoleKey,
  storageUrl: env.supabaseStorageUrl,
  timeoutMs: env.reportStorageUploadTimeoutMs,
})
const reportPdfRenderer = new ReportPdfRenderer({
  browserPath: env.pdfBrowserPath,
  renderTimeoutMs: env.pdfRenderTimeoutMs,
  storageDir: env.reportStorageDir,
})
const reportWorker = new ReportWorker({
  client: reportClient,
  config: {
    enabled: env.reportServiceEnabled,
    initialPollDelayMs: env.reportWorkerInitialPollDelayMs,
    lockMs: env.reportWorkerLockMs,
    loopIntervalMs: env.reportWorkerLoopIntervalMs,
    maxAttempts: env.reportWorkerMaxAttempts,
    maxPollDelayMs: env.reportWorkerMaxPollDelayMs,
  },
  logger: logger.child({ module: 'report-worker' }),
  assetStorage: reportAssetStorage,
  pdfRenderer: reportPdfRenderer,
  repository: reportRepository,
})
const surveyService = new SurveyService(surveyRepository, {
  enabled: env.reportServiceEnabled,
  participantPhonePlaceholder: env.reportParticipantPhonePlaceholder,
})
const app = createApp({ adminRepository, authService, config, logger, reportAssetStorage, reportRepository, surveyService })

const server = app.listen(env.port, env.host, () => {
  logger.info({ host: env.host, port: env.port }, 'CWI backend listening')
  reportWorker.start()
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down CWI backend')
  reportWorker.stop()
  server.close(async (error) => {
    if (error) {
      logger.error({ error }, 'HTTP server shutdown failed')
      process.exitCode = 1
    }

    await pool.end()
    process.exit()
  })
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
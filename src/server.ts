import { env } from './config/env.js'
import type { RuntimeConfig } from './config/runtime.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { createApp } from './app.js'
import { PgAdminRepository } from './modules/admin/adminRepository.js'
import { PgExportRepository } from './modules/exports/exportRepository.js'
import { PgAuthRepository } from './modules/auth/authRepository.js'
import { AuthService } from './modules/auth/authService.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import { PgReportRepository } from './modules/reports/reportRepository.js'
import { ReportAccessTokenService } from './modules/reports/reportAccessToken.js'
import { PgRoundtableRepository } from './modules/roundtable/roundtableRepository.js'
import { RoundtableService } from './modules/roundtable/roundtableService.js'
import { PgSurveyRepository } from './modules/survey/surveyRepository.js'
import { SurveyService } from './modules/survey/surveyService.js'
import { PgReportDeliveryRepository } from './modules/reportDelivery/reportDeliveryRepository.js'
import { SmtpReportMailer } from './modules/reportDelivery/smtpMailer.js'

const logger = createLogger(env.logLevel)
const pool = createDbPool({
  connectionTimeoutMillis: env.dbConnectionTimeoutMs,
  databaseUrl: env.databaseUrl,
  idleTimeoutMillis: env.dbIdleTimeoutMs,
  max: env.dbPoolMax,
  ssl: env.dbSsl,
})

const config: RuntimeConfig = {
  adminCursorSecret: env.adminCursorSecret,
  adminExportEnabled: env.adminExportEnabled,
  reportDeliveryEnabled: env.reportDeliveryEnabled,
  reportDeliveryBucket: env.reportDeliveryBucket,
  reportStorageBucket: env.reportStorageBucket,
  reportAutoEmailEnabled: env.reportAutoEmailEnabled,
  reportPublicTokenSecret: env.reportPublicTokenSecret,
  reportPublicTokenTtlSeconds: env.reportPublicTokenTtlSeconds,
  reportUploadMaxBytes: env.reportUploadMaxBytes,
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
const roundtableRepository = new PgRoundtableRepository(pool)
const adminRepository = new PgAdminRepository(pool, config.adminCursorSecret)
const exportRepository = new PgExportRepository(pool)
const reportRepository = new PgReportRepository(pool)
const authRepository = new PgAuthRepository(pool)
const authService = new AuthService(authRepository, config.auth)
const reportAssetStorage = new ReportAssetStorage({
  bucket: env.reportStorageBucket,
  serviceRoleKey: env.supabaseServiceRoleKey,
  storageUrl: env.supabaseStorageUrl,
  timeoutMs: env.reportStorageUploadTimeoutMs,
})
const submissionReportStorage = new ReportAssetStorage({
  bucket: env.reportDeliveryBucket,
  serviceRoleKey: env.supabaseServiceRoleKey,
  storageUrl: env.supabaseStorageUrl,
  timeoutMs: env.reportStorageUploadTimeoutMs,
})
const reportDeliveryRepository = new PgReportDeliveryRepository(pool, env.reportStorageBucket)
const reportMailer = new SmtpReportMailer({
  authMode: env.mailAuthMode,
  fromAddress: env.mailFromAddress,
  fromName: env.mailFromName,
  host: env.mailSmtpHost,
  connectionTimeoutMs: env.mailSmtpConnectionTimeoutMs,
  greetingTimeoutMs: env.mailSmtpGreetingTimeoutMs,
  maxConnections: env.mailSmtpMaxConnections,
  maxMessages: env.mailSmtpMaxMessages,
  m365ClientId: env.mailM365ClientId,
  m365ClientSecret: env.mailM365ClientSecret,
  m365Scope: env.mailM365Scope,
  m365TenantId: env.mailM365TenantId,
  password: env.mailSmtpPassword,
  port: env.mailSmtpPort,
  replyTo: env.mailReplyTo,
  requireTls: env.mailSmtpRequireTls,
  secure: env.mailSmtpSecure,
  tokenTimeoutMs: env.mailM365TokenTimeoutMs,
  user: env.mailSmtpUser,
  socketTimeoutMs: env.mailSmtpSocketTimeoutMs,
})

const reportAccessTokenService = new ReportAccessTokenService(config.reportPublicTokenSecret, config.reportPublicTokenTtlSeconds)
const surveyService = new SurveyService(surveyRepository, { reportAccessTokenService, reportServiceEnabled: env.reportServiceEnabled })
const roundtableService = new RoundtableService(roundtableRepository)
const app = createApp({ adminRepository, authService, config, exportRepository, logger, pool, reportAccessTokenService, reportAssetStorage, submissionReportStorage, reportDeliveryRepository, reportMailer, reportRepository, roundtableService, surveyService })

const server = app.listen(env.port, env.host, () => {
  logger.info({
    host: env.host,
    port: env.port,
    reportAutoEmailEnabled: env.reportAutoEmailEnabled,
    reportDeliveryEnabled: env.reportDeliveryEnabled,
    reportServiceEnabled: env.reportServiceEnabled,
  }, 'CWI backend listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down CWI backend')
  server.close(async (error) => {
    if (error) {
      logger.error({ error }, 'HTTP server shutdown failed')
      process.exitCode = 1
    }
    await pool.end()
    reportMailer.close()
    process.exit()
  })
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

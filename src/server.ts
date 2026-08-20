import { env } from './config/env.js'
import type { RuntimeConfig } from './config/runtime.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { createApp } from './app.js'
import { PgAdminRepository } from './modules/admin/adminRepository.js'
import { PgAuthRepository } from './modules/auth/authRepository.js'
import { AuthService } from './modules/auth/authService.js'
import { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import { PgReportRepository } from './modules/reports/reportRepository.js'
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
const reportAssetStorage = new ReportAssetStorage({
  bucket: env.reportStorageBucket,
  serviceRoleKey: env.supabaseServiceRoleKey,
  storageUrl: env.supabaseStorageUrl,
  timeoutMs: env.reportStorageUploadTimeoutMs,
})

// Temporarily disabled: do not enqueue or call the cwi-ai report service.
const surveyService = new SurveyService(surveyRepository)
const app = createApp({ adminRepository, authService, config, logger, reportAssetStorage, reportRepository, surveyService })

const server = app.listen(env.port, env.host, () => {
  logger.info({ host: env.host, port: env.port }, 'CWI backend listening')
  // cwi-ai report worker is intentionally disabled.
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down CWI backend')
  // cwi-ai report worker is intentionally disabled.
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
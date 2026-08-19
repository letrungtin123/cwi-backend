import { env } from './config/env.js'
import type { RuntimeConfig } from './config/runtime.js'
import { createDbPool } from './db/pool.js'
import { createLogger } from './logger.js'
import { createApp } from './app.js'
import { PgAdminRepository } from './modules/admin/adminRepository.js'
import { PgAuthRepository } from './modules/auth/authRepository.js'
import { AuthService } from './modules/auth/authService.js'
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
const authRepository = new PgAuthRepository(pool)
const authService = new AuthService(authRepository, config.auth)
const surveyService = new SurveyService(surveyRepository)
const app = createApp({ adminRepository, authService, config, logger, surveyService })

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'CWI backend listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down CWI backend')
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
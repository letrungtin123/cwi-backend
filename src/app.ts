import { randomUUID } from 'node:crypto'
import compression from 'compression'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { Logger } from 'pino'
import pinoHttpImport from 'pino-http'
import type pg from 'pg'
import { z } from 'zod'
import type { RuntimeConfig } from './config/runtime.js'
import { HttpError, isHttpError } from './http/errors.js'
import { createAdminRouter } from './modules/admin/adminRoutes.js'
import type { PgAdminRepository } from './modules/admin/adminRepository.js'
import type { PgExportRepository } from './modules/exports/exportRepository.js'
import { createAuthRouter } from './modules/auth/authRoutes.js'
import type { AuthService } from './modules/auth/authService.js'
import type { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import type { ReportAccessTokenService } from './modules/reports/reportAccessToken.js'
import { createReportDeliveryRouter } from './modules/reportDelivery/reportDeliveryRoutes.js'
import type { PgReportDeliveryRepository } from './modules/reportDelivery/reportDeliveryRepository.js'
import type { SmtpReportMailer } from './modules/reportDelivery/smtpMailer.js'
import type { PgReportRepository } from './modules/reports/reportRepository.js'
import { createPublicReportRouter } from './modules/reports/publicReportRoutes.js'
import { createRoundtableRouter } from './modules/roundtable/roundtableRoutes.js'
import type { RoundtableService } from './modules/roundtable/roundtableService.js'
import { createSurveyRouter } from './modules/survey/surveyRoutes.js'
import type { SurveyService } from './modules/survey/surveyService.js'

export type AppDependencies = {
  adminRepository: PgAdminRepository
  authService: AuthService
  config: RuntimeConfig
  exportRepository: PgExportRepository
  logger: Logger
  pool: pg.Pool
  reportAssetStorage: ReportAssetStorage
  reportAccessTokenService: ReportAccessTokenService
  submissionReportStorage: ReportAssetStorage
  reportDeliveryRepository: PgReportDeliveryRepository
  reportMailer: SmtpReportMailer
  reportRepository: PgReportRepository
  roundtableService: RoundtableService
  surveyService: SurveyService
}

function isAllowedDevOrigin(origin: string) {
  return /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(origin)
}

function createCorsOptions(config: RuntimeConfig): cors.CorsOptions {
  const allowedOrigins = new Set(config.corsAllowedOrigins)
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true)
        return
      }
      if (allowedOrigins.has(origin) || (config.nodeEnv !== 'production' && isAllowedDevOrigin(origin))) {
        callback(null, true)
        return
      }
      callback(new HttpError(403, 'cors_origin_denied', 'CORS origin is not allowed.'))
    },
  }
}

function handleNotFound(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'not_found', 'Route not found.'))
}

function requestBodyError(error: unknown) {
  if (error instanceof z.ZodError) {
    return new HttpError(400, 'invalid_request', 'Request payload is invalid.', {
      issues: error.issues.map((issue) => ({ code: issue.code, message: issue.message, path: issue.path })),
    })
  }
  if (error instanceof SyntaxError && (error as SyntaxError & { type?: string }).type === 'entity.parse.failed') {
    return new HttpError(400, 'invalid_json', 'Request body contains invalid JSON.')
  }
  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    return new HttpError(413, 'request_too_large', 'Request body is too large.')
  }
  return null
}

function handleError(logger: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const safeError = requestBodyError(error) ?? error
    if (isHttpError(safeError)) {
      res.status(safeError.statusCode).json({
        error: { code: safeError.code, details: safeError.details, message: safeError.message, requestId: req.id },
      })
      return
    }
    logger.error({ error, requestId: req.id }, 'Unhandled request error')
    res.status(500).json({
      error: { code: 'internal_server_error', message: 'Internal server error.', requestId: req.id },
    })
  }
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store')
}

export function createApp(dependencies: AppDependencies) {
  const { adminRepository, authService, config, exportRepository, logger, pool, reportAccessTokenService, reportAssetStorage, reportDeliveryRepository, reportMailer, reportRepository, roundtableService, submissionReportStorage, surveyService } = dependencies
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  const pinoHttp = pinoHttpImport.default ?? pinoHttpImport
  app.use(pinoHttp({
    autoLogging: {
      ignore: (req) => ['/health', '/healthz', '/readyz'].includes(req.url ?? ''),
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'debug'
    },
    genReqId: (req: Request) => req.get('x-request-id') || randomUUID(),
    logger,
  }))
  app.use(helmet())
  app.use(compression())
  app.use(cors(createCorsOptions(config)))
  app.use(rateLimit({ legacyHeaders: false, limit: config.rateLimitMax, standardHeaders: 'draft-7', windowMs: config.rateLimitWindowMs }))
  app.use(express.json({ limit: config.requestBodyLimit }))

  const liveness = (_req: Request, res: Response) => {
    noStore(res)
    res.json({ data: { service: 'cwi-backend', status: 'ok' } })
  }
  app.get('/health', liveness)
  app.get('/healthz', liveness)
  app.get('/readyz', async (_req, res, next) => {
    try {
      await pool.query('SELECT 1')
      noStore(res)
      res.json({ data: { service: 'cwi-backend', status: 'ready' } })
    } catch {
      next(new HttpError(503, 'not_ready', 'Service dependencies are not ready.'))
    }
  })

  app.use('/api/v1/auth', createAuthRouter(authService, config))
  app.use('/api/v1/roundtable-registrations', createRoundtableRouter(roundtableService, config))
  app.use('/api/v1/survey-submissions', createSurveyRouter(surveyService, config))
  app.use('/api/v1/public', createPublicReportRouter(reportRepository, reportAssetStorage, reportAccessTokenService))
  app.use('/api/v1/admin', createAdminRouter(adminRepository, reportRepository, reportAssetStorage, exportRepository, authService, config))
  app.use('/api/v1/admin/report-delivery', createReportDeliveryRouter(reportDeliveryRepository, submissionReportStorage, reportAssetStorage, reportMailer, authService, config))
  app.use(handleNotFound)
  app.use(handleError(logger))
  return app
}

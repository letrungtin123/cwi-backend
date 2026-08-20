import { randomUUID } from 'node:crypto'
import compression from 'compression'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import type { Logger } from 'pino'
import pinoHttpImport from 'pino-http'
import type { RuntimeConfig } from './config/runtime.js'
import { HttpError, isHttpError } from './http/errors.js'
import { createAdminRouter } from './modules/admin/adminRoutes.js'
import type { PgAdminRepository } from './modules/admin/adminRepository.js'
import { createAuthRouter } from './modules/auth/authRoutes.js'
import type { AuthService } from './modules/auth/authService.js'
import type { ReportAssetStorage } from './modules/reports/reportAssetStorage.js'
import type { PgReportRepository } from './modules/reports/reportRepository.js'
import { createRoundtableRouter } from './modules/roundtable/roundtableRoutes.js'
import type { RoundtableService } from './modules/roundtable/roundtableService.js'
import { createSurveyRouter } from './modules/survey/surveyRoutes.js'
import type { SurveyService } from './modules/survey/surveyService.js'

export type AppDependencies = {
  adminRepository: PgAdminRepository
  authService: AuthService
  config: RuntimeConfig
  logger: Logger
  reportAssetStorage: ReportAssetStorage
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

function handleError(logger: Logger) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (isHttpError(error)) {
      res.status(error.statusCode).json({
        error: {
          code: error.code,
          details: error.details,
          message: error.message,
          requestId: req.id,
        },
      })
      return
    }

    logger.error({ error, requestId: req.id }, 'Unhandled request error')
    res.status(500).json({
      error: {
        code: 'internal_server_error',
        message: 'Internal server error.',
        requestId: req.id,
      },
    })
  }
}

export function createApp(dependencies: AppDependencies) {
  const { adminRepository, authService, config, logger, reportAssetStorage, reportRepository, roundtableService, surveyService } = dependencies
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)

  const pinoHttp = pinoHttpImport.default ?? pinoHttpImport
  app.use(
    pinoHttp({
      genReqId: (req: Request) => req.get('x-request-id') || randomUUID(),
      logger,
    }),
  )
  app.use(helmet())
  app.use(compression())
  app.use(cors(createCorsOptions(config)))
  app.use(
    rateLimit({
      legacyHeaders: false,
      limit: config.rateLimitMax,
      standardHeaders: 'draft-7',
      windowMs: config.rateLimitWindowMs,
    }),
  )
  app.use(express.json({ limit: config.requestBodyLimit }))

  app.get('/health', (_req, res) => {
    res.json({
      data: {
        service: 'cwi-backend',
        status: 'ok',
      },
    })
  })

  app.use('/api/v1/auth', createAuthRouter(authService, config))
  app.use('/api/v1/roundtable-registrations', createRoundtableRouter(roundtableService, config))
  app.use('/api/v1/survey-submissions', createSurveyRouter(surveyService, config))
  app.use('/api/v1/admin', createAdminRouter(adminRepository, reportRepository, reportAssetStorage, authService, config))

  app.use(handleNotFound)
  app.use(handleError(logger))

  return app
}
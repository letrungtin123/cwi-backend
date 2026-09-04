import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getRequestMeta } from '../../http/requestMeta.js'
import type { RoundtableService } from './roundtableService.js'

export function createRoundtableRouter(service: RoundtableService, config: RuntimeConfig) {
  const router = Router()
  const checkRateLimit = rateLimit({
    limit: Math.min(config.rateLimitMax, 30),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    windowMs: Math.min(config.rateLimitWindowMs, 60_000),
  })
  const registrationRateLimit = rateLimit({
    limit: Math.min(config.rateLimitMax, 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    windowMs: Math.min(config.rateLimitWindowMs, 60_000),
  })

  router.post('/check', checkRateLimit, async (req, res, next) => {
    try {
      const result = await service.check(req.body)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: result })
    } catch (error) {
      next(error)
    }
  })

  router.post('/', registrationRateLimit, async (req, res, next) => {
    try {
      const result = await service.register(req.body, getRequestMeta(req, config.ipHashSecret))
      res.status(result.deduplicated ? 200 : 201).json({
        data: {
          deduplicated: result.deduplicated,
          linkedSubmissionId: result.linkedSubmissionId,
          registrationId: result.id,
          registeredAt: result.registeredAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

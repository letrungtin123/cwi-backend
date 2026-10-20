import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import { getRequestMeta } from '../../http/requestMeta.js'
import type { AuthService } from '../auth/authService.js'
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

  // Time and location of the Roundtable that is open for registration.
  router.get('/event', async (_req, res, next) => {
    try {
      const event = await service.getCurrentEvent()
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { eventLocation: event.eventLocation, eventTime: event.eventTime, quarter: event.quarter } })
    } catch (error) {
      next(error)
    }
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

export function createRoundtableEventAdminRouter(service: RoundtableService, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  router.get('/', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await service.getCurrentEvent() })
    } catch (error) {
      next(error)
    }
  })

  router.put('/', async (req, res, next) => {
    try {
      const session = getRequiredAdminSession(req)
      if (session.user.role !== 'admin') throw new HttpError(403, 'admin_required', 'Bạn không có quyền sửa thông tin CEO Roundtable.')
      res.json({ data: await service.saveCurrentEvent(req.body, session.user.email) })
    } catch (error) {
      next(error)
    }
  })

  return router
}

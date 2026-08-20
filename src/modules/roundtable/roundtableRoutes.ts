import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getRequestMeta } from '../../http/requestMeta.js'
import type { RoundtableService } from './roundtableService.js'

export function createRoundtableRouter(service: RoundtableService, config: RuntimeConfig) {
  const router = Router()

  router.post('/', async (req, res, next) => {
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

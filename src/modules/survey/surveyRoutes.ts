import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getRequestMeta } from '../../http/requestMeta.js'
import type { SurveyService } from './surveyService.js'

export function createSurveyRouter(service: SurveyService, config: RuntimeConfig) {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const result = await service.submit(req.body, getRequestMeta(req, config.ipHashSecret))
      res.status(result.deduplicated ? 200 : 201).json({
        data: {
          deduplicated: result.deduplicated,
          submissionId: result.id,
          submittedAt: result.submittedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

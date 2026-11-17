import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, requireAdminSession } from '../../http/adminSession.js'
import type { AuthService } from '../auth/authService.js'
import type { PgReportRepository } from './reportRepository.js'

// Read-only state of the global stop for calling cwi-ai, with the number of reports
// still waiting. The stop is set by the developers in .env (REPORT_AI_CALLS_PAUSED);
// the dashboard only shows a notice while it is on. Per-quarter switches live in the
// "Quý khảo sát" tab.
export function createReportGenerationSettingsAdminRouter(repository: PgReportRepository, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  router.get('/', async (_req, res, next) => {
    try {
      const [settings, unfinishedJobs] = await Promise.all([repository.getGenerationSettings(), repository.countUnfinishedJobs()])
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { globalPaused: !settings.aiCallsEnabled, unfinishedJobs } })
    } catch (error) {
      next(error)
    }
  })

  return router
}

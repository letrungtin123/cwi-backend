import { Router } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from '../auth/authService.js'
import type { PgReportRepository, ReportGenerationSettingsUpdate } from './reportRepository.js'
import { canManageContent } from '../auth/adminRoles.js'

const settingsUpdateSchema = z
  .object({
    aiCallsEnabled: z.boolean(),
    deferredResultDays: z.number().int().min(1).max(60),
  })
  .strict()

export function normalizeReportGenerationSettingsUpdate(payload: unknown): ReportGenerationSettingsUpdate {
  const parsed = settingsUpdateSchema.safeParse(payload)
  if (!parsed.success) {
    throw new HttpError(422, 'invalid_report_generation_settings', 'Số ngày báo kết quả phải là số nguyên từ 1 đến 60.')
  }
  return parsed.data
}

// Dashboard switch for calling cwi-ai, shown with the number of submissions still
// waiting for their report. Everyone signed in can read it; only admins change it.
export function createReportGenerationSettingsAdminRouter(repository: PgReportRepository, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  const currentState = async () => {
    const [settings, unfinishedJobs] = await Promise.all([repository.getGenerationSettings(), repository.countUnfinishedJobs()])
    return { ...settings, unfinishedJobs }
  }

  router.get('/', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await currentState() })
    } catch (error) {
      next(error)
    }
  })

  router.put('/', async (req, res, next) => {
    try {
      const session = getRequiredAdminSession(req)
      if (!canManageContent(session.user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền đổi cài đặt tạo báo cáo.')
      await repository.saveGenerationSettings(normalizeReportGenerationSettingsUpdate(req.body), session.user.email)
      res.json({ data: await currentState() })
    } catch (error) {
      next(error)
    }
  })

  return router
}

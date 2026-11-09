import { Router, type Request } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuditActor } from '../audit/adminAuditLog.js'
import { requireSuperadmin } from '../auth/adminRoles.js'
import type { AuthService } from '../auth/authService.js'
import type { PgSubmissionDeletionRepository } from './submissionDeletionRepository.js'

export const MAX_SUBMISSIONS_PER_DELETION = 200

const idsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(MAX_SUBMISSIONS_PER_DELETION),
  })
  .strict()

export function parseSubmissionIds(payload: unknown): string[] {
  const parsed = idsSchema.safeParse(payload)
  if (!parsed.success) {
    throw new HttpError(422, 'invalid_submission_ids', `Hãy chọn từ 1 đến ${MAX_SUBMISSIONS_PER_DELETION} lượt gửi.`)
  }
  return [...new Set(parsed.data.ids.map((id) => id.toLowerCase()))]
}

function superadminActor(req: Request, config: RuntimeConfig): AuditActor {
  const session = getRequiredAdminSession(req)
  return { meta: getAuthRequestMeta(req, config), user: requireSuperadmin(session.user) }
}

// Deleting survey submissions whose report is still waiting (test rows).
// Super admins only.
export function createSubmissionDeletionRouter(repository: PgSubmissionDeletionRepository, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  router.post('/preview', async (req, res, next) => {
    try {
      superadminActor(req, config)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { items: await repository.preview(parseSubmissionIds(req.body)) } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    try {
      const actor = superadminActor(req, config)
      res.json({ data: await repository.delete(parseSubmissionIds(req.body), actor) })
    } catch (error) {
      next(error)
    }
  })

  return router
}

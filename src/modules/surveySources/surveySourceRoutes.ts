import { Router, type Request } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuditActor } from '../audit/adminAuditLog.js'
import type { AuthService } from '../auth/authService.js'
import { SURVEY_SOURCE_CODE_PATTERN } from './surveySourceCode.js'
import type { PgSurveySourceRepository, SurveySourceCreate, SurveySourceUpdate } from './surveySourceRepository.js'
import { canManageContent } from '../auth/adminRoles.js'
import { uuidPattern } from '../../http/ids.js'


const nameSchema = z.string().trim().min(1).max(120)
const noteSchema = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .optional()
  .transform((value) => value || null)

const createSchema = z
  .object({
    code: z.string().trim().toLowerCase().regex(SURVEY_SOURCE_CODE_PATTERN),
    name: nameSchema,
    note: noteSchema,
  })
  .strict()

const updateSchema = z
  .object({
    isActive: z.boolean(),
    name: nameSchema,
    note: noteSchema,
  })
  .strict()

function invalidSource(): never {
  throw new HttpError(
    422,
    'invalid_survey_source',
    'Tên nguồn cần từ 1 đến 120 ký tự. Mã nguồn chỉ gồm chữ thường không dấu, số và dấu gạch ngang (tối đa 48 ký tự).',
  )
}

export function normalizeSurveySourceCreate(payload: unknown): SurveySourceCreate {
  const parsed = createSchema.safeParse(payload)
  if (!parsed.success) invalidSource()
  return parsed.data
}

export function normalizeSurveySourceUpdate(payload: unknown): SurveySourceUpdate {
  const parsed = updateSchema.safeParse(payload)
  if (!parsed.success) invalidSource()
  return parsed.data
}

function parseSurveyVersion(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^[0-9]{4}Q[1-4]$/.test(value)) return value
  throw new HttpError(400, 'invalid_survey_version_filter', 'Bộ lọc bộ câu hỏi phải có dạng 2026Q4.')
}

function sourceId(req: Request) {
  const id = req.params.id
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new HttpError(400, 'invalid_survey_source_id', 'Mã nguồn mời phải là UUID hợp lệ.')
  return id
}

function requireEditor(req: Request, config: RuntimeConfig): AuditActor {
  const session = getRequiredAdminSession(req)
  if (!canManageContent(session.user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền thay đổi nguồn mời.')
  return { meta: getAuthRequestMeta(req, config), user: session.user }
}

// Invitation sources of the survey. Everyone signed in can see them, their counts
// and their history; only admins and super admins add, change or delete them.
export function createSurveySourceAdminRouter(repository: PgSurveySourceRepository, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  router.get('/', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await repository.list(parseSurveyVersion(req.query.surveyVersion)) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id/history', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { items: await repository.history(sourceId(req)) } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    try {
      const actor = requireEditor(req, config)
      res.status(201).json({ data: await repository.create(normalizeSurveySourceCreate(req.body), actor) })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:id', async (req, res, next) => {
    try {
      const actor = requireEditor(req, config)
      res.json({ data: await repository.update(sourceId(req), normalizeSurveySourceUpdate(req.body), actor) })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const actor = requireEditor(req, config)
      await repository.delete(sourceId(req), actor)
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  return router
}

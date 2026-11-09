import { Router, type Request } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuditActor } from '../audit/adminAuditLog.js'
import { ADMIN_ROLES, requireSuperadmin } from '../auth/adminRoles.js'
import type { AuthService } from '../auth/authService.js'
import type { AdminAccountCreate, AdminAccountUpdate, AdminUserService } from './adminUserService.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const displayNameSchema = z.string().trim().min(1).max(160)
const roleSchema = z.enum(ADMIN_ROLES)

const createSchema = z
  .object({
    displayName: displayNameSchema,
    email: z.string().trim().toLowerCase().email().max(254),
    role: roleSchema,
  })
  .strict()

const updateSchema = z
  .object({
    displayName: displayNameSchema,
    role: roleSchema,
  })
  .strict()

function invalidAccount(): never {
  throw new HttpError(422, 'invalid_admin_user', 'Họ tên cần từ 1 đến 160 ký tự, email phải hợp lệ và vai trò phải là Super Admin, Quản trị viên hoặc Người xem.')
}

export function normalizeAdminAccountCreate(payload: unknown): AdminAccountCreate {
  const parsed = createSchema.safeParse(payload)
  if (!parsed.success) invalidAccount()
  return parsed.data
}

export function normalizeAdminAccountUpdate(payload: unknown): AdminAccountUpdate {
  const parsed = updateSchema.safeParse(payload)
  if (!parsed.success) invalidAccount()
  return parsed.data
}

function accountId(req: Request) {
  const id = req.params.id
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new HttpError(400, 'invalid_admin_user_id', 'Admin user id must be a UUID.')
  return id
}

function superadminActor(req: Request, config: RuntimeConfig): AuditActor {
  const session = getRequiredAdminSession(req)
  return { meta: getAuthRequestMeta(req, config), user: requireSuperadmin(session.user) }
}

// "Quản lý quản trị viên": super admins only, reading included.
export function createAdminUserRouter(service: AdminUserService, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))
  router.use((req, res, next) => {
    try {
      requireSuperadmin(getRequiredAdminSession(req).user)
      res.setHeader('Cache-Control', 'no-store')
      next()
    } catch (error) {
      next(error)
    }
  })

  router.get('/', async (_req, res, next) => {
    try {
      res.json({ data: { items: await service.list() } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    try {
      const actor = superadminActor(req, config)
      res.status(201).json({ data: await service.create(normalizeAdminAccountCreate(req.body), actor) })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:id', async (req, res, next) => {
    try {
      const actor = superadminActor(req, config)
      res.json({ data: { account: await service.update(accountId(req), normalizeAdminAccountUpdate(req.body), actor) } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:id/lock', async (req, res, next) => {
    try {
      const actor = superadminActor(req, config)
      res.json({ data: { account: await service.setActive(accountId(req), false, actor) } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:id/unlock', async (req, res, next) => {
    try {
      const actor = superadminActor(req, config)
      res.json({ data: { account: await service.setActive(accountId(req), true, actor) } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/:id/reset-password', async (req, res, next) => {
    try {
      const actor = superadminActor(req, config)
      res.json({ data: await service.resetPassword(accountId(req), actor) })
    } catch (error) {
      next(error)
    }
  })

  return router
}

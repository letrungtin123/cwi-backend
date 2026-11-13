import rateLimit from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from './authService.js'
import { clearAuthCookies, setAuthCookies } from './cookies.js'

// 8..72: Supabase Auth hashes with bcrypt, which only uses the first 72 bytes.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    newPassword: z.string().min(8).max(72),
  })
  .strict()

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(512),
})

// Failed sign-ins allowed per email address before that address is paused. This stops password
// guessing against one account even when the attempts come from many IP addresses.
const LOGIN_FAILURES_PER_EMAIL = 10
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000

function loginEmailKey(body: unknown) {
  const email = typeof body === 'object' && body !== null && 'email' in body ? (body as { email?: unknown }).email : undefined
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase().slice(0, 254) : null
}

export function createAuthRouter(authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  const requireSession = requireAdminSession(authService, config)

  router.post(
    '/login',
    rateLimit({
      legacyHeaders: false,
      limit: config.auth.loginRateLimitMax,
      standardHeaders: 'draft-7',
      windowMs: config.auth.loginRateLimitWindowMs,
    }),
    rateLimit({
      handler: (_req, res) => {
        res.status(429).json({ error: { code: 'too_many_login_attempts', message: 'Tài khoản này đã đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' } })
      },
      keyGenerator: (req) => `login-email:${loginEmailKey(req.body)}`,
      legacyHeaders: false,
      limit: LOGIN_FAILURES_PER_EMAIL,
      skip: (req) => loginEmailKey(req.body) === null,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-7',
      windowMs: LOGIN_FAILURE_WINDOW_MS,
    }),
    async (req, res, next) => {
      try {
        const parsed = loginSchema.safeParse(req.body)
        if (!parsed.success) {
          throw new HttpError(400, 'invalid_login_payload', 'Email hoặc mật khẩu không hợp lệ.')
        }

        const result = await authService.login(parsed.data, getAuthRequestMeta(req, config))
        setAuthCookies(res, config.auth, result.sessionToken, result.csrfToken, result.expiresAt)
        res.json({
          data: {
            csrfToken: result.csrfToken,
            expiresAt: result.expiresAt.toISOString(),
            user: result.user,
          },
        })
      } catch (error) {
        next(error)
      }
    },
  )

  router.get('/me', requireSession, (req, res, next) => {
    try {
      const session = getRequiredAdminSession(req)
      res.json({
        data: {
          expiresAt: session.expiresAt,
          user: session.user,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/change-password',
    requireSession,
    rateLimit({
      keyGenerator: (req) => getRequiredAdminSession(req).id,
      legacyHeaders: false,
      limit: config.auth.loginRateLimitMax,
      standardHeaders: 'draft-7',
      windowMs: config.auth.loginRateLimitWindowMs,
    }),
    async (req, res, next) => {
      try {
        const parsed = changePasswordSchema.safeParse(req.body)
        if (!parsed.success) {
          throw new HttpError(422, 'invalid_password_change', 'Mật khẩu mới cần từ 8 đến 72 ký tự.')
        }
        await authService.changePassword(getRequiredAdminSession(req), parsed.data, getAuthRequestMeta(req, config))
        res.status(204).send()
      } catch (error) {
        next(error)
      }
    },
  )

  router.post('/logout', requireSession, async (req, res, next) => {
    try {
      const session = getRequiredAdminSession(req)
      await authService.logout(session, getAuthRequestMeta(req, config))
      clearAuthCookies(res, config.auth)
      res.status(204).send()
    } catch (error) {
      next(error)
    }
  })

  return router
}

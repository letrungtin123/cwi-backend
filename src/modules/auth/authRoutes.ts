import rateLimit from 'express-rate-limit'
import { Router } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import type { AuthService } from './authService.js'
import { clearAuthCookies, setAuthCookies } from './cookies.js'

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(512),
})

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
    async (req, res, next) => {
      try {
        const input = loginSchema.parse(req.body)
        const result = await authService.login(input, getAuthRequestMeta(req, config))
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
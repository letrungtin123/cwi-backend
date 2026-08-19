import type { NextFunction, Request, Response } from 'express'
import type { RuntimeConfig } from '../config/runtime.js'
import { HttpError } from './errors.js'
import { getRequestMeta } from './requestMeta.js'
import type { AuthService } from '../modules/auth/authService.js'
import type { AdminSession } from '../modules/auth/authTypes.js'
import { getCookie } from '../modules/auth/cookies.js'

declare global {
  namespace Express {
    interface Request {
      adminSession?: AdminSession
    }
  }
}

function requiresCsrf(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

export function requireAdminSession(authService: AuthService, config: RuntimeConfig) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const sessionToken = getCookie(req, config.auth.sessionCookieName)
      const session = await authService.resolveSession(sessionToken)

      if (requiresCsrf(req.method)) {
        authService.verifyCsrfToken(session, req.get('x-csrf-token')?.trim() ?? '')
      }

      req.adminSession = session
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function getRequiredAdminSession(req: Request) {
  if (!req.adminSession) {
    throw new HttpError(500, 'admin_session_missing', 'Admin session middleware was not applied.')
  }

  return req.adminSession
}

export function getAuthRequestMeta(req: Request, config: RuntimeConfig) {
  return getRequestMeta(req, config.ipHashSecret)
}
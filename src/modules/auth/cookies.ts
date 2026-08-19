import type { CookieOptions, Request, Response } from 'express'
import type { AuthConfig } from '../../config/runtime.js'

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>()
  if (!header) return cookies

  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.split('=')
    const name = rawName?.trim()
    if (!name) continue

    const value = rawValue.join('=').trim()
    try {
      cookies.set(name, decodeURIComponent(value))
    } catch {
      cookies.set(name, value)
    }
  }

  return cookies
}

function baseCookieOptions(config: AuthConfig, expires: Date): CookieOptions {
  return {
    domain: config.cookieDomain ?? undefined,
    expires,
    path: '/',
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
  }
}

function clearCookieOptions(config: AuthConfig): CookieOptions {
  return {
    domain: config.cookieDomain ?? undefined,
    path: '/',
    sameSite: config.cookieSameSite,
    secure: config.cookieSecure,
  }
}

export function getCookie(req: Request, name: string) {
  return parseCookies(req.get('cookie')).get(name) ?? ''
}

export function setAuthCookies(
  res: Response,
  config: AuthConfig,
  sessionToken: string,
  csrfToken: string,
  expiresAt: Date,
) {
  res.cookie(config.sessionCookieName, sessionToken, {
    ...baseCookieOptions(config, expiresAt),
    httpOnly: true,
  })

  res.cookie(config.csrfCookieName, csrfToken, {
    ...baseCookieOptions(config, expiresAt),
    httpOnly: false,
  })
}

export function clearAuthCookies(res: Response, config: AuthConfig) {
  res.clearCookie(config.sessionCookieName, clearCookieOptions(config))
  res.clearCookie(config.csrfCookieName, clearCookieOptions(config))
}
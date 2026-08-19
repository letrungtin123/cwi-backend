import type { AuthConfig } from '../../config/runtime.js'
import { HttpError } from '../../http/errors.js'
import type { RequestMeta } from '../../http/requestMeta.js'
import { constantTimeEqual, createOpaqueToken, sha256Hex } from './authCrypto.js'
import type { PgAuthRepository } from './authRepository.js'
import type { AdminSession, AdminUser } from './authTypes.js'
import { signInWithSupabasePassword } from './supabaseAuthClient.js'

export type LoginResult = {
  csrfToken: string
  expiresAt: Date
  sessionToken: string
  user: AdminUser
}

export class AuthService {
  constructor(
    private readonly repository: PgAuthRepository,
    private readonly config: AuthConfig,
  ) {}

  async login(input: { email: string; password: string }, meta: RequestMeta): Promise<LoginResult> {
    const supabaseUser = await signInWithSupabasePassword(this.config, input.email, input.password)
    const adminUser = await this.repository.findActiveAdminUser(supabaseUser.id, supabaseUser.email)

    if (!adminUser) {
      throw new HttpError(403, 'admin_user_not_allowed', 'This account is not allowed to access the dashboard.')
    }

    const sessionToken = createOpaqueToken()
    const csrfToken = createOpaqueToken()
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000)

    await this.repository.createSession({
      adminUserId: adminUser.id,
      clientIpHash: meta.clientIpHash,
      csrfTokenHash: sha256Hex(csrfToken),
      expiresAt,
      sessionTokenHash: sha256Hex(sessionToken),
      userAgent: meta.userAgent,
    })
    await this.repository.touchLogin(adminUser.id)
    await this.repository.writeAuditLog({
      action: 'admin.login',
      adminUserId: adminUser.id,
      clientIpHash: meta.clientIpHash,
      metadata: { email: supabaseUser.email },
      userAgent: meta.userAgent,
    })

    return {
      csrfToken,
      expiresAt,
      sessionToken,
      user: adminUser,
    }
  }

  async resolveSession(sessionToken: string): Promise<AdminSession> {
    if (!sessionToken) {
      throw new HttpError(401, 'unauthorized', 'Authentication is required.')
    }

    const session = await this.repository.findSessionByTokenHash(sha256Hex(sessionToken))
    if (!session) {
      throw new HttpError(401, 'session_invalid', 'Session is invalid or expired.')
    }

    return session
  }

  verifyCsrfToken(session: AdminSession, csrfToken: string) {
    if (!csrfToken) {
      throw new HttpError(403, 'csrf_token_missing', 'CSRF token is required.')
    }

    if (!constantTimeEqual(sha256Hex(csrfToken), session.csrfTokenHash)) {
      throw new HttpError(403, 'csrf_token_invalid', 'CSRF token is invalid.')
    }
  }

  async logout(session: AdminSession, meta: RequestMeta): Promise<void> {
    await this.repository.revokeSession(session.id)
    await this.repository.writeAuditLog({
      action: 'admin.logout',
      adminUserId: session.user.id,
      clientIpHash: meta.clientIpHash,
      userAgent: meta.userAgent,
    })
  }
}
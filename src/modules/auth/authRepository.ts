import type pg from 'pg'
import type { AdminRole, AdminSession, AdminUser } from './authTypes.js'

type AdminUserRow = {
  display_name: string | null
  email: string
  id: string
  role: AdminRole
}

type SessionRow = AdminUserRow & {
  csrf_token_hash: string
  expires_at: Date
  session_id: string
}

function mapAdminUser(row: AdminUserRow): AdminUser {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    role: row.role,
  }
}

function mapSession(row: SessionRow): AdminSession {
  return {
    csrfTokenHash: row.csrf_token_hash,
    expiresAt: row.expires_at.toISOString(),
    id: row.session_id,
    user: mapAdminUser(row),
  }
}

export class PgAuthRepository {
  constructor(private readonly pool: pg.Pool) {}

  async findActiveAdminUser(supabaseUserId: string, email: string): Promise<AdminUser | null> {
    const result = await this.pool.query<AdminUserRow>(
      `
      SELECT id, email, display_name, role
      FROM public.cwi_admin_users
      WHERE is_active = true
        AND auth_user_id = $1::uuid
        AND lower(email) = lower($2)
      LIMIT 1
      `,
      [supabaseUserId, email],
    )

    const row = result.rows[0]
    return row ? mapAdminUser(row) : null
  }

  async createSession(input: {
    adminUserId: string
    clientIpHash: string | null
    csrfTokenHash: string
    expiresAt: Date
    sessionTokenHash: string
    userAgent: string | null
  }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO public.cwi_admin_sessions (
        admin_user_id,
        session_token_hash,
        csrf_token_hash,
        expires_at,
        client_ip_hash,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        input.adminUserId,
        input.sessionTokenHash,
        input.csrfTokenHash,
        input.expiresAt,
        input.clientIpHash,
        input.userAgent,
      ],
    )
  }

  async findSessionByTokenHash(sessionTokenHash: string): Promise<AdminSession | null> {
    const result = await this.pool.query<SessionRow>(
      `
      SELECT
        s.id AS session_id,
        s.csrf_token_hash,
        s.expires_at,
        u.id,
        u.email,
        u.display_name,
        u.role
      FROM public.cwi_admin_sessions s
      JOIN public.cwi_admin_users u ON u.id = s.admin_user_id
      WHERE s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.is_active = true
      LIMIT 1
      `,
      [sessionTokenHash],
    )

    const row = result.rows[0]
    return row ? mapSession(row) : null
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE public.cwi_admin_sessions
      SET revoked_at = now(), updated_at = now()
      WHERE id = $1
        AND revoked_at IS NULL
      `,
      [sessionId],
    )
  }

  async touchLogin(adminUserId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE public.cwi_admin_users
      SET last_login_at = now(), updated_at = now()
      WHERE id = $1
      `,
      [adminUserId],
    )
  }

  async writeAuditLog(input: {
    action: string
    adminUserId: string | null
    clientIpHash: string | null
    metadata?: Record<string, unknown>
    targetId?: string | null
    targetType?: string | null
    userAgent: string | null
  }): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO public.cwi_admin_audit_logs (
        admin_user_id,
        action,
        target_type,
        target_id,
        metadata,
        client_ip_hash,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        input.adminUserId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.metadata ?? {},
        input.clientIpHash,
        input.userAgent,
      ],
    )
  }
}
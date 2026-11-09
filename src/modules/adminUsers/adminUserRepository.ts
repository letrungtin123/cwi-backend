import type pg from 'pg'
import { HttpError } from '../../http/errors.js'
import type { AdminRole } from '../auth/authTypes.js'
import type { AdminPerson } from '../surveySources/surveySourceRepository.js'

export const ADMIN_USER_AUDIT_TARGET = 'admin_user'

export type AdminAccount = {
  createdAt: string
  createdBy: AdminPerson | null
  displayName: string | null
  email: string
  id: string
  isActive: boolean
  lastLoginAt: string | null
  role: AdminRole
}

export type AdminAccountState = {
  auth_user_id: string
  display_name: string | null
  email: string
  id: string
  is_active: boolean
  role: AdminRole
}

type AdminAccountRow = {
  created_at: Date
  created_by_email: string | null
  created_by_name: string | null
  display_name: string | null
  email: string
  id: string
  is_active: boolean
  last_login_at: Date | null
  role: AdminRole
}

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient

const accountSelect = `
  SELECT
    account.id,
    account.email,
    account.display_name,
    account.role,
    account.is_active,
    account.last_login_at,
    account.created_at,
    creator.display_name AS created_by_name,
    creator.email AS created_by_email
  FROM public.cwi_admin_users AS account
  LEFT JOIN public.cwi_admin_users AS creator ON creator.id = account.created_by_admin_id
`

function mapAccount(row: AdminAccountRow): AdminAccount {
  return {
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by_name || row.created_by_email ? { email: row.created_by_email, name: row.created_by_name } : null,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    role: row.role,
  }
}

export function adminAccountNotFound() {
  return new HttpError(404, 'admin_user_not_found', 'Không tìm thấy tài khoản quản trị này. Vui lòng tải lại trang.')
}

export class PgAdminUserRepository {
  constructor(readonly pool: pg.Pool) {}

  // Active accounts first, then super admins, admins, viewers; newest first.
  async list(): Promise<AdminAccount[]> {
    const result = await this.pool.query<AdminAccountRow>(
      `${accountSelect}
      ORDER BY account.is_active DESC,
        CASE account.role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        account.created_at DESC, account.id DESC`,
    )
    return result.rows.map(mapAccount)
  }

  async getById(id: string, db: Queryable = this.pool): Promise<AdminAccount> {
    const result = await db.query<AdminAccountRow>(`${accountSelect} WHERE account.id = $1`, [id])
    const row = result.rows[0]
    if (!row) throw adminAccountNotFound()
    return mapAccount(row)
  }

  async getState(id: string, db: Queryable = this.pool, forUpdate = false): Promise<AdminAccountState> {
    const result = await db.query<AdminAccountState>(
      `SELECT id, auth_user_id, email, display_name, role, is_active
      FROM public.cwi_admin_users
      WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    )
    const row = result.rows[0]
    if (!row) throw adminAccountNotFound()
    return row
  }

  async emailTaken(email: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM public.cwi_admin_users WHERE lower(email) = lower($1)', [email])
    return Boolean(result.rowCount)
  }

  // A Supabase Auth login that already exists for this email (for example one
  // left over from an earlier attempt), so it is reused instead of duplicated.
  async findAuthUserId(email: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id
      FROM auth.users
      WHERE lower(email) = lower($1)
        AND coalesce(is_sso_user, false) = false
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1`,
      [email],
    )
    return result.rows[0]?.id ?? null
  }

  async insert(
    db: Queryable,
    input: { authUserId: string; createdByAdminId: string; displayName: string; email: string; role: AdminRole },
  ): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO public.cwi_admin_users (auth_user_id, email, display_name, role, created_by_admin_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [input.authUserId, input.email, input.displayName, input.role, input.createdByAdminId],
    )
    return result.rows[0]!.id
  }

  async update(db: Queryable, id: string, input: { displayName: string; role: AdminRole }): Promise<void> {
    await db.query('UPDATE public.cwi_admin_users SET display_name = $2, role = $3 WHERE id = $1', [id, input.displayName, input.role])
  }

  async setActive(db: Queryable, id: string, isActive: boolean): Promise<void> {
    await db.query('UPDATE public.cwi_admin_users SET is_active = $2 WHERE id = $1', [id, isActive])
  }

  // Signs the account out everywhere (lock, password reset).
  async revokeSessions(db: Queryable, adminUserId: string): Promise<void> {
    await db.query(
      `UPDATE public.cwi_admin_sessions
      SET revoked_at = now(), updated_at = now()
      WHERE admin_user_id = $1 AND revoked_at IS NULL`,
      [adminUserId],
    )
  }

  // Locks every active super admin row for the rest of the transaction, so two
  // super admins cannot demote or lock each other at the same moment and leave
  // nobody in charge. Fails if the actor is no longer an active super admin.
  async lockSuperadmins(db: Queryable, actorId: string): Promise<void> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM public.cwi_admin_users WHERE role = 'superadmin' AND is_active = true ORDER BY id FOR UPDATE`,
    )
    if (!result.rows.some((row) => row.id === actorId)) {
      throw new HttpError(403, 'superadmin_required', 'Chỉ Super Admin được quản lý tài khoản quản trị.')
    }
  }
}

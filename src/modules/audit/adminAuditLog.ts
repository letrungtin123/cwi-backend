import type pg from 'pg'
import type { RequestMeta } from '../../http/requestMeta.js'
import type { AdminUser } from '../auth/authTypes.js'

// Who did a change in the dashboard, and from where.
export type AuditActor = {
  meta: Pick<RequestMeta, 'clientIpHash' | 'userAgent'>
  user: AdminUser
}

export type AuditEntry = {
  action: string
  actor: { email: string | null; name: string | null }
  createdAt: string
  id: string
  metadata: Record<string, unknown>
}

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient

type AuditRow = {
  action: string
  actor_email: string | null
  actor_name: string | null
  created_at: Date
  id: string
  metadata: Record<string, unknown> | null
}

// Writes one row to cwi_admin_audit_logs. The actor's name and email are copied
// into metadata so the history still reads right if the account changes later.
export async function writeAdminAudit(
  db: Queryable,
  actor: AuditActor,
  entry: { action: string; metadata: Record<string, unknown>; targetId: string; targetType: string },
): Promise<void> {
  await db.query(
    `INSERT INTO public.cwi_admin_audit_logs (admin_user_id, action, target_type, target_id, metadata, client_ip_hash, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor.user.id,
      entry.action,
      entry.targetType,
      entry.targetId,
      { ...entry.metadata, actorEmail: actor.user.email, actorName: actor.user.displayName },
      actor.meta.clientIpHash,
      actor.meta.userAgent,
    ],
  )
}

function text(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

// Newest first. The actor's current name wins over the copy taken at the time.
export async function listAdminAudit(db: Queryable, targetType: string, targetId: string, limit = 200): Promise<AuditEntry[]> {
  const result = await db.query<AuditRow>(
    `SELECT log.id, log.action, log.metadata, log.created_at, actor.display_name AS actor_name, actor.email AS actor_email
    FROM public.cwi_admin_audit_logs AS log
    LEFT JOIN public.cwi_admin_users AS actor ON actor.id = log.admin_user_id
    WHERE log.target_type = $1 AND log.target_id = $2
    ORDER BY log.created_at DESC, log.id DESC
    LIMIT $3`,
    [targetType, targetId, limit],
  )
  return result.rows.map((row) => {
    const { actorEmail, actorName, ...metadata } = row.metadata ?? {}
    return {
      action: row.action,
      actor: { email: row.actor_email ?? text(actorEmail), name: row.actor_name ?? text(actorName) },
      createdAt: row.created_at.toISOString(),
      id: row.id,
      metadata,
    }
  })
}

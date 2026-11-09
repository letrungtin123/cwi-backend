import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import { listAdminAudit, writeAdminAudit, type AuditActor, type AuditEntry } from '../audit/adminAuditLog.js'

export const SURVEY_SOURCE_AUDIT_TARGET = 'survey_source'

export type AdminPerson = {
  email: string | null
  name: string | null
}

export type SurveySource = {
  code: string
  createdAt: string
  createdBy: AdminPerson | null
  id: string
  isActive: boolean
  lastSubmittedAt: string | null
  name: string
  note: string | null
  // Submissions in the selected survey quarter (all quarters when none is selected).
  submissionCount: number
  // Submissions in every quarter; a source can only be deleted while this is 0.
  totalSubmissionCount: number
  updatedAt: string
  updatedBy: AdminPerson | null
}

export type SurveySourceList = {
  items: SurveySource[]
  // Submissions in the same quarter that came with no source link.
  unattributedSubmissions: number
}

export type SurveySourceCreate = {
  code: string
  name: string
  note: string | null
}

export type SurveySourceUpdate = {
  isActive: boolean
  name: string
  note: string | null
}

type SurveySourceRow = {
  code: string
  created_at: Date
  created_by_email: string | null
  created_by_name: string | null
  id: string
  is_active: boolean
  last_submitted_at: Date | null
  name: string
  note: string | null
  submission_count: number
  total_submission_count: number
  updated_at: Date
  updated_by_email: string | null
  updated_by_name: string | null
}

export type SurveySourceState = {
  code: string
  is_active: boolean
  name: string
  note: string | null
}

const sourceSelect = `
  SELECT
    source.id,
    source.code,
    source.name,
    source.note,
    source.is_active,
    source.created_at,
    source.updated_at,
    creator.display_name AS created_by_name,
    coalesce(creator.email, source.created_by_email) AS created_by_email,
    updater.display_name AS updated_by_name,
    coalesce(updater.email, source.updated_by_email) AS updated_by_email,
    count(s.id)::int AS submission_count,
    max(s.submitted_at) AS last_submitted_at,
    (
      SELECT count(*)::int
      FROM public.cwi_survey_submissions AS every_submission
      WHERE every_submission.survey_source_id = source.id
    ) AS total_submission_count
  FROM public.cwi_survey_sources AS source
  LEFT JOIN public.cwi_admin_users AS creator ON creator.id = source.created_by_admin_id
  LEFT JOIN public.cwi_admin_users AS updater ON updater.id = source.updated_by_admin_id
  LEFT JOIN public.cwi_survey_submissions AS s
    ON s.survey_source_id = source.id
   AND ($1::text IS NULL OR s.survey_version = $1)
`

const sourceGroupBy = 'GROUP BY source.id, creator.id, updater.id'

function person(name: string | null, email: string | null): AdminPerson | null {
  return name || email ? { email, name } : null
}

function mapSource(row: SurveySourceRow): SurveySource {
  return {
    code: row.code,
    createdAt: row.created_at.toISOString(),
    createdBy: person(row.created_by_name, row.created_by_email),
    id: row.id,
    isActive: row.is_active,
    lastSubmittedAt: row.last_submitted_at ? row.last_submitted_at.toISOString() : null,
    name: row.name,
    note: row.note,
    submissionCount: row.submission_count,
    totalSubmissionCount: row.total_submission_count,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: person(row.updated_by_name, row.updated_by_email),
  }
}

function sourceState(row: SurveySourceState) {
  return { code: row.code, isActive: row.is_active, name: row.name, note: row.note }
}

// What an edit changes, as { field: { from, to } }. Empty when nothing changes.
export function diffSurveySource(before: SurveySourceState, input: SurveySourceUpdate) {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  if (before.name !== input.name) changes.name = { from: before.name, to: input.name }
  if ((before.note ?? null) !== (input.note ?? null)) changes.note = { from: before.note, to: input.note }
  if (before.is_active !== input.isActive) changes.isActive = { from: before.is_active, to: input.isActive }
  return changes
}

function pgErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined
}

function sourceNotFound() {
  return new HttpError(404, 'survey_source_not_found', 'Không tìm thấy nguồn mời này. Vui lòng tải lại trang.')
}

function sourceInUse() {
  return new HttpError(409, 'survey_source_in_use', 'Nguồn này đã có người nộp khảo sát nên không xóa được. Bạn có thể bấm Ngưng.')
}

export class PgSurveySourceRepository {
  constructor(private readonly pool: pg.Pool) {}

  async list(surveyVersion: string | null): Promise<SurveySourceList> {
    const [sources, unattributed] = await Promise.all([
      this.pool.query<SurveySourceRow>(
        `${sourceSelect}
        ${sourceGroupBy}
        ORDER BY source.is_active DESC, source.created_at DESC, source.id DESC`,
        [surveyVersion],
      ),
      this.pool.query<{ total: number }>(
        `SELECT count(*)::int AS total
        FROM public.cwi_survey_submissions
        WHERE survey_source_id IS NULL
          AND ($1::text IS NULL OR survey_version = $1)`,
        [surveyVersion],
      ),
    ])
    return {
      items: sources.rows.map(mapSource),
      unattributedSubmissions: unattributed.rows[0]?.total ?? 0,
    }
  }

  private async getById(id: string): Promise<SurveySource> {
    const result = await this.pool.query<SurveySourceRow>(
      `${sourceSelect}
      WHERE source.id = $2
      ${sourceGroupBy}`,
      [null, id],
    )
    const row = result.rows[0]
    if (!row) throw sourceNotFound()
    return mapSource(row)
  }

  // Every change is also written to the admin audit log, in the same transaction.
  async history(id: string): Promise<AuditEntry[]> {
    return listAdminAudit(this.pool, SURVEY_SOURCE_AUDIT_TARGET, id)
  }

  async create(input: SurveySourceCreate, actor: AuditActor): Promise<SurveySource> {
    try {
      const id = await withTransaction(this.pool, async (client) => {
        const result = await client.query<{ id: string }>(
          `INSERT INTO public.cwi_survey_sources (code, name, note, created_by_admin_id, updated_by_admin_id, created_by_email, updated_by_email)
          VALUES ($1, $2, $3, $4, $4, $5, $5)
          RETURNING id`,
          [input.code, input.name, input.note, actor.user.id, actor.user.email],
        )
        const createdId = result.rows[0]!.id
        await writeAdminAudit(client, actor, {
          action: 'survey_source.create',
          metadata: { after: { code: input.code, isActive: true, name: input.name, note: input.note } },
          targetId: createdId,
          targetType: SURVEY_SOURCE_AUDIT_TARGET,
        })
        return createdId
      })
      return await this.getById(id)
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        throw new HttpError(409, 'survey_source_code_taken', 'Mã nguồn này đã được dùng. Vui lòng chọn mã khác.')
      }
      throw error
    }
  }

  // The code is never changed: it is printed in the source's QR code. Saving with
  // nothing changed writes nothing.
  async update(id: string, input: SurveySourceUpdate, actor: AuditActor): Promise<SurveySource> {
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<SurveySourceState>(
        'SELECT code, name, note, is_active FROM public.cwi_survey_sources WHERE id = $1 FOR UPDATE',
        [id],
      )
      const before = current.rows[0]
      if (!before) throw sourceNotFound()
      const changes = diffSurveySource(before, input)
      if (!Object.keys(changes).length) return
      await client.query(
        `UPDATE public.cwi_survey_sources
        SET name = $2, note = $3, is_active = $4, updated_by_admin_id = $5, updated_by_email = $6
        WHERE id = $1`,
        [id, input.name, input.note, input.isActive, actor.user.id, actor.user.email],
      )
      await writeAdminAudit(client, actor, {
        action: 'survey_source.update',
        metadata: { changes, code: before.code, name: input.name },
        targetId: id,
        targetType: SURVEY_SOURCE_AUDIT_TARGET,
      })
    })
    return this.getById(id)
  }

  // Only a source without any submission can be deleted; the foreign key
  // (ON DELETE RESTRICT) also refuses it if a submission arrives meanwhile. The
  // audit log keeps its code and name.
  async delete(id: string, actor: AuditActor): Promise<void> {
    try {
      await withTransaction(this.pool, async (client) => {
        const current = await client.query<SurveySourceState>(
          'SELECT code, name, note, is_active FROM public.cwi_survey_sources WHERE id = $1 FOR UPDATE',
          [id],
        )
        const before = current.rows[0]
        if (!before) throw sourceNotFound()
        const result = await client.query(
          `DELETE FROM public.cwi_survey_sources AS source
          WHERE source.id = $1
            AND NOT EXISTS (SELECT 1 FROM public.cwi_survey_submissions AS s WHERE s.survey_source_id = source.id)`,
          [id],
        )
        if (!result.rowCount) throw sourceInUse()
        await writeAdminAudit(client, actor, {
          action: 'survey_source.delete',
          metadata: { before: sourceState(before) },
          targetId: id,
          targetType: SURVEY_SOURCE_AUDIT_TARGET,
        })
      })
    } catch (error) {
      if (pgErrorCode(error) === '23503') throw sourceInUse()
      throw error
    }
  }
}

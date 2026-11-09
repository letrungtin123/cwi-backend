import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import { writeAdminAudit, type AuditActor } from '../audit/adminAuditLog.js'

export const SUBMISSION_AUDIT_TARGET = 'survey_submission'

// A submission may be deleted (by a super admin, to remove test rows) only while
// its report is "Chờ tạo báo cáo": report creation is paused in the dashboard, it
// has a report job that never started (no AI call, no HTML/PDF), and it has no
// uploaded report file and no report email. Anything with a real report stays.
export function submissionDeletableSql(alias: string) {
  return `(
    COALESCE((SELECT NOT settings.ai_calls_enabled FROM public.cwi_report_generation_settings AS settings WHERE settings.id), false)
    AND EXISTS (SELECT 1 FROM public.cwi_report_jobs AS waiting_job WHERE waiting_job.submission_id = ${alias}.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.cwi_report_jobs AS started_job
      WHERE started_job.submission_id = ${alias}.id
        AND (
          started_job.status NOT IN ('pending', 'queued')
          OR started_job.pdf_storage_path IS NOT NULL
          OR started_job.html_storage_path IS NOT NULL
          OR coalesce(started_job.ai_status, 'queued') <> 'queued'
        )
    )
    AND NOT EXISTS (SELECT 1 FROM public.cwi_submission_report_files AS uploaded_file WHERE uploaded_file.submission_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM public.cwi_report_email_jobs AS email_job WHERE email_job.submission_id = ${alias}.id)
  )`
}

export type SubmissionDeletionItem = {
  companyName: string | null
  deletable: boolean
  email: string
  fullName: string
  id: string
  // Roundtable / Webinar registrations made with this submission; deleted with it.
  roundtableRegistrations: number
  sourceName: string | null
  submissionStatus: string
  submittedAt: string
  surveyVersion: string
  webinarRegistrations: number
}

type SnapshotRow = {
  company_name: string | null
  deletable: boolean
  email: string
  full_name: string
  id: string
  roundtable_registrations: number
  source_name: string | null
  submission_status: string
  submitted_at: Date
  survey_version: string
  webinar_registrations: number
}

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient

function mapItem(row: SnapshotRow): SubmissionDeletionItem {
  return {
    companyName: row.company_name,
    deletable: row.deletable,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    roundtableRegistrations: row.roundtable_registrations,
    sourceName: row.source_name,
    submissionStatus: row.submission_status,
    submittedAt: row.submitted_at.toISOString(),
    surveyVersion: row.survey_version,
    webinarRegistrations: row.webinar_registrations,
  }
}

async function snapshot(db: Queryable, ids: string[]): Promise<SubmissionDeletionItem[]> {
  const result = await db.query<SnapshotRow>(
    `SELECT
      s.id,
      s.full_name,
      s.email,
      s.company_name,
      s.submission_status,
      s.submitted_at,
      s.survey_version,
      source.name AS source_name,
      (SELECT count(*)::int FROM public.cwi_roundtable_registrations AS r WHERE r.submission_id = s.id) AS roundtable_registrations,
      (SELECT count(*)::int FROM public.cwi_webinar_registrations AS w WHERE w.submission_id = s.id) AS webinar_registrations,
      ${submissionDeletableSql('s')} AS deletable
    FROM public.cwi_survey_submissions AS s
    LEFT JOIN public.cwi_survey_sources AS source ON source.id = s.survey_source_id
    WHERE s.id = ANY($1::uuid[])
    ORDER BY s.submitted_at DESC, s.id DESC`,
    [ids],
  )
  return result.rows.map(mapItem)
}

export class PgSubmissionDeletionRepository {
  constructor(private readonly pool: pg.Pool) {}

  // What a deletion would remove, without changing anything.
  preview(ids: string[]): Promise<SubmissionDeletionItem[]> {
    return snapshot(this.pool, ids)
  }

  // All or nothing: if any selected submission cannot be deleted any more (for
  // example report creation was switched back on), nothing is deleted. Each
  // deleted submission leaves one audit row with who it was and when it was sent;
  // its answers, waiting report job and Roundtable/Webinar registrations go with it.
  async delete(ids: string[], actor: AuditActor): Promise<{ deleted: number }> {
    return withTransaction(this.pool, async (client) => {
      // Holding the settings row keeps report creation from being switched on meanwhile.
      const settings = await client.query<{ ai_calls_enabled: boolean }>(
        'SELECT ai_calls_enabled FROM public.cwi_report_generation_settings WHERE id FOR UPDATE',
      )
      if (settings.rows[0]?.ai_calls_enabled !== false) {
        throw new HttpError(409, 'report_generation_running', 'Chỉ xóa được khi đang tạm dừng tạo báo cáo. Vui lòng tải lại trang.')
      }
      await client.query('SELECT id FROM public.cwi_survey_submissions WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids])
      await client.query('SELECT id FROM public.cwi_report_jobs WHERE submission_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids])

      const items = await snapshot(client, ids)
      if (items.length !== ids.length) {
        throw new HttpError(404, 'submission_not_found', 'Có lượt gửi không còn tồn tại. Vui lòng tải lại trang.')
      }
      const blocked = items.filter((item) => !item.deletable)
      if (blocked.length) {
        const names = blocked.slice(0, 3).map((item) => item.fullName).join(', ')
        throw new HttpError(409, 'submission_not_deletable', `Không xóa được vì đã có báo cáo hoặc báo cáo đang được tạo: ${names}${blocked.length > 3 ? '...' : ''}. Vui lòng tải lại trang.`)
      }

      for (const item of items) {
        await writeAdminAudit(client, actor, {
          action: 'survey_submission.delete',
          metadata: {
            submission: {
              companyName: item.companyName,
              email: item.email,
              fullName: item.fullName,
              roundtableRegistrations: item.roundtableRegistrations,
              sourceName: item.sourceName,
              submissionStatus: item.submissionStatus,
              submittedAt: item.submittedAt,
              surveyVersion: item.surveyVersion,
              webinarRegistrations: item.webinarRegistrations,
            },
          },
          targetId: item.id,
          targetType: SUBMISSION_AUDIT_TARGET,
        })
      }

      await client.query('DELETE FROM public.cwi_report_email_jobs WHERE submission_id = ANY($1::uuid[])', [ids])
      await client.query('DELETE FROM public.cwi_report_jobs WHERE submission_id = ANY($1::uuid[])', [ids])
      const deleted = await client.query('DELETE FROM public.cwi_survey_submissions WHERE id = ANY($1::uuid[])', [ids])
      return { deleted: deleted.rowCount ?? 0 }
    })
  }
}

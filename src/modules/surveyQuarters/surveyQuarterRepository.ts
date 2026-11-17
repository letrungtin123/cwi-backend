import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import { listAdminAudit, writeAdminAudit, type AuditActor, type AuditEntry } from '../audit/adminAuditLog.js'
import { getSurveyEdition, surveyQuarterLabel } from '../survey/surveyEditions.js'

// Survey quarters ("Quý khảo sát"): the cards under the survey intro screen and the
// per-quarter report generation switch. One row per edition in cwi_survey_quarters,
// plus the heading above the cards in cwi_survey_quarter_page. Rows are created by
// the migration that ships a quarter's question set; the dashboard only edits them.

export const SURVEY_QUARTER_AUDIT_TARGET = 'survey_quarter'
export const SURVEY_QUARTER_PAGE_AUDIT_TARGET = 'survey_quarter_page'

export type Bilingual = { en: string; vi: string }

export type SurveyQuarterImage = {
  contentType: string
  sha256: string
  storagePath: string
}

export type SurveyQuarter = {
  deferredResultDays: number
  description: Bilingual
  id: string
  image: SurveyQuarterImage | null
  isVisible: boolean
  label: Bilingual
  reportGenerationEnabled: boolean
  sortOrder: number
  submissionCount: number
  // The code has a question set for it; a row without one is never shown.
  supported: boolean
  surveyVersion: string
  title: Bilingual
  updatedAt: string
  updatedByEmail: string | null
  waitingReports: number
}

export type SurveyQuarterPage = {
  description: Bilingual
  kicker: Bilingual
  title: Bilingual
  updatedAt: string | null
  updatedByEmail: string | null
}

export type SurveyQuarterUpdate = {
  deferredResultDays: number
  description: Bilingual
  isVisible: boolean
  reportGenerationEnabled: boolean
  sortOrder: number
  title: Bilingual
}

export type SurveyQuarterPageUpdate = Pick<SurveyQuarterPage, 'description' | 'kicker' | 'title'>

type QuarterRow = {
  deferred_result_days: number
  description_en: string
  description_vi: string
  id: string
  image_content_type: string | null
  image_sha256: string | null
  image_storage_path: string | null
  is_visible: boolean
  report_generation_enabled: boolean
  sort_order: number
  submission_count: number
  survey_version: string
  title_en: string
  title_vi: string
  updated_at: Date
  updated_by_email: string | null
  waiting_reports: number
}

type PageRow = {
  description_en: string
  description_vi: string
  kicker_en: string
  kicker_vi: string
  title_en: string
  title_vi: string
  updated_at: Date
  updated_by_email: string | null
}

// Shown until the page row exists (the migration creates it).
const defaultPage: SurveyQuarterPage = {
  description: {
    en: "Choose the survey edition that fits you to benchmark your organization's capabilities and keep tracking how your company moves quarter by quarter.",
    vi: 'Chọn kỳ khảo sát phù hợp để đối chuẩn năng lực tổ chức và tiếp tục theo dõi sự dịch chuyển của doanh nghiệp qua từng quý.',
  },
  kicker: { en: 'CEO Workforce Index · 2026 Survey', vi: 'CEO Workforce Index · Khảo sát 2026' },
  title: { en: 'Quarterly surveys', vi: 'Khảo sát theo quý' },
  updatedAt: null,
  updatedByEmail: null,
}

// Report jobs that have not finished yet (same list as the report worker's).
const unfinishedStatuses = ['pending', 'queued_ai', 'generating_ai', 'rendering_assets', 'html_ready', 'generating_pdf']

const quarterSelect = `
  SELECT
    quarter.id,
    quarter.survey_version,
    quarter.is_visible,
    quarter.sort_order,
    quarter.title_vi,
    quarter.title_en,
    quarter.description_vi,
    quarter.description_en,
    quarter.image_storage_path,
    quarter.image_content_type,
    quarter.image_sha256,
    quarter.report_generation_enabled,
    quarter.deferred_result_days,
    quarter.updated_by_email,
    quarter.updated_at,
    (SELECT count(*)::int FROM public.cwi_survey_submissions AS submission WHERE submission.survey_version = quarter.survey_version) AS submission_count,
    (
      SELECT count(*)::int
      FROM public.cwi_report_jobs AS job
      JOIN public.cwi_survey_submissions AS submission ON submission.id = job.submission_id
      WHERE submission.survey_version = quarter.survey_version
        AND job.status = ANY($1::text[])
    ) AS waiting_reports
  FROM public.cwi_survey_quarters AS quarter`

function mapQuarter(row: QuarterRow): SurveyQuarter {
  return {
    deferredResultDays: row.deferred_result_days,
    description: { en: row.description_en, vi: row.description_vi },
    id: row.id,
    image: row.image_storage_path && row.image_content_type && row.image_sha256
      ? { contentType: row.image_content_type, sha256: row.image_sha256, storagePath: row.image_storage_path }
      : null,
    isVisible: row.is_visible,
    label: { en: surveyQuarterLabel(row.survey_version, 'en'), vi: surveyQuarterLabel(row.survey_version, 'vi') },
    reportGenerationEnabled: row.report_generation_enabled,
    sortOrder: row.sort_order,
    submissionCount: row.submission_count,
    supported: getSurveyEdition(row.survey_version) !== null,
    surveyVersion: row.survey_version,
    title: { en: row.title_en, vi: row.title_vi },
    updatedAt: row.updated_at.toISOString(),
    updatedByEmail: row.updated_by_email,
    waitingReports: row.waiting_reports,
  }
}

function mapPage(row: PageRow | undefined): SurveyQuarterPage {
  if (!row) return defaultPage
  return {
    description: { en: row.description_en, vi: row.description_vi },
    kicker: { en: row.kicker_en, vi: row.kicker_vi },
    title: { en: row.title_en, vi: row.title_vi },
    updatedAt: row.updated_at.toISOString(),
    updatedByEmail: row.updated_by_email,
  }
}

function quarterNotFound() {
  return new HttpError(404, 'survey_quarter_not_found', 'Không tìm thấy quý khảo sát này. Vui lòng tải lại trang.')
}

type Changes = Record<string, { from: unknown; to: unknown }>

function diff(changes: Changes, key: string, from: unknown, to: unknown) {
  if (from !== to) changes[key] = { from, to }
}

export function diffSurveyQuarter(before: QuarterRow, input: SurveyQuarterUpdate): Changes {
  const changes: Changes = {}
  diff(changes, 'isVisible', before.is_visible, input.isVisible)
  diff(changes, 'sortOrder', before.sort_order, input.sortOrder)
  diff(changes, 'titleVi', before.title_vi, input.title.vi)
  diff(changes, 'titleEn', before.title_en, input.title.en)
  diff(changes, 'descriptionVi', before.description_vi, input.description.vi)
  diff(changes, 'descriptionEn', before.description_en, input.description.en)
  diff(changes, 'reportGenerationEnabled', before.report_generation_enabled, input.reportGenerationEnabled)
  diff(changes, 'deferredResultDays', before.deferred_result_days, input.deferredResultDays)
  return changes
}

export class PgSurveyQuarterRepository {
  constructor(private readonly pool: pg.Pool) {}

  // Every quarter row, in card order.
  async list(): Promise<SurveyQuarter[]> {
    const result = await this.pool.query<QuarterRow>(
      `${quarterSelect}
      ORDER BY quarter.sort_order ASC, quarter.survey_version ASC`,
      [unfinishedStatuses],
    )
    return result.rows.map(mapQuarter)
  }

  async get(surveyVersion: string): Promise<SurveyQuarter> {
    const result = await this.pool.query<QuarterRow>(`${quarterSelect} WHERE quarter.survey_version = $2`, [unfinishedStatuses, surveyVersion])
    const row = result.rows[0]
    if (!row) throw quarterNotFound()
    return mapQuarter(row)
  }

  async getPage(): Promise<SurveyQuarterPage> {
    const result = await this.pool.query<PageRow>(
      `SELECT kicker_vi, kicker_en, title_vi, title_en, description_vi, description_en, updated_by_email, updated_at
      FROM public.cwi_survey_quarter_page
      WHERE id = true`,
    )
    return mapPage(result.rows[0])
  }

  async history(surveyVersion: string): Promise<AuditEntry[]> {
    const quarter = await this.get(surveyVersion)
    return listAdminAudit(this.pool, SURVEY_QUARTER_AUDIT_TARGET, quarter.id)
  }

  // Saving with nothing changed writes nothing.
  async update(surveyVersion: string, input: SurveyQuarterUpdate, actor: AuditActor): Promise<SurveyQuarter> {
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<QuarterRow>(
        `SELECT * FROM public.cwi_survey_quarters WHERE survey_version = $1 FOR UPDATE`,
        [surveyVersion],
      )
      const before = current.rows[0]
      if (!before) throw quarterNotFound()
      const changes = diffSurveyQuarter(before, input)
      if (!Object.keys(changes).length) return
      await client.query(
        `UPDATE public.cwi_survey_quarters
        SET is_visible = $2, sort_order = $3, title_vi = $4, title_en = $5, description_vi = $6, description_en = $7,
            report_generation_enabled = $8, deferred_result_days = $9, updated_by_admin_id = $10, updated_by_email = $11
        WHERE id = $1`,
        [
          before.id,
          input.isVisible,
          input.sortOrder,
          input.title.vi,
          input.title.en,
          input.description.vi,
          input.description.en,
          input.reportGenerationEnabled,
          input.deferredResultDays,
          actor.user.id,
          actor.user.email,
        ],
      )
      await writeAdminAudit(client, actor, {
        action: 'survey_quarter.update',
        metadata: { changes, surveyVersion },
        targetId: before.id,
        targetType: SURVEY_QUARTER_AUDIT_TARGET,
      })
    })
    return this.get(surveyVersion)
  }

  async updatePage(input: SurveyQuarterPageUpdate, actor: AuditActor): Promise<SurveyQuarterPage> {
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<PageRow>('SELECT * FROM public.cwi_survey_quarter_page WHERE id = true FOR UPDATE')
      const before = mapPage(current.rows[0])
      const changes: Changes = {}
      diff(changes, 'kickerVi', before.kicker.vi, input.kicker.vi)
      diff(changes, 'kickerEn', before.kicker.en, input.kicker.en)
      diff(changes, 'titleVi', before.title.vi, input.title.vi)
      diff(changes, 'titleEn', before.title.en, input.title.en)
      diff(changes, 'descriptionVi', before.description.vi, input.description.vi)
      diff(changes, 'descriptionEn', before.description.en, input.description.en)
      if (current.rows[0] && !Object.keys(changes).length) return
      await client.query(
        `INSERT INTO public.cwi_survey_quarter_page (id, kicker_vi, kicker_en, title_vi, title_en, description_vi, description_en, updated_by_admin_id, updated_by_email)
        VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE
        SET kicker_vi = EXCLUDED.kicker_vi, kicker_en = EXCLUDED.kicker_en, title_vi = EXCLUDED.title_vi, title_en = EXCLUDED.title_en,
            description_vi = EXCLUDED.description_vi, description_en = EXCLUDED.description_en,
            updated_by_admin_id = EXCLUDED.updated_by_admin_id, updated_by_email = EXCLUDED.updated_by_email`,
        [input.kicker.vi, input.kicker.en, input.title.vi, input.title.en, input.description.vi, input.description.en, actor.user.id, actor.user.email],
      )
      await writeAdminAudit(client, actor, {
        action: 'survey_quarter_page.update',
        metadata: { changes },
        targetId: null,
        targetType: SURVEY_QUARTER_PAGE_AUDIT_TARGET,
      })
    })
    return this.getPage()
  }

  // Returns the previous image so the caller can remove its file after the commit.
  async setImage(surveyVersion: string, image: SurveyQuarterImage | null, actor: AuditActor): Promise<{ previous: SurveyQuarterImage | null; quarter: SurveyQuarter }> {
    const previous = await withTransaction(this.pool, async (client) => {
      const current = await client.query<QuarterRow>('SELECT * FROM public.cwi_survey_quarters WHERE survey_version = $1 FOR UPDATE', [surveyVersion])
      const before = current.rows[0]
      if (!before) throw quarterNotFound()
      await client.query(
        `UPDATE public.cwi_survey_quarters
        SET image_storage_path = $2, image_content_type = $3, image_sha256 = $4, updated_by_admin_id = $5, updated_by_email = $6
        WHERE id = $1`,
        [before.id, image?.storagePath ?? null, image?.contentType ?? null, image?.sha256 ?? null, actor.user.id, actor.user.email],
      )
      await writeAdminAudit(client, actor, {
        action: image ? 'survey_quarter.image_upload' : 'survey_quarter.image_remove',
        metadata: { surveyVersion },
        targetId: before.id,
        targetType: SURVEY_QUARTER_AUDIT_TARGET,
      })
      return mapQuarter({ ...before, submission_count: 0, waiting_reports: 0 }).image
    })
    return { previous, quarter: await this.get(surveyVersion) }
  }
}

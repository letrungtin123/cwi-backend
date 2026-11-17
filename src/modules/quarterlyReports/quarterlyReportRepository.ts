import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { cursorTimestampSql, encodeCursor } from '../../http/cursor.js'
import { HttpError } from '../../http/errors.js'
import type { RequestMeta } from '../../http/requestMeta.js'
import { listAdminAudit, writeAdminAudit, type AuditActor, type AuditEntry } from '../audit/adminAuditLog.js'
import {
  defaultQuarterlyReportTitle,
  quarterlyReportLabel,
  quarterlyReportSlug,
  REPORT_LANGUAGES,
  type Bilingual,
  type QuarterlyReportCreateInput,
  type QuarterlyReportDownloadInput,
  type QuarterlyReportPageUpdateInput,
  type QuarterlyReportUpdateInput,
  type ReportLanguage,
} from './quarterlyReportValidation.js'

// Quarterly reports ("Báo cáo quý"): one row per quarter in cwi_quarterly_reports with a
// Vietnamese PDF (the original file columns) and an English PDF (en_* columns), shown as
// cards on /bao-cao-quy. A quarter is listed when it is visible and has at least one PDF.
// The heading above the cards is cwi_quarterly_report_page.

export const QUARTERLY_REPORT_AUDIT_TARGET = 'quarterly_report'
export const QUARTERLY_REPORT_PAGE_AUDIT_TARGET = 'quarterly_report_page'

export type QuarterlyReportFile = {
  fileName: string
  fileSize: number
  sha256: string
  storagePath: string
  uploadedAt: string
}

export type QuarterlyReportImage = {
  contentType: string
  sha256: string
  storagePath: string
}

export type QuarterlyReport = {
  description: Bilingual
  downloadRequests: number
  files: Record<ReportLanguage, QuarterlyReportFile | null>
  id: string
  image: QuarterlyReportImage | null
  isVisible: boolean
  label: Bilingual
  periodQuarter: number
  periodYear: number
  slug: string
  sortOrder: number
  title: Bilingual
  updatedAt: string
  updatedByEmail: string | null
}

export type QuarterlyReportPage = {
  description: Bilingual
  kicker: Bilingual
  title: Bilingual
  updatedAt: string | null
  updatedByEmail: string | null
}

// Shape the previous landing page reads from /active and /:slug (Vietnamese text).
export type QuarterlyReportLegacyPublic = {
  id: string
  periodQuarter: number
  periodYear: number
  slug: string
  subtitle: string
  title: string
}

export type QuarterlyReportDownload = {
  deduplicated: boolean
  id: string
  requestedAt: string
}

export type QuarterlyReportDownloadListItem = {
  downloadCount: number
  email: string
  fullName: string
  id: string
  // PDFs this person downloaded: vi, en.
  languages: ReportLanguage[]
  lastDownloadedAt: string | null
  phone: string
  position: string
  reportPeriod: string
  reportSlug: string
  requestedAt: string
}

export type QuarterlyReportDownloadStats = {
  downloadedCount: number
  todayRequests: number
  totalRequests: number
}

export type CursorPage<T> = {
  hasNextPage: boolean
  items: T[]
  nextCursor: string | null
  // Rows matching the filters across all pages.
  totalCount: number
}

type ReportRow = {
  download_requests: number
  en_file_size: string | null
  en_original_file_name: string | null
  en_sha256: string | null
  en_storage_path: string | null
  en_uploaded_at: Date | null
  file_size: string | null
  id: string
  image_content_type: string | null
  image_sha256: string | null
  image_storage_path: string | null
  is_visible: boolean
  original_file_name: string | null
  period_quarter: number
  period_year: number
  sha256: string | null
  slug: string
  sort_order: number
  storage_path: string | null
  subtitle: string
  subtitle_en: string
  title: string
  title_en: string
  updated_at: Date
  updated_by_email: string | null
  uploaded_at: Date
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

type DownloadRow = {
  cursor_at: string
  download_count: number
  downloaded_languages: string[]
  email: string
  full_name: string
  id: string
  last_downloaded_at: Date | null
  phone: string
  position: string
  report_quarter: number
  report_slug: string
  report_year: number
  requested_at: Date
}

// Shown until the page row exists (the migration creates it).
const defaultPage: QuarterlyReportPage = {
  description: {
    en: "Read each quarter's report to follow how leadership teams and organizational capabilities of Vietnamese companies are changing.",
    vi: 'Đọc báo cáo của từng quý để theo dõi bức tranh đội ngũ quản lý và năng lực tổ chức của doanh nghiệp Việt Nam.',
  },
  kicker: { en: 'CEO Workforce Index · 2026 Reports', vi: 'CEO Workforce Index · Báo cáo 2026' },
  title: { en: 'Quarterly reports', vi: 'Báo cáo theo quý' },
  updatedAt: null,
  updatedByEmail: null,
}

const reportSelect = `
  SELECT
    report.id, report.period_year, report.period_quarter, report.slug,
    report.title, report.title_en, report.subtitle, report.subtitle_en,
    report.is_visible, report.sort_order,
    report.storage_path, report.original_file_name, report.file_size, report.sha256, report.uploaded_at,
    report.en_storage_path, report.en_original_file_name, report.en_file_size, report.en_sha256, report.en_uploaded_at,
    report.image_storage_path, report.image_content_type, report.image_sha256,
    report.updated_at, report.updated_by_email,
    (SELECT count(*)::int FROM public.cwi_quarterly_report_downloads AS download WHERE download.report_id = report.id) AS download_requests
  FROM public.cwi_quarterly_reports AS report`

const cardOrder = 'ORDER BY report.sort_order ASC, report.period_year ASC, report.period_quarter ASC'

function toIso(value: Date) {
  return value.toISOString()
}

function mapReport(row: ReportRow): QuarterlyReport {
  return {
    description: { en: row.subtitle_en, vi: row.subtitle },
    downloadRequests: row.download_requests,
    files: {
      en: row.en_storage_path && row.en_original_file_name && row.en_file_size && row.en_sha256 && row.en_uploaded_at
        ? { fileName: row.en_original_file_name, fileSize: Number(row.en_file_size), sha256: row.en_sha256, storagePath: row.en_storage_path, uploadedAt: toIso(row.en_uploaded_at) }
        : null,
      vi: row.storage_path && row.original_file_name && row.file_size && row.sha256
        ? { fileName: row.original_file_name, fileSize: Number(row.file_size), sha256: row.sha256, storagePath: row.storage_path, uploadedAt: toIso(row.uploaded_at) }
        : null,
    },
    id: row.id,
    image: row.image_storage_path && row.image_content_type && row.image_sha256
      ? { contentType: row.image_content_type, sha256: row.image_sha256, storagePath: row.image_storage_path }
      : null,
    isVisible: row.is_visible,
    label: quarterlyReportLabel(row.period_year, row.period_quarter),
    periodQuarter: row.period_quarter,
    periodYear: row.period_year,
    slug: row.slug,
    sortOrder: row.sort_order,
    title: { en: row.title_en, vi: row.title },
    updatedAt: toIso(row.updated_at),
    updatedByEmail: row.updated_by_email,
  }
}

function mapPage(row: PageRow | undefined): QuarterlyReportPage {
  if (!row) return defaultPage
  return {
    description: { en: row.description_en, vi: row.description_vi },
    kicker: { en: row.kicker_en, vi: row.kicker_vi },
    title: { en: row.title_en, vi: row.title_vi },
    updatedAt: toIso(row.updated_at),
    updatedByEmail: row.updated_by_email,
  }
}

function mapDownload(row: DownloadRow): QuarterlyReportDownloadListItem {
  return {
    downloadCount: row.download_count,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    languages: REPORT_LANGUAGES.filter((language) => row.downloaded_languages.includes(language)),
    lastDownloadedAt: row.last_downloaded_at ? toIso(row.last_downloaded_at) : null,
    phone: row.phone,
    position: row.position,
    reportPeriod: `Quý ${row.report_quarter}/${row.report_year}`,
    reportSlug: row.report_slug,
    requestedAt: toIso(row.requested_at),
  }
}

// Listed on /bao-cao-quy: visible, with at least one PDF.
export function isListed(report: Pick<QuarterlyReport, 'files' | 'isVisible'>) {
  return report.isVisible && Boolean(report.files.vi || report.files.en)
}

// The PDF to open: the one asked for, else the other language.
export function pickReportFile(report: Pick<QuarterlyReport, 'files'>, language: ReportLanguage | null) {
  const wanted = language ?? 'vi'
  const other: ReportLanguage = wanted === 'vi' ? 'en' : 'vi'
  if (report.files[wanted]) return { file: report.files[wanted], language: wanted }
  if (report.files[other]) return { file: report.files[other], language: other }
  return null
}

function toLegacy(report: QuarterlyReport): QuarterlyReportLegacyPublic {
  return { id: report.id, periodQuarter: report.periodQuarter, periodYear: report.periodYear, slug: report.slug, subtitle: report.description.vi, title: report.title.vi }
}

function reportNotFound() {
  return new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý này. Vui lòng tải lại trang.')
}

type Changes = Record<string, { from: unknown; to: unknown }>

function diff(changes: Changes, key: string, from: unknown, to: unknown) {
  if (from !== to) changes[key] = { from, to }
}

export function diffQuarterlyReport(before: QuarterlyReport, input: QuarterlyReportUpdateInput): Changes {
  const changes: Changes = {}
  diff(changes, 'isVisible', before.isVisible, input.isVisible)
  diff(changes, 'sortOrder', before.sortOrder, input.sortOrder)
  diff(changes, 'titleVi', before.title.vi, input.title.vi)
  diff(changes, 'titleEn', before.title.en, input.title.en)
  diff(changes, 'descriptionVi', before.description.vi, input.description.vi)
  diff(changes, 'descriptionEn', before.description.en, input.description.en)
  return changes
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

// is_active is what the previous release shows: keep it on the newest listed quarter with a
// Vietnamese PDF, so a rollback shows the right report. Two statements, because the
// "one active" unique index is checked row by row.
async function syncLegacyActive(client: pg.PoolClient) {
  const target = await client.query<{ id: string }>(
    `SELECT id FROM public.cwi_quarterly_reports
    WHERE is_visible AND storage_path IS NOT NULL
    ORDER BY period_year DESC, period_quarter DESC
    LIMIT 1`,
  )
  const id = target.rows[0]?.id ?? null
  await client.query('UPDATE public.cwi_quarterly_reports SET is_active = false WHERE is_active AND id IS DISTINCT FROM $1', [id])
  if (id) await client.query('UPDATE public.cwi_quarterly_reports SET is_active = true WHERE id = $1 AND NOT is_active', [id])
}

export class PgQuarterlyReportRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly cursorSecret: string,
  ) {}

  // Every quarter, in card order.
  async list(): Promise<QuarterlyReport[]> {
    const result = await this.pool.query<ReportRow>(`${reportSelect} ${cardOrder}`)
    return result.rows.map(mapReport)
  }

  async findBySlug(slug: string): Promise<QuarterlyReport | null> {
    const result = await this.pool.query<ReportRow>(`${reportSelect} WHERE report.slug = $1`, [slug])
    return result.rows[0] ? mapReport(result.rows[0]) : null
  }

  async getBySlug(slug: string): Promise<QuarterlyReport> {
    const report = await this.findBySlug(slug)
    if (!report) throw reportNotFound()
    return report
  }

  // A listed quarter, or null (hidden, without a PDF, or unknown).
  async findListed(slug: string): Promise<QuarterlyReport | null> {
    const report = await this.findBySlug(slug)
    return report && isListed(report) ? report : null
  }

  // The previous landing page: /active opens the newest listed quarter.
  async getActiveLegacy(): Promise<QuarterlyReportLegacyPublic | null> {
    const listed = (await this.list()).filter(isListed)
    const newest = listed.sort((a, b) => b.periodYear - a.periodYear || b.periodQuarter - a.periodQuarter)[0]
    return newest ? toLegacy(newest) : null
  }

  async getListedLegacy(slug: string): Promise<QuarterlyReportLegacyPublic | null> {
    const report = await this.findListed(slug)
    return report ? toLegacy(report) : null
  }

  async getPage(): Promise<QuarterlyReportPage> {
    const result = await this.pool.query<PageRow>(
      `SELECT kicker_vi, kicker_en, title_vi, title_en, description_vi, description_en, updated_by_email, updated_at
      FROM public.cwi_quarterly_report_page
      WHERE id = true`,
    )
    return mapPage(result.rows[0])
  }

  async history(slug: string): Promise<AuditEntry[]> {
    const report = await this.getBySlug(slug)
    return listAdminAudit(this.pool, QUARTERLY_REPORT_AUDIT_TARGET, report.id)
  }

  // A new quarter starts hidden, without files, after the existing cards.
  async create(input: QuarterlyReportCreateInput, actor: AuditActor): Promise<QuarterlyReport> {
    const slug = quarterlyReportSlug(input.periodYear, input.periodQuarter)
    const title = defaultQuarterlyReportTitle(input.periodYear, input.periodQuarter)
    try {
      await withTransaction(this.pool, async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO public.cwi_quarterly_reports (
            period_year, period_quarter, slug, title, title_en, subtitle, subtitle_en, is_visible, sort_order, updated_by_admin_id, updated_by_email
          )
          SELECT $1, $2, $3, $4, $5, '', '', false, LEAST(999, COALESCE(max(sort_order), 0) + 1), $6, $7
          FROM public.cwi_quarterly_reports
          RETURNING id`,
          [input.periodYear, input.periodQuarter, slug, title.vi, title.en, actor.user.id, actor.user.email],
        )
        await writeAdminAudit(client, actor, {
          action: 'quarterly_report.create',
          metadata: { slug },
          targetId: created.rows[0]?.id ?? null,
          targetType: QUARTERLY_REPORT_AUDIT_TARGET,
        })
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'quarterly_report_exists', `Quý ${input.periodQuarter}/${input.periodYear} đã có trong danh sách.`)
      throw error
    }
    return this.getBySlug(slug)
  }

  // Saving with nothing changed writes nothing.
  async update(slug: string, input: QuarterlyReportUpdateInput, actor: AuditActor): Promise<QuarterlyReport> {
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<ReportRow>(`${reportSelect} WHERE report.slug = $1 FOR UPDATE OF report`, [slug])
      const row = current.rows[0]
      if (!row) throw reportNotFound()
      const before = mapReport(row)
      const changes = diffQuarterlyReport(before, input)
      if (!Object.keys(changes).length) return
      await client.query(
        `UPDATE public.cwi_quarterly_reports
        SET is_visible = $2, sort_order = $3, title = $4, title_en = $5, subtitle = $6, subtitle_en = $7,
            updated_by_admin_id = $8, updated_by_email = $9
        WHERE id = $1`,
        [before.id, input.isVisible, input.sortOrder, input.title.vi, input.title.en, input.description.vi, input.description.en, actor.user.id, actor.user.email],
      )
      await syncLegacyActive(client)
      await writeAdminAudit(client, actor, {
        action: 'quarterly_report.update',
        metadata: { changes, slug },
        targetId: before.id,
        targetType: QUARTERLY_REPORT_AUDIT_TARGET,
      })
    })
    return this.getBySlug(slug)
  }

  // Points the quarter at a new PDF (or none). Returns the previous file so the caller can
  // remove it from storage after the commit.
  async setFile(
    slug: string,
    language: ReportLanguage,
    file: (Omit<QuarterlyReportFile, 'uploadedAt'> & { storageBucket: string }) | null,
    actor: AuditActor,
  ): Promise<{ previous: QuarterlyReportFile | null; report: QuarterlyReport }> {
    const previous = await withTransaction(this.pool, async (client) => {
      const current = await client.query<ReportRow>(`${reportSelect} WHERE report.slug = $1 FOR UPDATE OF report`, [slug])
      const row = current.rows[0]
      if (!row) throw reportNotFound()
      const before = mapReport(row)
      if (language === 'vi') {
        await client.query(
          `UPDATE public.cwi_quarterly_reports
          SET storage_bucket = $2, storage_path = $3, original_file_name = $4, file_size = $5, sha256 = $6,
              uploaded_by = $7, uploaded_at = now(), updated_by_admin_id = $7, updated_by_email = $8
          WHERE id = $1`,
          [before.id, file?.storageBucket ?? null, file?.storagePath ?? null, file?.fileName ?? null, file?.fileSize ?? null, file?.sha256 ?? null, actor.user.id, actor.user.email],
        )
      } else {
        await client.query(
          `UPDATE public.cwi_quarterly_reports
          SET en_storage_path = $2, en_original_file_name = $3, en_file_size = $4, en_sha256 = $5,
              en_uploaded_by = $6, en_uploaded_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END,
              updated_by_admin_id = $6, updated_by_email = $7
          WHERE id = $1`,
          [before.id, file?.storagePath ?? null, file?.fileName ?? null, file?.fileSize ?? null, file?.sha256 ?? null, actor.user.id, actor.user.email],
        )
      }
      await syncLegacyActive(client)
      await writeAdminAudit(client, actor, {
        action: file ? 'quarterly_report.file_upload' : 'quarterly_report.file_remove',
        metadata: { fileName: file?.fileName ?? before.files[language]?.fileName ?? null, language, slug },
        targetId: before.id,
        targetType: QUARTERLY_REPORT_AUDIT_TARGET,
      })
      return before.files[language]
    })
    return { previous, report: await this.getBySlug(slug) }
  }

  async setImage(slug: string, image: QuarterlyReportImage | null, actor: AuditActor): Promise<{ previous: QuarterlyReportImage | null; report: QuarterlyReport }> {
    const previous = await withTransaction(this.pool, async (client) => {
      const current = await client.query<ReportRow>(`${reportSelect} WHERE report.slug = $1 FOR UPDATE OF report`, [slug])
      const row = current.rows[0]
      if (!row) throw reportNotFound()
      const before = mapReport(row)
      await client.query(
        `UPDATE public.cwi_quarterly_reports
        SET image_storage_path = $2, image_content_type = $3, image_sha256 = $4, updated_by_admin_id = $5, updated_by_email = $6
        WHERE id = $1`,
        [before.id, image?.storagePath ?? null, image?.contentType ?? null, image?.sha256 ?? null, actor.user.id, actor.user.email],
      )
      await writeAdminAudit(client, actor, {
        action: image ? 'quarterly_report.image_upload' : 'quarterly_report.image_remove',
        metadata: { slug },
        targetId: before.id,
        targetType: QUARTERLY_REPORT_AUDIT_TARGET,
      })
      return before.image
    })
    return { previous, report: await this.getBySlug(slug) }
  }

  async updatePage(input: QuarterlyReportPageUpdateInput, actor: AuditActor): Promise<QuarterlyReportPage> {
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<PageRow>('SELECT * FROM public.cwi_quarterly_report_page WHERE id = true FOR UPDATE')
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
        `INSERT INTO public.cwi_quarterly_report_page (id, kicker_vi, kicker_en, title_vi, title_en, description_vi, description_en, updated_by_admin_id, updated_by_email)
        VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE
        SET kicker_vi = EXCLUDED.kicker_vi, kicker_en = EXCLUDED.kicker_en, title_vi = EXCLUDED.title_vi, title_en = EXCLUDED.title_en,
            description_vi = EXCLUDED.description_vi, description_en = EXCLUDED.description_en,
            updated_by_admin_id = EXCLUDED.updated_by_admin_id, updated_by_email = EXCLUDED.updated_by_email`,
        [input.kicker.vi, input.kicker.en, input.title.vi, input.title.en, input.description.vi, input.description.en, actor.user.id, actor.user.email],
      )
      await writeAdminAudit(client, actor, {
        action: 'quarterly_report_page.update',
        metadata: { changes },
        targetId: null,
        targetType: QUARTERLY_REPORT_PAGE_AUDIT_TARGET,
      })
    })
    return this.getPage()
  }

  // One request per person (email) and quarter; the language only decides which PDF the
  // download link sends.
  async registerDownload(report: Pick<QuarterlyReport, 'id'>, input: QuarterlyReportDownloadInput, meta: RequestMeta): Promise<QuarterlyReportDownload> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (input.idempotencyKey) {
        const idempotent = await client.query<{ email: string; id: string; payload_hash: string; report_id: string; requested_at: Date }>(
          `SELECT id, report_id, email, payload_hash, requested_at FROM public.cwi_quarterly_report_downloads WHERE idempotency_key = $1 LIMIT 1`,
          [input.idempotencyKey],
        )
        const row = idempotent.rows[0]
        if (row) {
          if (row.report_id !== report.id || row.email.trim().toLowerCase() !== input.email || row.payload_hash !== input.payloadHash) {
            throw new HttpError(409, 'quarterly_report_idempotency_key_conflict', 'Lần tải báo cáo này không khớp với dữ liệu trước đó.')
          }
          await client.query('COMMIT')
          return { deduplicated: true, id: row.id, requestedAt: toIso(row.requested_at) }
        }
      }

      const existing = await client.query<{ id: string; requested_at: Date }>(
        `SELECT id, requested_at FROM public.cwi_quarterly_report_downloads WHERE report_id = $1 AND lower(btrim(email)) = $2 FOR UPDATE`,
        [report.id, input.email],
      )
      if (existing.rows[0]) {
        await client.query('COMMIT')
        return { deduplicated: true, id: existing.rows[0].id, requestedAt: toIso(existing.rows[0].requested_at) }
      }

      const inserted = await client.query<{ id: string; requested_at: Date }>(
        [
          `INSERT INTO public.cwi_quarterly_report_downloads (`,
          `  report_id, full_name, email, phone, position, privacy_consent, idempotency_key, payload_hash, source, client_ip_hash, user_agent, client_meta`,
          `) VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9, $10, $11::jsonb)`,
          `RETURNING id, requested_at`,
        ].join('\n'),
        [report.id, input.fullName, input.email, input.phone, input.position, input.idempotencyKey, input.payloadHash, meta.source, meta.clientIpHash, meta.userAgent, JSON.stringify(input.clientMeta)],
      )
      const row = inserted.rows[0]
      if (!row) throw new Error('Quarterly report download insert returned no row.')
      await client.query('COMMIT')
      return { deduplicated: false, id: row.id, requestedAt: toIso(row.requested_at) }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514' && 'constraint' in error && error.constraint === 'cwi_quarterly_report_downloads_email_check') {
        throw new HttpError(422, 'invalid_quarterly_report_download', 'Email không hợp lệ.')
      }
      if (isUniqueViolation(error)) {
        const duplicate = await this.pool.query<{ id: string; requested_at: Date }>(
          `SELECT id, requested_at FROM public.cwi_quarterly_report_downloads WHERE report_id = $1 AND lower(btrim(email)) = $2 LIMIT 1`,
          [report.id, input.email],
        )
        if (duplicate.rows[0]) return { deduplicated: true, id: duplicate.rows[0].id, requestedAt: toIso(duplicate.rows[0].requested_at) }
      }
      throw error
    } finally {
      client.release()
    }
  }

  async markDownloaded(reportId: string, downloadId: string, language: ReportLanguage) {
    const result = await this.pool.query(
      `UPDATE public.cwi_quarterly_report_downloads
      SET download_count = download_count + 1,
          last_downloaded_at = now(),
          downloaded_languages = CASE WHEN $3 = ANY(downloaded_languages) THEN downloaded_languages ELSE downloaded_languages || $3::text END
      WHERE id = $1 AND report_id = $2`,
      [downloadId, reportId, language],
    )
    return result.rowCount === 1
  }

  async listDownloadsPage(input: { before: string | null; beforeId: string | null; limit: number; search: string | null }) {
    const params: unknown[] = []
    const where: string[] = []
    if (input.search) {
      params.push(`%${input.search}%`)
      where.push(`(d.full_name ILIKE $${params.length} OR d.email ILIKE $${params.length} OR d.phone ILIKE $${params.length} OR d.position ILIKE $${params.length} OR r.slug ILIKE $${params.length})`)
    }
    // The same filter without the page position gives the total behind "Trang x / y".
    const filterWhere = [...where]
    const filterParams = [...params]
    if (input.before && input.beforeId) {
      params.push(input.before, input.beforeId)
      where.push(`(d.requested_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }
    params.push(input.limit + 1)
    const total = this.pool.query<{ total: number }>(
      [
        `SELECT count(*)::int AS total`,
        `FROM public.cwi_quarterly_report_downloads d`,
        `JOIN public.cwi_quarterly_reports r ON r.id = d.report_id`,
        filterWhere.length ? `WHERE ${filterWhere.join(' AND ')}` : '',
      ].filter(Boolean).join(' '),
      filterParams,
    )
    const result = await this.pool.query<DownloadRow>(
      [
        `SELECT d.id, ${cursorTimestampSql('d.requested_at')} AS cursor_at, d.full_name, d.email, d.phone, d.position, d.requested_at, d.last_downloaded_at, d.download_count,`,
        `       d.downloaded_languages, r.slug AS report_slug, r.period_year AS report_year, r.period_quarter AS report_quarter`,
        `FROM public.cwi_quarterly_report_downloads d`,
        `JOIN public.cwi_quarterly_reports r ON r.id = d.report_id`,
        where.length ? `WHERE ${where.join(' AND ')}` : '',
        `ORDER BY d.requested_at DESC, d.id DESC LIMIT $${params.length}`,
      ].filter(Boolean).join('\n'),
      params,
    )
    const rows = result.rows.slice(0, input.limit)
    const tail = rows.at(-1)
    return {
      hasNextPage: result.rows.length > input.limit,
      items: rows.map(mapDownload),
      totalCount: (await total).rows[0]?.total ?? 0,
      nextCursor: result.rows.length > input.limit && tail ? encodeCursor(this.cursorSecret, { id: tail.id, timestamp: tail.cursor_at }) : null,
    } satisfies CursorPage<QuarterlyReportDownloadListItem>
  }

  async getDownloadStats(): Promise<QuarterlyReportDownloadStats> {
    const result = await this.pool.query<{ downloaded_count: string; today_requests: string; total_requests: string }>(
      `SELECT COUNT(*)::text AS total_requests,
              COUNT(*) FILTER (WHERE requested_at >= date_trunc('day', now()))::text AS today_requests,
              COUNT(*) FILTER (WHERE download_count > 0)::text AS downloaded_count
       FROM public.cwi_quarterly_report_downloads`,
    )
    const row = result.rows[0] ?? { downloaded_count: '0', today_requests: '0', total_requests: '0' }
    return {
      downloadedCount: Number(row.downloaded_count),
      todayRequests: Number(row.today_requests),
      totalRequests: Number(row.total_requests),
    }
  }
}

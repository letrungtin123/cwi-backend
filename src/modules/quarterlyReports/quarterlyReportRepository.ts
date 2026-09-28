import type pg from 'pg'
import { encodeCursor } from '../../http/cursor.js'
import { HttpError } from '../../http/errors.js'
import type { RequestMeta } from '../../http/requestMeta.js'
import { quarterlyReportSlug, type QuarterlyReportDownloadInput, type QuarterlyReportUploadInput } from './quarterlyReportValidation.js'

export type QuarterlyReportPublic = {
  id: string
  periodQuarter: number
  periodYear: number
  slug: string
  subtitle: string
  title: string
}

export type QuarterlyReportAdmin = QuarterlyReportPublic & {
  fileName: string
  fileSize: number
  isActive: boolean
  uploadedAt: string
  uploadedBy: string
}

export type QuarterlyReportFile = {
  fileName: string
  storagePath: string
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
}

type ReportRow = {
  file_size: string
  id: string
  is_active: boolean
  original_file_name: string
  period_quarter: number
  period_year: number
  slug: string
  storage_path: string
  subtitle: string
  title: string
  uploaded_at: Date
  uploaded_by: string
}

type DownloadRow = {
  download_count: number
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

function isDatabaseConstraintError(error: unknown, code: string, constraint: string) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
    && 'constraint' in error
    && error.constraint === constraint
}

function toIso(value: Date) {
  return value.toISOString()
}

function mapPublic(row: ReportRow): QuarterlyReportPublic {
  return {
    id: row.id,
    periodQuarter: row.period_quarter,
    periodYear: row.period_year,
    slug: row.slug,
    subtitle: row.subtitle,
    title: row.title,
  }
}

function mapAdmin(row: ReportRow): QuarterlyReportAdmin {
  return {
    ...mapPublic(row),
    fileName: row.original_file_name,
    fileSize: Number(row.file_size),
    isActive: row.is_active,
    uploadedAt: toIso(row.uploaded_at),
    uploadedBy: row.uploaded_by,
  }
}

function mapDownload(row: DownloadRow): QuarterlyReportDownloadListItem {
  return {
    downloadCount: row.download_count,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    lastDownloadedAt: row.last_downloaded_at ? toIso(row.last_downloaded_at) : null,
    phone: row.phone,
    position: row.position,
    reportPeriod: `Quý ${row.report_quarter}/${row.report_year}`,
    reportSlug: row.report_slug,
    requestedAt: toIso(row.requested_at),
  }
}

const reportSelect = `
  SELECT id, period_year, period_quarter, slug, title, subtitle, storage_path,
         original_file_name, file_size, is_active, uploaded_by, uploaded_at
  FROM public.cwi_quarterly_reports
`

export class PgQuarterlyReportRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly cursorSecret: string,
  ) {}

  async getActivePublic() {
    const result = await this.pool.query<ReportRow>(`${reportSelect} WHERE is_active = true LIMIT 1`)
    return result.rows[0] ? mapPublic(result.rows[0]) : null
  }

  async getPublicBySlug(slug: string) {
    const result = await this.pool.query<ReportRow>(`${reportSelect} WHERE slug = $1 LIMIT 1`, [slug])
    return result.rows[0] ? mapPublic(result.rows[0]) : null
  }

  async getFileBySlug(slug: string): Promise<(QuarterlyReportPublic & QuarterlyReportFile) | null> {
    const result = await this.pool.query<ReportRow>(`${reportSelect} WHERE slug = $1 LIMIT 1`, [slug])
    const row = result.rows[0]
    if (!row) return null
    return { ...mapPublic(row), fileName: row.original_file_name, storagePath: row.storage_path }
  }

  async listReports() {
    const result = await this.pool.query<ReportRow>(`${reportSelect} ORDER BY period_year DESC, period_quarter DESC`)
    return result.rows.map(mapAdmin)
  }

  async saveReport(input: QuarterlyReportUploadInput & {
    fileName: string
    fileSize: number
    sha256: string
    storageBucket: string
    storagePath: string
    uploadedBy: string
  }) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const existing = await client.query<{ storage_path: string }>(
        `SELECT storage_path FROM public.cwi_quarterly_reports WHERE period_year = $1 AND period_quarter = $2 FOR UPDATE`,
        [input.periodYear, input.periodQuarter],
      )
      if (input.activate) await client.query(`UPDATE public.cwi_quarterly_reports SET is_active = false WHERE is_active = true`)

      const saved = await client.query<ReportRow>(
        [
          `INSERT INTO public.cwi_quarterly_reports (`,
          `  period_year, period_quarter, slug, title, subtitle, storage_bucket, storage_path, original_file_name, file_size, sha256, is_active, uploaded_by`,
          `) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          `ON CONFLICT (period_year, period_quarter) DO UPDATE SET`,
          `  slug = EXCLUDED.slug, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, storage_bucket = EXCLUDED.storage_bucket,`,
          `  storage_path = EXCLUDED.storage_path, original_file_name = EXCLUDED.original_file_name, file_size = EXCLUDED.file_size,`,
          `  sha256 = EXCLUDED.sha256, is_active = EXCLUDED.is_active, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
          `RETURNING id, period_year, period_quarter, slug, title, subtitle, storage_path, original_file_name, file_size, is_active, uploaded_by, uploaded_at`,
        ].join('\n'),
        [
          input.periodYear,
          input.periodQuarter,
          quarterlyReportSlug(input.periodYear, input.periodQuarter),
          input.title,
          input.subtitle,
          input.storageBucket,
          input.storagePath,
          input.fileName,
          input.fileSize,
          input.sha256,
          input.activate,
          input.uploadedBy,
        ],
      )
      const row = saved.rows[0]
      if (!row) throw new Error('Quarterly report upsert returned no row.')
      await client.query('COMMIT')
      return { previousPath: existing.rows[0]?.storage_path ?? null, report: mapAdmin(row) }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async registerDownload(report: QuarterlyReportPublic, input: QuarterlyReportDownloadInput, meta: RequestMeta): Promise<QuarterlyReportDownload> {
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
      if (isDatabaseConstraintError(error, '23514', 'cwi_quarterly_report_downloads_email_check')) {
        throw new HttpError(422, 'invalid_quarterly_report_download', 'Email không hợp lệ.')
      }
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
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

  async markDownloaded(reportId: string, downloadId: string) {
    const result = await this.pool.query(
      `UPDATE public.cwi_quarterly_report_downloads SET download_count = download_count + 1, last_downloaded_at = now() WHERE id = $1 AND report_id = $2`,
      [downloadId, reportId],
    )
    return result.rowCount === 1
  }

  async listDownloadsPage(input: { before: Date | null; beforeId: string | null; limit: number; search: string | null }) {
    const params: unknown[] = []
    const where: string[] = []
    if (input.search) {
      params.push(`%${input.search}%`)
      where.push(`(d.full_name ILIKE $${params.length} OR d.email ILIKE $${params.length} OR d.phone ILIKE $${params.length} OR d.position ILIKE $${params.length} OR r.slug ILIKE $${params.length})`)
    }
    if (input.before && input.beforeId) {
      params.push(input.before, input.beforeId)
      where.push(`(d.requested_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }
    params.push(input.limit + 1)
    const result = await this.pool.query<DownloadRow>(
      [
        `SELECT d.id, d.full_name, d.email, d.phone, d.position, d.requested_at, d.last_downloaded_at, d.download_count,`,
        `       r.slug AS report_slug, r.period_year AS report_year, r.period_quarter AS report_quarter`,
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
      nextCursor: result.rows.length > input.limit && tail ? encodeCursor(this.cursorSecret, { id: tail.id, timestamp: tail.requested_at }) : null,
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

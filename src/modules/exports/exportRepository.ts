import type pg from 'pg'
import { randomUUID } from 'node:crypto'
import type { ExportDataset, ExportFilters, ExportJob, ExportJobRow, ClaimedExportJob } from './exportTypes.js'

type SubmissionExportRow = {
  answers_count: number
  email: string
  full_name: string
  part1_completed: boolean
  part2_completed: boolean
  position: string
  privacy_consent: string
  report_status: string | null
  roundtable_registered: boolean
  status_note: string
  submission_status: string
  submitted_at: Date
  id: string
}

type AnswerExportRow = {
  answer_text: string
  answer_value: unknown
  email: string
  full_name: string
  other_text: string | null
  part: number
  question_idx: number
  question_text: string
  submitted_at: Date
  submission_id: string
}

type RoundtableExportRow = {
  email: string
  full_name: string
  id: string
  linked_email: string | null
  linked_full_name: string | null
  linked_position: string | null
  linked_privacy_consent: string | null
  linked_report_status: string | null
  linked_submission_id: string | null
  linked_submission_status: string | null
  linked_submitted_at: Date | null
  linked_status_note: string | null
  linked_answers_count: number | null
  position: string | null
  registered_at: Date
}

export type ExportCursor = {
  id: string
  timestamp: Date
}

export type ExportBatch<T> = {
  hasMore: boolean
  nextCursor: ExportCursor | null
  rows: T[]
}

function mapFileSize(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function mapRow(row: ExportJobRow): ExportJob {
  return {
    createdAt: row.created_at.toISOString(),
    dataset: row.dataset,
    errorMessage: row.error_message,
    expiresAt: row.expires_at.toISOString(),
    fileName: row.file_name,
    fileSize: mapFileSize(row.file_size),
    id: row.id,
    rowCount: row.row_count ? Number(row.row_count) : null,
    status: row.status,
  }
}

const exportJobSelect = [
  'SELECT id, dataset, filters, status, storage_path, file_name, row_count, file_size, error_code, error_message,',
  '       attempt, locked_at, locked_by, snapshot_at, started_at, expires_at, created_at',
  'FROM public.cwi_admin_export_jobs',
].join('\n')

export class PgExportRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createJob(input: { dataset: ExportDataset; filters: ExportFilters; requestedBy: string }): Promise<ExportJob> {
    const active = await this.pool.query<ExportJobRow>(
      exportJobSelect + "\nWHERE requested_by = $1 AND dataset = $2 AND status IN ('queued', 'generating')\nORDER BY created_at ASC, id ASC\nLIMIT 1",
      [input.requestedBy, input.dataset],
    )
    if (active.rows[0]) return mapRow(active.rows[0])

    const fileName = input.dataset === 'submissions' ? 'du-lieu-khao-sat.xlsx' : 'du-lieu-roundtable.xlsx'
    try {
      const result = await this.pool.query<ExportJobRow>(
        [
          'INSERT INTO public.cwi_admin_export_jobs (id, requested_by, dataset, filters, file_name)',
          'VALUES ($1, $2, $3, $4::jsonb, $5)',
          'RETURNING id, dataset, filters, status, storage_path, file_name, row_count, file_size, error_code, error_message,',
          '          attempt, locked_at, locked_by, snapshot_at, started_at, expires_at, created_at',
        ].join('\n'),
        [randomUUID(), input.requestedBy, input.dataset, JSON.stringify(input.filters), fileName],
      )
      const row = result.rows[0]
      if (!row) throw new Error('Export job was not created.')
      return mapRow(row)
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        const existing = await this.pool.query<ExportJobRow>(
          exportJobSelect + "\nWHERE requested_by = $1 AND dataset = $2 AND status IN ('queued', 'generating')\nORDER BY created_at ASC, id ASC\nLIMIT 1",
          [input.requestedBy, input.dataset],
        )
        if (existing.rows[0]) return mapRow(existing.rows[0])
      }
      throw error
    }
  }
  async getJob(id: string, requestedBy: string): Promise<ExportJobRow | null> {
    const result = await this.pool.query<ExportJobRow>(
      exportJobSelect + '\nWHERE id = $1 AND requested_by = $2\nLIMIT 1',
      [id, requestedBy],
    )
    return result.rows[0] ?? null
  }

  async claimNext(workerId: string, lockMs: number, maxAttempts: number): Promise<ClaimedExportJob | null> {
    const result = await this.pool.query<ClaimedExportJob>(
      [
        'WITH candidate AS (',
        '  SELECT id',
        '  FROM public.cwi_admin_export_jobs',
        "  WHERE (status = 'queued' AND attempt < $2)",
        "     OR (status = 'generating' AND locked_at < now() - ($3::bigint * interval '1 millisecond') AND attempt < $2)",
        '  ORDER BY created_at ASC, id ASC',
        '  FOR UPDATE SKIP LOCKED',
        '  LIMIT 1',
        ')',
        'UPDATE public.cwi_admin_export_jobs AS job',
        "SET status = 'generating',",
        '    attempt = job.attempt + 1,',
        '    locked_at = now(),',
        '    locked_by = $1,',
        '    started_at = COALESCE(job.started_at, now()),',
        '    error_code = NULL,',
        '    error_message = NULL',
        'FROM candidate',
        'WHERE job.id = candidate.id',
        'RETURNING job.id, job.requested_by, job.dataset, job.filters, job.status, job.storage_path, job.file_name,',
        '          job.row_count, job.file_size, job.error_code, job.error_message, job.attempt, job.locked_at,',
        '          job.locked_by, job.snapshot_at, job.started_at, job.expires_at, job.created_at',
      ].join('\n'),
      [workerId, maxAttempts, lockMs],
    )
    return result.rows[0] ?? null
  }

  async markCompleted(input: { id: string; storagePath: string; fileName: string; rowCount: number; fileSize: number }) {
    await this.pool.query(
      [
        'UPDATE public.cwi_admin_export_jobs',
        "SET status = 'completed', storage_path = $2, file_name = $3, row_count = $4, file_size = $5,",
        '    locked_at = NULL, locked_by = NULL, completed_at = now(), updated_at = now()',
        "WHERE id = $1 AND status = 'generating'",
      ].join('\n'),
      [input.id, input.storagePath, input.fileName, input.rowCount, input.fileSize],
    )
  }

  async markFailed(input: { id: string; code: string; message: string; retry: boolean }) {
    await this.pool.query(
      [
        'UPDATE public.cwi_admin_export_jobs',
        "SET status = CASE WHEN $4::boolean THEN 'queued' ELSE 'failed' END,",
        '    error_code = $2, error_message = $3, locked_at = NULL, locked_by = NULL, updated_at = now()',
        "WHERE id = $1 AND status = 'generating'",
      ].join('\n'),
      [input.id, input.code, input.message.slice(0, 1000), input.retry],
    )
  }

  async expireJobs(now = new Date()): Promise<string[]> {
    const result = await this.pool.query<{ storage_path: string | null }>(
      [
        'WITH expired AS (',
        '  SELECT id, storage_path',
        '  FROM public.cwi_admin_export_jobs',
        "  WHERE status = 'completed' AND expires_at < $1",
        '  FOR UPDATE SKIP LOCKED',
        ')',
        'UPDATE public.cwi_admin_export_jobs AS job',
        "SET status = 'expired', storage_path = NULL, updated_at = now()",
        'FROM expired',
        'WHERE job.id = expired.id',
        'RETURNING expired.storage_path',
      ].join('\n'),
      [now],
    )
    return result.rows.flatMap((row) => row.storage_path ? [row.storage_path] : [])
  }

  async listSubmissionBatch(
    filters: ExportFilters,
    snapshotAt: Date,
    cursor: ExportCursor | null,
    batchSize: number,
  ): Promise<ExportBatch<SubmissionExportRow>> {
    const params: unknown[] = [snapshotAt]
    const where = ['s.submitted_at <= $1']
    if (cursor) {
      params.push(cursor.timestamp, cursor.id)
      where.push('(s.submitted_at, s.id) < ($2::timestamptz, $3::uuid)')
    }
    if (filters.status) {
      params.push(filters.status)
      where.push('s.submission_status = $' + params.length)
    }
    if (filters.roundtableRegistered !== undefined) {
      params.push(filters.roundtableRegistered)
      where.push('s.roundtable_registered = $' + params.length)
    }
    if (filters.search) {
      params.push('%' + filters.search + '%')
      where.push('(s.full_name ILIKE $' + params.length + ' OR s.email ILIKE $' + params.length + ' OR s.position ILIKE $' + params.length + ')')
    }
    params.push(batchSize + 1)
    const result = await this.pool.query<SubmissionExportRow>(
      [
        'SELECT s.id, s.full_name, s.email, s.position, s.submission_status, s.status_note, s.privacy_consent,',
        '       s.part1_completed, s.part2_completed, s.answers_count, s.roundtable_registered, s.submitted_at,',
        '       report.status AS report_status',
        'FROM public.cwi_survey_submissions AS s',
        'LEFT JOIN LATERAL (',
        '  SELECT status FROM public.cwi_report_jobs',
        '  WHERE submission_id = s.id',
        '  ORDER BY created_at DESC, id DESC',
        '  LIMIT 1',
        ') AS report ON true',
        'WHERE ' + where.join(' AND '),
        'ORDER BY s.submitted_at DESC, s.id DESC',
        'LIMIT $' + params.length + '::integer',
      ].join('\n'),
      params,
    )
    const rows = result.rows.slice(0, batchSize)
    const last = rows.at(-1)
    return {
      hasMore: result.rows.length > batchSize,
      nextCursor: last ? { id: last.id, timestamp: last.submitted_at } : null,
      rows,
    }
  }

  async listAnswerBatch(submissionIds: string[]): Promise<AnswerExportRow[]> {
    if (!submissionIds.length) return []
    const result = await this.pool.query<AnswerExportRow>(
      [
        'SELECT a.submission_id, a.question_idx, a.part, a.question_text, a.answer_text, a.answer_value, a.other_text,',
        '       s.full_name, s.email, s.submitted_at',
        'FROM public.cwi_survey_answers AS a',
        'JOIN public.cwi_survey_submissions AS s ON s.id = a.submission_id',
        'WHERE a.submission_id = ANY($1::uuid[])',
        'ORDER BY a.submission_id, a.question_idx ASC',
      ].join('\n'),
      [submissionIds],
    )
    return result.rows
  }

  async listRoundtableBatch(
    filters: ExportFilters,
    snapshotAt: Date,
    cursor: ExportCursor | null,
    batchSize: number,
  ): Promise<ExportBatch<RoundtableExportRow>> {
    const params: unknown[] = [snapshotAt]
    const where = ['r.registered_at <= $1']
    if (cursor) {
      params.push(cursor.timestamp, cursor.id)
      where.push('(r.registered_at, r.id) < ($2::timestamptz, $3::uuid)')
    }
    if (filters.linkStatus === 'linked') where.push('r.submission_id IS NOT NULL')
    if (filters.linkStatus === 'standalone') where.push('r.submission_id IS NULL')
    if (filters.search) {
      params.push('%' + filters.search + '%')
      where.push('(r.full_name ILIKE $' + params.length + ' OR r.email ILIKE $' + params.length + ' OR r.position ILIKE $' + params.length + ' OR s.full_name ILIKE $' + params.length + ' OR s.email ILIKE $' + params.length + ' OR s.position ILIKE $' + params.length + ')')
    }
    params.push(batchSize + 1)
    const result = await this.pool.query<RoundtableExportRow>(
      [
        'SELECT r.id, r.full_name, r.email, r.position, r.registered_at,',
        '       s.id AS linked_submission_id, s.full_name AS linked_full_name, s.email AS linked_email,',
        '       s.position AS linked_position, s.submission_status AS linked_submission_status,',
        '       s.status_note AS linked_status_note, s.privacy_consent AS linked_privacy_consent,',
        '       s.answers_count AS linked_answers_count, s.submitted_at AS linked_submitted_at,',
        '       report.status AS linked_report_status',
        'FROM public.cwi_roundtable_registrations AS r',
        'LEFT JOIN public.cwi_survey_submissions AS s ON s.id = r.submission_id',
        'LEFT JOIN LATERAL (',
        '  SELECT status FROM public.cwi_report_jobs',
        '  WHERE submission_id = s.id',
        '  ORDER BY created_at DESC, id DESC',
        '  LIMIT 1',
        ') AS report ON true',
        'WHERE ' + where.join(' AND '),
        'ORDER BY r.registered_at DESC, r.id DESC',
        'LIMIT $' + params.length + '::integer',
      ].join('\n'),
      params,
    )
    const rows = result.rows.slice(0, batchSize)
    const last = rows.at(-1)
    return {
      hasMore: result.rows.length > batchSize,
      nextCursor: last ? { id: last.id, timestamp: last.registered_at } : null,
      rows,
    }
  }
}
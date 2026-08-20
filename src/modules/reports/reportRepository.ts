import type pg from 'pg'
import type { ReportAccepted, ReportJobStatus } from './reportServiceClient.js'

export type ReportJobStatusValue =
  | 'pending'
  | 'queued'
  | 'queued_ai'
  | 'generating_ai'
  | 'rendering_assets'
  | 'html_ready'
  | 'generating_pdf'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'sent'

export type ClaimedReportJob = {
  aiJobId: string | null
  aiReportId: string | null
  attemptCount: number
  createdAt: Date
  htmlStoragePath: string | null
  id: string
  pollCount: number
  providerEndpoint: string
  reportType: string
  requestPayload: unknown
  status: ReportJobStatusValue
  submissionId: string
}

export type ReportJobDownload = {
  id: string
  pdfStoragePath: string
  reportType: string
  submissionId: string
}

type ClaimedReportJobRow = {
  ai_job_id: string | null
  ai_report_id: string | null
  attempt_count: number
  created_at: Date
  html_storage_path: string | null
  id: string
  poll_count: number
  provider_endpoint: string
  report_type: string
  request_payload: unknown
  status: ReportJobStatusValue
  submission_id: string
}

type ReportJobDownloadRow = {
  id: string
  pdf_storage_path: string | null
  report_type: string
  status: string
  submission_id: string
}

const readyStatuses: ReportJobStatusValue[] = [
  'pending',
  'queued_ai',
  'generating_ai',
  'rendering_assets',
  'html_ready',
  'generating_pdf',
]

function mapClaimedJob(row: ClaimedReportJobRow): ClaimedReportJob {
  return {
    aiJobId: row.ai_job_id,
    aiReportId: row.ai_report_id,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    htmlStoragePath: row.html_storage_path,
    id: row.id,
    pollCount: row.poll_count,
    providerEndpoint: row.provider_endpoint,
    reportType: row.report_type,
    requestPayload: row.request_payload,
    status: row.status,
    submissionId: row.submission_id,
  }
}

function minimalReportPayload(report: {
  assets?: unknown[]
  citations?: unknown[]
  generated_at: string
  lifecycle?: unknown
  next_action?: unknown
  report_id: string
  report_type: string
  scores?: unknown
  warnings?: string[]
}) {
  return {
    assetCount: report.assets?.length ?? 0,
    citationCount: report.citations?.length ?? 0,
    generated_at: report.generated_at,
    lifecycle: report.lifecycle ?? null,
    next_action: report.next_action ?? null,
    report_id: report.report_id,
    report_type: report.report_type,
    scores: report.scores ?? null,
    warnings: report.warnings ?? [],
  }
}

export class PgReportRepository {
  constructor(private readonly pool: pg.Pool) {}

  async claimNextReadyJob(workerId: string, lockMs: number): Promise<ClaimedReportJob | null> {
    const result = await this.pool.query<ClaimedReportJobRow>(
      `
      WITH candidate AS (
        SELECT id
        FROM public.cwi_report_jobs
        WHERE status = ANY($1::text[])
          AND (next_poll_at IS NULL OR next_poll_at <= now())
          AND (locked_at IS NULL OR locked_at < now() - ($2::double precision * interval '1 millisecond'))
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.cwi_report_jobs AS job
      SET locked_at = now(), locked_by = $3, updated_at = now()
      FROM candidate
      WHERE job.id = candidate.id
      RETURNING
        job.id,
        job.created_at,
        job.submission_id,
        job.report_type,
        job.provider_endpoint,
        job.status,
        job.request_payload,
        job.attempt_count,
        job.poll_count,
        job.ai_job_id,
        job.ai_report_id,
        job.html_storage_path
      `,
      [readyStatuses, lockMs, workerId],
    )

    const row = result.rows[0]
    return row ? mapClaimedJob(row) : null
  }

  async markAccepted(jobId: string, accepted: ReportAccepted, nextPollAt: Date) {
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        ai_job_id = $2,
        ai_status = 'queued',
        ai_status_url = $3,
        response_payload = $4::jsonb,
        status = 'queued_ai',
        next_poll_at = $5,
        last_attempt_at = now(),
        last_error_code = NULL,
        last_error_message = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [
        jobId,
        accepted.job_id,
        accepted.status_url,
        JSON.stringify({ job_id: accepted.job_id, status: accepted.status ?? 'queued', status_url: accepted.status_url }),
        nextPollAt,
      ],
    )
  }

  async markPolled(jobId: string, status: ReportJobStatus['status'], nextPollAt: Date) {
    const localStatus = status === 'queued' ? 'queued_ai' : status === 'generating' ? 'generating_ai' : status
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        ai_status = $2,
        status = $3,
        poll_count = poll_count + 1,
        next_poll_at = $4,
        last_attempt_at = now(),
        last_error_code = NULL,
        last_error_message = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [jobId, status, localStatus, nextPollAt],
    )
  }

  async markPdfGenerating(jobId: string, aiReportId: string | null = null) {
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        ai_report_id = COALESCE($2, ai_report_id),
        ai_status = 'completed',
        status = 'generating_pdf',
        next_poll_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [jobId, aiReportId],
    )
  }

  async markCompleted(
    jobId: string,
    htmlStoragePath: string,
    pdfStoragePath: string,
    pdfSha256: string,
    report: Parameters<typeof minimalReportPayload>[0],
  ) {
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        status = 'completed',
        html_storage_path = $2,
        pdf_storage_path = $3,
        pdf_sha256 = $4,
        response_payload = $5::jsonb,
        ai_completed_at = COALESCE(ai_completed_at, now()),
        pdf_generated_at = now(),
        completed_at = now(),
        next_poll_at = NULL,
        last_error_code = NULL,
        last_error_message = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [jobId, htmlStoragePath, pdfStoragePath, pdfSha256, JSON.stringify(minimalReportPayload(report))],
    )
  }

  async markRetry(jobId: string, status: ReportJobStatusValue, attemptCount: number, errorCode: string, errorMessage: string, nextPollAt: Date) {
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        status = $2,
        attempt_count = $3,
        last_attempt_at = now(),
        last_error_code = $4,
        last_error_message = $5,
        next_poll_at = $6,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [jobId, status, attemptCount, errorCode, errorMessage.slice(0, 2000), nextPollAt],
    )
  }

  async markFailed(jobId: string, attemptCount: number, errorCode: string, errorMessage: string) {
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        status = 'failed',
        attempt_count = $2,
        last_attempt_at = now(),
        last_error_code = $3,
        last_error_message = $4,
        next_poll_at = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [jobId, attemptCount, errorCode, errorMessage.slice(0, 2000)],
    )
  }

  async getReportJobDownload(jobId: string): Promise<ReportJobDownload | null> {
    const result = await this.pool.query<ReportJobDownloadRow>(
      `
      SELECT id, submission_id, report_type, status, pdf_storage_path
      FROM public.cwi_report_jobs
      WHERE id = $1
      LIMIT 1
      `,
      [jobId],
    )
    const row = result.rows[0]
    if (!row || row.status !== 'completed' || !row.pdf_storage_path) return null
    return {
      id: row.id,
      pdfStoragePath: row.pdf_storage_path,
      reportType: row.report_type,
      submissionId: row.submission_id,
    }
  }
}
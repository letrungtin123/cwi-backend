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

export type ReportJobAsset = {
  storagePath: string
}

export type PublicReportJob = {
  createdAt: string
  emailStatus: string
  htmlAvailable: boolean
  id: string
  pdfAvailable: boolean
  reportType: string
  status: ReportJobStatusValue
  updatedAt: string
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

  async markHtmlReady(jobId: string, htmlStoragePath: string, report: Parameters<typeof minimalReportPayload>[0]) {
    await this.pool.query(
      `
      UPDATE public.cwi_report_jobs
      SET
        status = 'html_ready',
        html_storage_path = $2,
        response_payload = $3::jsonb,
        ai_completed_at = COALESCE(ai_completed_at, now()),
        next_poll_at = NULL,
        last_error_code = NULL,
        last_error_message = NULL,
        updated_at = now()
      WHERE id = $1
      `,
      [jobId, htmlStoragePath, JSON.stringify(minimalReportPayload(report))],
    )
  }

  async markCompleted(
    jobId: string,
    pdfStoragePath: string,
    pdfSha256: string,
    delivery?: {
      enabled: boolean
      fileName: string
      storageBucket: string
    },
  ) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const completed = await client.query<{ submission_id: string }>(
        `
        UPDATE public.cwi_report_jobs
        SET
          status = 'completed',
          pdf_storage_path = $2,
          pdf_sha256 = $3,
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
        RETURNING submission_id
        `,
        [jobId, pdfStoragePath, pdfSha256],
      )

      if (delivery?.enabled && completed.rows[0]) {
        await client.query(
          `
          INSERT INTO public.cwi_report_email_jobs (
            campaign_id,
            report_job_id,
            submission_id,
            recipient_email,
            recipient_name,
            storage_bucket,
            storage_path,
            original_file_name,
            file_sha256,
            status,
            next_attempt_at
          )
          SELECT
            NULL,
            $1,
            submission.id,
            submission.email,
            submission.full_name,
            $3,
            $4,
            $5,
            $6,
            'queued',
            now()
          FROM public.cwi_survey_submissions AS submission
          WHERE submission.id = $2
            AND NOT EXISTS (
              SELECT 1
              FROM public.cwi_submission_report_files AS manual_file
              WHERE manual_file.submission_id = submission.id
            )
          ON CONFLICT (submission_id) DO UPDATE
          SET
            report_job_id = EXCLUDED.report_job_id,
            recipient_email = EXCLUDED.recipient_email,
            recipient_name = EXCLUDED.recipient_name,
            storage_bucket = EXCLUDED.storage_bucket,
            storage_path = EXCLUDED.storage_path,
            original_file_name = EXCLUDED.original_file_name,
            file_sha256 = EXCLUDED.file_sha256,
            status = CASE WHEN cwi_report_email_jobs.status = 'failed' THEN 'queued' ELSE cwi_report_email_jobs.status END,
            next_attempt_at = CASE WHEN cwi_report_email_jobs.status IN ('queued', 'failed') THEN now() ELSE cwi_report_email_jobs.next_attempt_at END,
            published_at = CASE WHEN cwi_report_email_jobs.status IN ('queued', 'failed') THEN NULL ELSE cwi_report_email_jobs.published_at END,
            publish_locked_at = CASE WHEN cwi_report_email_jobs.status IN ('queued', 'failed') THEN NULL ELSE cwi_report_email_jobs.publish_locked_at END,
            publish_locked_by = CASE WHEN cwi_report_email_jobs.status IN ('queued', 'failed') THEN NULL ELSE cwi_report_email_jobs.publish_locked_by END,
            last_error_code = CASE WHEN cwi_report_email_jobs.status IN ('queued', 'failed') THEN NULL ELSE cwi_report_email_jobs.last_error_code END,
            last_error_message = CASE WHEN cwi_report_email_jobs.status IN ('queued', 'failed') THEN NULL ELSE cwi_report_email_jobs.last_error_message END,
            updated_at = now()
          WHERE cwi_report_email_jobs.campaign_id IS NULL
            AND cwi_report_email_jobs.status IN ('queued', 'failed')
          `,
          [jobId, completed.rows[0].submission_id, delivery.storageBucket, pdfStoragePath, delivery.fileName, pdfSha256],
        )
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async getPublicReportJob(jobId: string): Promise<PublicReportJob | null> {
    const result = await this.pool.query<{
      created_at: Date
      email_status: string | null
      html_storage_path: string | null
      id: string
      pdf_storage_path: string | null
      report_type: string
      status: ReportJobStatusValue
      updated_at: Date
    }>(
      `
      SELECT
        job.id,
        job.report_type,
        job.status,
        job.html_storage_path,
        job.pdf_storage_path,
        job.created_at,
        job.updated_at,
        email.status AS email_status
      FROM public.cwi_report_jobs AS job
      LEFT JOIN LATERAL (
        SELECT email_job.status
        FROM public.cwi_report_email_jobs AS email_job
        WHERE email_job.report_job_id = job.id
        ORDER BY email_job.created_at DESC, email_job.id DESC
        LIMIT 1
      ) AS email ON true
      WHERE job.id = $1
      LIMIT 1
      `,
      [jobId],
    )
    const row = result.rows[0]
    if (!row) return null

    return {
      createdAt: row.created_at.toISOString(),
      emailStatus: row.email_status ?? 'not_sent',
      htmlAvailable: Boolean(row.html_storage_path),
      id: row.id,
      pdfAvailable: Boolean(row.pdf_storage_path && row.status === 'completed'),
      reportType: row.report_type,
      status: row.status,
      updatedAt: row.updated_at.toISOString(),
    }
  }

  async getReportJobAsset(jobId: string, asset: 'html' | 'pdf'): Promise<ReportJobAsset | null> {
    const column = asset === 'html' ? 'html_storage_path' : 'pdf_storage_path'
    const result = await this.pool.query<{ storage_path: string | null }>(
      `
      SELECT ${column} AS storage_path
      FROM public.cwi_report_jobs
      WHERE id = $1
        AND ${asset === 'pdf' ? "status = 'completed'" : "html_storage_path IS NOT NULL"}
      LIMIT 1
      `,
      [jobId],
    )
    const storagePath = result.rows[0]?.storage_path
    return storagePath ? { storagePath } : null
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

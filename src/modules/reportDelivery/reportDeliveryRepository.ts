import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { ClaimedEmailJob, ReportDeliveryCampaign, ReportDeliveryFile, ReportDeliveryStatus } from './reportDeliveryTypes.js'

type FileRow = {
  submission_id: string
  storage_bucket: string | null
  storage_path: string | null
  original_file_name: string | null
  file_size: string | number | null
  sha256: string | null
  uploaded_at: Date | null
  locked_at: Date | null
  sent_at?: Date | null
  last_error_message?: string | null
}

type CampaignRow = {
  id: string
  requested_by: string
  snapshot_at: Date
  status: ReportDeliveryCampaign['status']
  total_users: string | number
  eligible_users: string | number
  missing_pdf_users: string | number
  queued_count: string | number
  sent_count: string | number
  failed_count: string | number
  error_code: string | null
  error_message: string | null
  expires_at: Date
  created_at: Date
  started_at: Date | null
  completed_at: Date | null
}

function count(value: string | number) {
  return Number(value)
}

function mapFile(row: FileRow | null): ReportDeliveryFile {
  if (!row || !row.storage_path || !row.uploaded_at) return { available: false, fileName: null, fileSize: null, uploadedAt: null, lockedAt: null, downloadUrl: null }
  return {
    available: true,
    fileName: row.original_file_name ?? "bao-cao-ceo-workforce-index.pdf",
    fileSize: row.file_size === null ? null : count(row.file_size),
    lockedAt: row.locked_at?.toISOString() ?? null,
    uploadedAt: row.uploaded_at.toISOString(),
    downloadUrl: null,
  }
}

function mapCampaign(row: CampaignRow): ReportDeliveryCampaign {
  return {
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    eligibleUsers: count(row.eligible_users),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    expiresAt: row.expires_at.toISOString(),
    failedCount: count(row.failed_count),
    id: row.id,
    missingPdfUsers: count(row.missing_pdf_users),
    queuedCount: count(row.queued_count),
    sentCount: count(row.sent_count),
    snapshotAt: row.snapshot_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    status: row.status,
    totalUsers: count(row.total_users),
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
}

export class ReportDeliveryRepositoryError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) {
    super(message)
    this.name = 'ReportDeliveryRepositoryError'
  }
}

const fileSelect = 'submission_id, storage_bucket, storage_path, original_file_name, file_size, sha256, uploaded_at, locked_at'

export class PgReportDeliveryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async getStatus(submissionId: string): Promise<ReportDeliveryStatus> {
    const result = await this.pool.query<FileRow & { email_status: string | null }>(
      [
        `SELECT s.id AS submission_id, f.storage_bucket, f.storage_path, f.original_file_name, f.file_size, f.sha256, f.uploaded_at, f.locked_at,`,
        `       job.status AS email_status, job.sent_at, job.last_error_message`,
        `FROM public.cwi_survey_submissions s`,
        `LEFT JOIN public.cwi_submission_report_files f ON f.submission_id = s.id`,
        `LEFT JOIN public.cwi_report_email_jobs job ON job.submission_id = s.id`,
        `WHERE s.id = $1 LIMIT 1`,
      ].join('\n'),
      [submissionId],
    )
    const row = result.rows[0]
    if (!row) throw new ReportDeliveryRepositoryError('submission_not_found', 404, 'Không tìm thấy lượt gửi khảo sát.')
    return { emailLastError: row.last_error_message ?? null, emailSentAt: row.sent_at?.toISOString() ?? null, emailStatus: (row.email_status ?? 'not_sent') as ReportDeliveryStatus['emailStatus'], file: mapFile(row), submissionId }
  }

  async getStatuses(submissionIds: string[]) {
    if (!submissionIds.length) return []
    const result = await this.pool.query<FileRow & { email_status: string | null }>(
      [
        `SELECT s.id AS submission_id, f.storage_bucket, f.storage_path, f.original_file_name, f.file_size, f.sha256, f.uploaded_at, f.locked_at,`,
        `       job.status AS email_status, job.sent_at, job.last_error_message`,
        `FROM public.cwi_survey_submissions s`,
        `LEFT JOIN public.cwi_submission_report_files f ON f.submission_id = s.id`,
        `LEFT JOIN public.cwi_report_email_jobs job ON job.submission_id = s.id`,
        `WHERE s.id = ANY($1::uuid[]) ORDER BY s.submitted_at DESC, s.id DESC`,
      ].join('\n'),
      [submissionIds],
    )
    return result.rows.map((row) => ({ emailLastError: row.last_error_message ?? null, emailSentAt: row.sent_at?.toISOString() ?? null, emailStatus: (row.email_status ?? 'not_sent') as ReportDeliveryStatus['emailStatus'], file: mapFile(row), submissionId: row.submission_id }))
  }

  async getFileRecord(submissionId: string) {
    const result = await this.pool.query<FileRow>(`SELECT ${fileSelect} FROM public.cwi_submission_report_files WHERE submission_id = $1`, [submissionId])
    return result.rows[0] ?? null
  }

  async getFile(submissionId: string) {
    return mapFile(await this.getFileRecord(submissionId))
  }

  async saveFile(input: { fileName: string; fileSize: number; sha256: string; storageBucket: string; storagePath: string; submissionId: string; uploadedBy: string }) {
    const client = await this.pool.connect()
    let previousPath: string | null = null
    try {
      await client.query('BEGIN')
      const current = await client.query<FileRow>(`SELECT ${fileSelect} FROM public.cwi_submission_report_files WHERE submission_id = $1 FOR UPDATE`, [input.submissionId])
      previousPath = current.rows[0]?.storage_path ?? null
      if (current.rows[0]?.locked_at) throw new ReportDeliveryRepositoryError('report_file_locked', 409, 'Báo cáo đã gửi, không thể thay thế file PDF.')
      const job = await client.query<{ status: string }>('SELECT status FROM public.cwi_report_email_jobs WHERE submission_id = $1 FOR UPDATE', [input.submissionId])
      if (job.rows[0]?.status === 'sending' || job.rows[0]?.status === 'sent') throw new ReportDeliveryRepositoryError('report_file_locked', 409, 'Báo cáo đang hoặc đã được gửi, không thể thay thế file PDF.')
      await client.query(
        [
          `INSERT INTO public.cwi_submission_report_files (submission_id, storage_bucket, storage_path, original_file_name, file_size, sha256, uploaded_by)`,
          `VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          `ON CONFLICT (submission_id) DO UPDATE SET storage_bucket = EXCLUDED.storage_bucket, storage_path = EXCLUDED.storage_path, original_file_name = EXCLUDED.original_file_name, file_size = EXCLUDED.file_size, sha256 = EXCLUDED.sha256, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now(), locked_at = NULL`,
        ].join('\n'),
        [input.submissionId, input.storageBucket, input.storagePath, input.fileName, input.fileSize, input.sha256, input.uploadedBy],
      )
      await client.query(
        [
          `UPDATE public.cwi_report_email_jobs`,
          `SET storage_bucket = $2, storage_path = $3, file_sha256 = $4, status = CASE WHEN status = 'failed' THEN 'queued' ELSE status END, next_attempt_at = now(), published_at = NULL, publish_locked_at = NULL, publish_locked_by = NULL, last_error_code = NULL, last_error_message = NULL, updated_at = now()`,
          `WHERE submission_id = $1 AND status NOT IN ('sending', 'sent')`,
        ].join('\n'),
        [input.submissionId, input.storageBucket, input.storagePath, input.sha256],
      )
      await client.query('COMMIT')
      return { file: await this.getFile(input.submissionId), previousPath }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error instanceof ReportDeliveryRepositoryError) throw error
      if (errorCode(error) === '23503') throw new ReportDeliveryRepositoryError('submission_not_found', 404, 'Không tìm thấy lượt gửi khảo sát.')
      throw error
    } finally {
      client.release()
    }
  }

  private async countSnapshot(snapshotAt: Date) {
    const result = await this.pool.query<{ total_users: string; eligible_users: string; missing_pdf_users: string }>(
      [
        `SELECT COUNT(*)::bigint AS total_users,`,
        `       COUNT(*) FILTER (WHERE f.submission_id IS NOT NULL AND f.locked_at IS NULL AND (job.id IS NULL OR job.status = 'failed'))::bigint AS eligible_users,`,
        `       COUNT(*) FILTER (WHERE f.submission_id IS NULL)::bigint AS missing_pdf_users`,
        `FROM public.cwi_survey_submissions s LEFT JOIN public.cwi_submission_report_files f ON f.submission_id = s.id`,
        `LEFT JOIN public.cwi_report_email_jobs job ON job.submission_id = s.id`,
        `WHERE s.submitted_at <= $1`,
      ].join('\n'),
      [snapshotAt],
    )
    const row = result.rows[0] ?? { total_users: '0', eligible_users: '0', missing_pdf_users: '0' }
    return { eligibleUsers: count(row.eligible_users), missingPdfUsers: count(row.missing_pdf_users), totalUsers: count(row.total_users) }
  }

  async createPreview(requestedBy: string) {
    const active = await this.pool.query<CampaignRow>(
      `SELECT id, requested_by, snapshot_at, status, total_users, eligible_users, missing_pdf_users, queued_count, sent_count, failed_count, error_code, error_message, expires_at, created_at, started_at, completed_at FROM public.cwi_report_delivery_campaigns WHERE status IN ('draft', 'queued', 'dispatching', 'sending') AND expires_at > now() ORDER BY created_at ASC LIMIT 1`,
    )
    if (active.rows[0]) return mapCampaign(active.rows[0])
    await this.pool.query(`UPDATE public.cwi_report_delivery_campaigns SET status = 'expired', updated_at = now() WHERE status IN ('draft', 'queued', 'dispatching', 'sending') AND expires_at <= now()`)
    const snapshotAt = new Date()
    const totals = await this.countSnapshot(snapshotAt)
    try {
      const result = await this.pool.query<CampaignRow>(
        `INSERT INTO public.cwi_report_delivery_campaigns (id, requested_by, snapshot_at, total_users, eligible_users, missing_pdf_users) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, requested_by, snapshot_at, status, total_users, eligible_users, missing_pdf_users, queued_count, sent_count, failed_count, error_code, error_message, expires_at, created_at, started_at, completed_at`,
        [randomUUID(), requestedBy, snapshotAt, totals.totalUsers, totals.eligibleUsers, totals.missingPdfUsers],
      )
      const created = result.rows[0]
      if (!created) throw new Error('Campaign insert returned no row.')
      return mapCampaign(created)
    } catch (error) {
      if (errorCode(error) === '23505') {
        const retry = await this.pool.query<CampaignRow>(`SELECT id, requested_by, snapshot_at, status, total_users, eligible_users, missing_pdf_users, queued_count, sent_count, failed_count, error_code, error_message, expires_at, created_at, started_at, completed_at FROM public.cwi_report_delivery_campaigns WHERE status IN ('draft', 'queued', 'dispatching', 'sending') ORDER BY created_at ASC LIMIT 1`)
        if (retry.rows[0]) return mapCampaign(retry.rows[0])
      }
      throw error
    }
  }

  async getCampaign(id: string) {
    const result = await this.pool.query<CampaignRow>(
      [
        `SELECT c.id, c.requested_by, c.snapshot_at, c.status, c.total_users, c.eligible_users, c.missing_pdf_users,`,
        `       COUNT(j.id) FILTER (WHERE j.status = 'queued')::bigint AS queued_count, COUNT(j.id) FILTER (WHERE j.status = 'sent')::bigint AS sent_count, COUNT(j.id) FILTER (WHERE j.status = 'failed')::bigint AS failed_count,`,
        `       c.error_code, c.error_message, c.expires_at, c.created_at, c.started_at, c.completed_at`,
        `FROM public.cwi_report_delivery_campaigns c LEFT JOIN public.cwi_report_email_jobs j ON j.campaign_id = c.id`,
        `WHERE c.id = $1 GROUP BY c.id`,
      ].join('\n'),
      [id],
    )
    if (!result.rows[0]) throw new ReportDeliveryRepositoryError('campaign_not_found', 404, 'Không tìm thấy đợt gửi email.')
    return mapCampaign(result.rows[0])
  }

  async confirmCampaign(id: string, requestedBy: string) {
    const result = await this.pool.query<CampaignRow>(
      `UPDATE public.cwi_report_delivery_campaigns SET status = 'queued', started_at = now(), updated_at = now() WHERE id = $1 AND requested_by = $2 AND status = 'draft' AND eligible_users > 0 AND expires_at > now() RETURNING id, requested_by, snapshot_at, status, total_users, eligible_users, missing_pdf_users, queued_count, sent_count, failed_count, error_code, error_message, expires_at, created_at, started_at, completed_at`,
      [id, requestedBy],
    )
    if (!result.rows[0]) throw new ReportDeliveryRepositoryError('campaign_not_confirmable', 409, 'Đợt gửi email không còn ở trạng thái có thể xác nhận.')
    return mapCampaign(result.rows[0])
  }

  async listActiveCampaigns(limit: number) {
    const result = await this.pool.query<{ id: string }>(
      [
        `SELECT c.id FROM public.cwi_report_delivery_campaigns c`,
        `WHERE (c.expires_at > now() AND c.status IN ('queued', 'dispatching', 'sending')`,
        `  OR EXISTS (SELECT 1 FROM public.cwi_report_email_jobs j WHERE j.campaign_id = c.id AND j.status IN ('queued', 'sending'))`,
        `) ORDER BY c.created_at ASC, c.id ASC LIMIT $1`,
      ].join('\n'),
      [limit],
    )
    return result.rows.map((row) => row.id)
  }

  async claimCampaign(id: string, lockMs: number) {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE public.cwi_report_delivery_campaigns SET status = 'dispatching', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1 AND (status = 'queued' OR (status IN ('dispatching', 'sending') AND updated_at < now() - ($2::bigint * interval '1 millisecond'))) RETURNING id`,
      [id, lockMs],
    )
    return result.rows.length > 0
  }

  async dispatchBatch(campaignId: string, batchSize: number) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const campaign = await client.query<{ snapshot_at: Date; dispatch_cursor_at: Date | null; dispatch_cursor_id: string | null }>(`SELECT snapshot_at, dispatch_cursor_at, dispatch_cursor_id FROM public.cwi_report_delivery_campaigns WHERE id = $1 FOR UPDATE`, [campaignId])
      const current = campaign.rows[0]
      if (!current) throw new ReportDeliveryRepositoryError('campaign_not_found', 404, 'Không tìm thấy đợt gửi email.')
      const params: unknown[] = [current.snapshot_at]
      const where = ['s.submitted_at <= $1']
      if (current.dispatch_cursor_at && current.dispatch_cursor_id) {
        params.push(current.dispatch_cursor_at, current.dispatch_cursor_id)
        where.push(`(s.submitted_at, s.id) > ($2::timestamptz, $3::uuid)`)
      }
      params.push(batchSize + 1)
      const rows = await client.query<{ id: string; submitted_at: Date; full_name: string; email: string; storage_bucket: string | null; storage_path: string | null; sha256: string | null; locked_at: Date | null }>(
          [
            `SELECT s.id, s.submitted_at, s.full_name, s.email, f.storage_bucket, f.storage_path, f.sha256, f.locked_at`,
            `FROM public.cwi_survey_submissions s LEFT JOIN public.cwi_submission_report_files f ON f.submission_id = s.id`,
            `LEFT JOIN public.cwi_report_email_jobs job ON job.submission_id = s.id`,
            `WHERE ${where.join(' AND ')} AND (job.id IS NULL OR job.status = 'failed') ORDER BY s.submitted_at ASC, s.id ASC LIMIT $${params.length}::integer`,
        ].join('\n'),
        params,
      )
      const page = rows.rows.slice(0, batchSize)
      for (const row of page) {
        if (!row.storage_path || !row.storage_bucket || !row.sha256 || row.locked_at) continue
        await client.query(
          [
            `INSERT INTO public.cwi_report_email_jobs (campaign_id, submission_id, recipient_email, recipient_name, storage_bucket, storage_path, file_sha256)`,
            `VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            `ON CONFLICT (submission_id) DO UPDATE SET campaign_id = EXCLUDED.campaign_id, recipient_email = EXCLUDED.recipient_email, recipient_name = EXCLUDED.recipient_name, storage_bucket = EXCLUDED.storage_bucket, storage_path = EXCLUDED.storage_path, file_sha256 = EXCLUDED.file_sha256, status = CASE WHEN cwi_report_email_jobs.status = 'failed' THEN 'queued' ELSE cwi_report_email_jobs.status END, next_attempt_at = now(), published_at = NULL, publish_locked_at = NULL, publish_locked_by = NULL, updated_at = now()`,
            `WHERE cwi_report_email_jobs.status = 'failed'`,
          ].join('\n'),
          [campaignId, row.id, row.email, row.full_name, row.storage_bucket, row.storage_path, row.sha256],
        )
      }
      const last = page.at(-1)
      const done = rows.rows.length <= batchSize
      if (last) {
        await client.query(`UPDATE public.cwi_report_delivery_campaigns SET dispatch_cursor_at = $2, dispatch_cursor_id = $3, status = CASE WHEN $4::boolean THEN 'sending' ELSE 'dispatching' END, updated_at = now() WHERE id = $1`, [campaignId, last.submitted_at, last.id, done])
      } else {
        await client.query(`UPDATE public.cwi_report_delivery_campaigns SET status = 'sending', updated_at = now() WHERE id = $1`, [campaignId])
      }
      await client.query('COMMIT')
      return { done, inserted: page.filter((row) => row.storage_path && row.storage_bucket && row.sha256 && !row.locked_at).length }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async claimUnpublished(campaignId: string, limit: number, workerId: string, lockMs: number) {
    const result = await this.pool.query<{ id: string }>(
      [
        `WITH candidates AS (SELECT id FROM public.cwi_report_email_jobs WHERE campaign_id = $1 AND status = 'queued' AND (published_at IS NULL OR published_at < now() - ($3::bigint * interval '1 millisecond')) AND (publish_locked_at IS NULL OR publish_locked_at < now() - ($3::bigint * interval '1 millisecond')) ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED)`,
        `UPDATE public.cwi_report_email_jobs j SET publish_locked_at = now(), publish_locked_by = $4 FROM candidates WHERE j.id = candidates.id RETURNING j.id`,
      ].join('\n'),
      [campaignId, limit, lockMs, workerId],
    )
    return result.rows.map((row) => row.id)
  }

  async markPublished(ids: string[], workerId: string) {
    if (!ids.length) return
    await this.pool.query(`UPDATE public.cwi_report_email_jobs SET published_at = now(), publish_locked_at = NULL, publish_locked_by = NULL, updated_at = now() WHERE id = ANY($1::uuid[]) AND publish_locked_by = $2`, [ids, workerId])
  }

  async releasePublishLocks(ids: string[], workerId: string) {
    if (!ids.length) return
    await this.pool.query(`UPDATE public.cwi_report_email_jobs SET publish_locked_at = NULL, publish_locked_by = NULL, updated_at = now() WHERE id = ANY($1::uuid[]) AND publish_locked_by = $2`, [ids, workerId])
  }

  async claimJob(id: string, workerId: string, lockMs: number): Promise<ClaimedEmailJob | null> {
    const result = await this.pool.query<{ id: string; campaign_id: string; submission_id: string; recipient_email: string; recipient_name: string; storage_bucket: string; storage_path: string; file_sha256: string; attempt_count: number; original_file_name: string | null }>(
      [
        `WITH candidate AS (SELECT j.id FROM public.cwi_report_email_jobs j JOIN public.cwi_submission_report_files f ON f.submission_id = j.submission_id AND f.storage_path = j.storage_path WHERE j.id = $1 AND ((j.status = 'queued' AND j.next_attempt_at <= now()) OR (j.status = 'sending' AND j.locked_at < now() - ($3::bigint * interval '1 millisecond'))) FOR UPDATE OF j SKIP LOCKED),`,
        `updated AS (`,
        `  UPDATE public.cwi_report_email_jobs j SET status = 'sending', attempt_count = j.attempt_count + 1, locked_at = now(), locked_by = $2, last_error_code = NULL, last_error_message = NULL FROM candidate WHERE j.id = candidate.id`,
        `  RETURNING j.id, j.campaign_id, j.submission_id, j.recipient_email, j.recipient_name, j.storage_bucket, j.storage_path, j.file_sha256, j.attempt_count`,
        `)`,
        `SELECT updated.id, updated.campaign_id, updated.submission_id, updated.recipient_email, updated.recipient_name, updated.storage_bucket, updated.storage_path, updated.file_sha256, updated.attempt_count, f.original_file_name`,
        `FROM updated JOIN public.cwi_submission_report_files f ON f.submission_id = updated.submission_id AND f.storage_path = updated.storage_path`,
      ].join('\n'),
      [id, workerId, lockMs],
    )
    const row = result.rows[0]
    return row ? { attemptCount: Number(row.attempt_count), campaignId: row.campaign_id, fileSha256: row.file_sha256, id: row.id, originalFileName: row.original_file_name ?? 'bao-cao-ceo-workforce-index.pdf', recipientEmail: row.recipient_email, recipientName: row.recipient_name, storageBucket: row.storage_bucket, storagePath: row.storage_path, submissionId: row.submission_id } : null
  }

  async markSent(jobId: string, providerMessageId: string) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`UPDATE public.cwi_report_email_jobs SET status = 'sent', sent_at = now(), provider_message_id = $2, locked_at = NULL, locked_by = NULL, updated_at = now() WHERE id = $1 AND status = 'sending'`, [jobId, providerMessageId.slice(0, 500)])
      await client.query(`UPDATE public.cwi_submission_report_files SET locked_at = now(), updated_at = now() WHERE submission_id = (SELECT submission_id FROM public.cwi_report_email_jobs WHERE id = $1) AND locked_at IS NULL`, [jobId])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async markFailed(jobId: string, attempt: number, code: string, message: string, maxAttempts: number) {
    const retry = attempt < maxAttempts
    const delay = Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)))
    await this.pool.query(
      `UPDATE public.cwi_report_email_jobs SET status = CASE WHEN $5::boolean THEN 'queued' ELSE 'failed' END, next_attempt_at = now() + ($2::integer * interval '1 second'), published_at = CASE WHEN $5::boolean THEN NULL ELSE published_at END, locked_at = NULL, locked_by = NULL, last_error_code = $3, last_error_message = $4, updated_at = now() WHERE id = $1 AND status = 'sending'`,
      [jobId, delay, code.slice(0, 100), message.slice(0, 1000), retry],
    )
  }

  async refreshCampaign(id: string) {
    await this.pool.query(
      [
        `WITH counts AS (`,
        `  SELECT COUNT(*) FILTER (WHERE status = 'queued')::bigint AS queued_count,`,
        `         COUNT(*) FILTER (WHERE status = 'sent')::bigint AS sent_count,`,
        `         COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,`,
        `         COUNT(*) FILTER (WHERE status = 'sending')::bigint AS sending_count`,
        `  FROM public.cwi_report_email_jobs WHERE campaign_id = $1`,
        `)`,
        `UPDATE public.cwi_report_delivery_campaigns AS campaign`,
        `SET queued_count = counts.queued_count,`,
        `    sent_count = counts.sent_count,`,
        `    failed_count = counts.failed_count,`,
        `    status = CASE`,
        `      WHEN counts.queued_count > 0 OR counts.sending_count > 0 THEN`,
        `        CASE WHEN campaign.status IN ('completed', 'failed', 'expired') THEN 'sending' ELSE campaign.status END`,
        `      WHEN campaign.status IN ('dispatching', 'sending') THEN`,
        `        CASE WHEN counts.failed_count > 0 THEN 'failed' ELSE 'completed' END`,
        `      ELSE campaign.status`,
        `    END,`,
        `    completed_at = CASE`,
        `      WHEN counts.queued_count > 0 OR counts.sending_count > 0 THEN NULL`,
        `      WHEN campaign.status IN ('dispatching', 'sending') THEN now()`,
        `      ELSE campaign.completed_at`,
        `    END,`,
        `    updated_at = now()`,
        `FROM counts WHERE campaign.id = $1`,
      ].join('\n'),
      [id],
    )
  }
}

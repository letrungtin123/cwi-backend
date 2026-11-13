import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { decodeCursor } from '../../http/cursor.js'
import { createAdminRequestRateLimit, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from '../auth/authService.js'
import { createExportRouter } from '../exports/exportRoutes.js'
import type { PgExportRepository } from '../exports/exportRepository.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import { ReportRetryError, type PgReportRepository } from '../reports/reportRepository.js'
import type { PgAdminRepository, ReportStatusFilter } from './adminRepository.js'
import { canManageContent } from '../auth/adminRoles.js'
import { uuidPattern } from '../../http/ids.js'

const validStatuses = new Set(['part1_only', 'part2_refused_privacy', 'full_private_report'])
const validRoundtableLinkStatuses = new Set(['linked', 'standalone'])
const validEmailStatuses = new Set(['failed'])
const validReportStatuses = new Set(['not_started', 'generating', 'completed', 'failed', 'skipped'])

function parseLimit(value: unknown) {
  if (value === undefined) return 10
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new HttpError(400, 'invalid_limit', 'Số dòng mỗi trang (limit) phải là số nguyên dương.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100) throw new HttpError(400, 'invalid_limit', 'Số dòng mỗi trang (limit) phải từ 1 đến 100.')
  return parsed
}

function parseBefore(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'invalid_before_cursor', 'Tham số before phải là thời điểm theo chuẩn ISO.')
  return parsed
}

function parseBeforeId(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!uuidPattern.test(value)) throw new HttpError(400, 'invalid_before_cursor_id', 'Tham số beforeId phải là UUID hợp lệ.')
  return value
}

function parseBeforeCursor(beforeValue: unknown, beforeIdValue: unknown) {
  const before = parseBefore(beforeValue)
  const beforeId = parseBeforeId(beforeIdValue)
  if (beforeId && !before) throw new HttpError(400, 'invalid_before_cursor', 'Tham số beforeId cần đi kèm before.')
  return { before, beforeId }
}

function parsePaginationCursor(cursorValue: unknown, beforeValue: unknown, beforeIdValue: unknown, secret: string) {
  if (cursorValue !== undefined) {
    if (beforeValue !== undefined || beforeIdValue !== undefined) throw new HttpError(400, 'ambiguous_cursor', 'Chỉ dùng cursor hoặc before/beforeId, không dùng cả hai.')
    return decodeCursor(secret, cursorValue)
  }
  return parseBeforeCursor(beforeValue, beforeIdValue)
}

function parseStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!validStatuses.has(value)) throw new HttpError(400, 'invalid_submission_status', 'Bộ lọc trạng thái lượt gửi không hợp lệ.')
  return value
}

function parseSearch(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

function parseRoundtable(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (value === 'true') return true
  if (value === 'false') return false
  throw new HttpError(400, 'invalid_roundtable_filter', 'Bộ lọc Roundtable chỉ nhận true hoặc false.')
}

export function parseReportPdfUploaded(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (value === 'true') return true
  if (value === 'false') return false
  throw new HttpError(400, 'invalid_report_pdf_uploaded_filter', 'Bộ lọc file PDF chỉ nhận true hoặc false.')
}

export function parseReportStatus(value: unknown): ReportStatusFilter | null {
  if (typeof value !== 'string' || !value.trim()) return null
  if (validReportStatuses.has(value)) return value as ReportStatusFilter
  throw new HttpError(400, 'invalid_report_status_filter', 'Bộ lọc trạng thái báo cáo không hợp lệ.')
}

export function parseSurveyVersion(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^[0-9]{4}Q[1-4]$/.test(value)) return value
  throw new HttpError(400, 'invalid_survey_version_filter', 'Bộ lọc bộ câu hỏi phải có dạng 2026Q4.')
}

export function parseQuarter(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (/^[0-9]{4}Q[1-4]$/.test(value)) return value
  throw new HttpError(400, 'invalid_quarter_filter', 'Bộ lọc quý phải có dạng 2026Q4.')
}

// 'none' lists submissions that came without a source link.
export function parseSourceFilter(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (value === 'none' || uuidPattern.test(value)) return value
  throw new HttpError(400, 'invalid_source_filter', 'Bộ lọc nguồn mời phải là mã nguồn hoặc none.')
}

export function parseEmailStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (validEmailStatuses.has(value)) return 'failed' as const
  throw new HttpError(400, 'invalid_email_status_filter', 'Bộ lọc email chỉ nhận giá trị failed.')
}

function parseRoundtableLinkStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (validRoundtableLinkStatuses.has(value)) return value as 'linked' | 'standalone'
  throw new HttpError(400, 'invalid_roundtable_link_filter', 'Bộ lọc liên kết chỉ nhận linked hoặc standalone.')
}

function assertUuid(id: string | undefined, code: string, message: string) {
  if (!id || !uuidPattern.test(id)) throw new HttpError(400, code, message)
  return id
}

function reportStorageErrorToHttp(error: ReportAssetStorageError): HttpError {
  if (error.status === 404) return new HttpError(404, 'report_pdf_missing', 'Không tìm thấy file PDF báo cáo trong kho lưu trữ.')
  if (error.retryable) return new HttpError(503, 'report_storage_unavailable', 'Kho lưu trữ báo cáo tạm thời không truy cập được. Vui lòng thử lại sau.')
  return new HttpError(500, 'report_storage_error', 'Không đọc được file từ kho lưu trữ báo cáo.')
}

function reportRetryErrorToHttp(error: ReportRetryError): HttpError {
  return new HttpError(error.statusCode, error.code, error.message)
}

function contentDisposition(value: unknown) {
  const mode = value === '1' || value === 'true' ? 'attachment' : 'inline'
  return mode + '; filename="cwi-report.pdf"'
}

export function createAdminRouter(
  repository: PgAdminRepository,
  reportRepository: PgReportRepository,
  reportAssetStorage: ReportAssetStorage,
  exportRepository: PgExportRepository,
  authService: AuthService,
  config: RuntimeConfig,
) {
  const router = Router()

  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))
  router.use('/exports', createExportRouter(exportRepository, reportAssetStorage, config))

  router.get('/roundtable-registrations/stats', async (req, res, next) => {
    try {
      const data = await repository.getRoundtableRegistrationStats(parseQuarter(req.query.quarter))
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/roundtable-registrations/page', async (req, res, next) => {
    try {
      const cursor = parsePaginationCursor(req.query.cursor, req.query.before, req.query.beforeId, config.adminCursorSecret)
      const data = await repository.listRoundtableRegistrationsPage({
        ...cursor,
        limit: parseLimit(req.query.limit),
        linkStatus: parseRoundtableLinkStatus(req.query.linkStatus),
        quarter: parseQuarter(req.query.quarter),
        search: parseSearch(req.query.search),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/roundtable-registrations/:id', async (req, res, next) => {
    try {
      const id = assertUuid(req.params.id, 'invalid_roundtable_registration_id', 'Roundtable registration id must be a UUID.')
      const data = await repository.getRoundtableRegistration(id)
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/webinar-registrations/stats', async (_req, res, next) => {
    try {
      const data = await repository.getWebinarRegistrationStats()
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/webinar-registrations/page', async (req, res, next) => {
    try {
      const cursor = parsePaginationCursor(req.query.cursor, req.query.before, req.query.beforeId, config.adminCursorSecret)
      const data = await repository.listWebinarRegistrationsPage({
        ...cursor,
        limit: parseLimit(req.query.limit),
        linkStatus: parseRoundtableLinkStatus(req.query.linkStatus),
        search: parseSearch(req.query.search),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/webinar-registrations/:id', async (req, res, next) => {
    try {
      const id = assertUuid(req.params.id, 'invalid_webinar_registration_id', 'Webinar registration id must be a UUID.')
      const data = await repository.getWebinarRegistration(id)
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/survey-submissions/stats', async (req, res, next) => {
    try {
      const data = await repository.getSubmissionStats(parseSurveyVersion(req.query.surveyVersion))
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/report-jobs/:id/pdf', async (req, res, next) => {
    try {
      if (!canManageContent(getRequiredAdminSession(req).user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền tải file báo cáo.')
      const id = assertUuid(req.params.id, 'invalid_report_job_id', 'Report job id must be a UUID.')
      const reportJob = await reportRepository.getReportJobDownload(id)
      if (!reportJob) throw new HttpError(404, 'report_pdf_not_found', 'Báo cáo PDF chưa có sẵn.')
      const asset = await reportAssetStorage.download(reportJob.pdfStoragePath)
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Content-Disposition', contentDisposition(req.query.download))
      res.setHeader('Content-Type', asset.contentType || 'application/pdf')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
      await pipeline(Readable.fromWeb(asset.body), res)
    } catch (error) {
      if (error instanceof ReportAssetStorageError) {
        next(reportStorageErrorToHttp(error))
        return
      }
      next(error)
    }
  })

  router.post('/survey-submissions/:id/retry-report', async (req, res, next) => {
    try {
      const session = getRequiredAdminSession(req)
      if (!canManageContent(session.user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền tạo lại báo cáo.')
      const id = assertUuid(req.params.id, 'invalid_submission_id', 'Submission id must be a UUID.')
      const data = await reportRepository.retryFailedJob(id)
      res.status(202).json({ data })
    } catch (error) {
      if (error instanceof ReportRetryError) {
        next(reportRetryErrorToHttp(error))
        return
      }
      next(error)
    }
  })

  router.get('/survey-submissions/page', async (req, res, next) => {
    try {
      const cursor = parsePaginationCursor(req.query.cursor, req.query.before, req.query.beforeId, config.adminCursorSecret)
      const data = await repository.listSubmissionsPage({
        ...cursor,
        emailStatus: parseEmailStatus(req.query.emailStatus),
        limit: parseLimit(req.query.limit),
        reportStatus: parseReportStatus(req.query.reportStatus),
        reportPdfUploaded: parseReportPdfUploaded(req.query.reportPdfUploaded),
        roundtableRegistered: parseRoundtable(req.query.roundtable),
        search: parseSearch(req.query.search),
        sourceId: parseSourceFilter(req.query.sourceId),
        status: parseStatus(req.query.status),
        surveyVersion: parseSurveyVersion(req.query.surveyVersion),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/survey-submissions/:id', async (req, res, next) => {
    try {
      const id = assertUuid(req.params.id, 'invalid_submission_id', 'Submission id must be a UUID.')
      const data = await repository.getSubmission(id)
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  return router
}

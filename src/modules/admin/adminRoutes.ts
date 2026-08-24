import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { decodeCursor } from '../../http/cursor.js'
import { requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from '../auth/authService.js'
import { createExportRouter } from '../exports/exportRoutes.js'
import type { PgExportRepository } from '../exports/exportRepository.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import type { PgReportRepository } from '../reports/reportRepository.js'
import type { PgAdminRepository } from './adminRepository.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validStatuses = new Set(['part1_only', 'part2_refused_privacy', 'full_private_report'])
const validRoundtableLinkStatuses = new Set(['linked', 'standalone'])

function parseLimit(value: unknown) {
  if (value === undefined) return 10
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new HttpError(400, 'invalid_limit', 'limit must be a positive integer.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100) throw new HttpError(400, 'invalid_limit', 'limit must be between 1 and 100.')
  return parsed
}

export function parseFullSubmissionLimit(value: unknown) {
  const parsed = parseLimit(value)
  if (parsed > 10) throw new HttpError(400, 'invalid_limit', 'limit must be between 1 and 10 for the full submissions endpoint.')
  return parsed
}

function parsePage(value: unknown) {
  if (value === undefined) return 1
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new HttpError(400, 'invalid_page', 'page must be a positive integer.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 10_000) throw new HttpError(400, 'invalid_page', 'page must be between 1 and 10000.')
  return parsed
}

function parseBefore(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'invalid_before_cursor', 'before must be an ISO timestamp.')
  return parsed
}

function parseBeforeId(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!uuidPattern.test(value)) throw new HttpError(400, 'invalid_before_cursor_id', 'beforeId must be a valid UUID.')
  return value
}

function parseBeforeCursor(beforeValue: unknown, beforeIdValue: unknown) {
  const before = parseBefore(beforeValue)
  const beforeId = parseBeforeId(beforeIdValue)
  if (beforeId && !before) throw new HttpError(400, 'invalid_before_cursor', 'beforeId requires before.')
  return { before, beforeId }
}

function parsePaginationCursor(cursorValue: unknown, beforeValue: unknown, beforeIdValue: unknown, secret: string) {
  if (cursorValue !== undefined) {
    if (beforeValue !== undefined || beforeIdValue !== undefined) throw new HttpError(400, 'ambiguous_cursor', 'Use cursor or before/beforeId, not both.')
    return decodeCursor(secret, cursorValue)
  }
  return parseBeforeCursor(beforeValue, beforeIdValue)
}

function parseStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!validStatuses.has(value)) throw new HttpError(400, 'invalid_submission_status', 'submission_status filter is invalid.')
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
  throw new HttpError(400, 'invalid_roundtable_filter', 'roundtable filter must be true or false.')
}

function parseRoundtableLinkStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (validRoundtableLinkStatuses.has(value)) return value as 'linked' | 'standalone'
  throw new HttpError(400, 'invalid_roundtable_link_filter', 'roundtable link filter must be linked or standalone.')
}

function assertUuid(id: string | undefined, code: string, message: string) {
  if (!id || !uuidPattern.test(id)) throw new HttpError(400, code, message)
  return id
}

function reportStorageErrorToHttp(error: ReportAssetStorageError): HttpError {
  if (error.status === 404) return new HttpError(404, 'report_pdf_missing', 'Report PDF file is missing from storage.')
  if (error.retryable) return new HttpError(503, 'report_storage_unavailable', 'Report storage is temporarily unavailable.')
  return new HttpError(500, 'report_storage_error', 'Report storage request failed.')
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
  router.use('/exports', createExportRouter(exportRepository, reportAssetStorage, config))

  router.get('/roundtable-registrations/stats', async (_req, res, next) => {
    try {
      const data = await repository.getRoundtableRegistrationStats()
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
        search: parseSearch(req.query.search),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/roundtable-registrations', async (req, res, next) => {
    try {
      const data = await repository.listRoundtableRegistrations({
        ...parsePaginationCursor(req.query.cursor, req.query.before, req.query.beforeId, config.adminCursorSecret),
        limit: parseLimit(req.query.limit),
        linkStatus: parseRoundtableLinkStatus(req.query.linkStatus),
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

  router.get('/survey-submissions/stats', async (_req, res, next) => {
    try {
      const data = await repository.getSubmissionStats()
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/report-jobs/:id/pdf', async (req, res, next) => {
    try {
      const id = assertUuid(req.params.id, 'invalid_report_job_id', 'Report job id must be a UUID.')
      const reportJob = await reportRepository.getReportJobDownload(id)
      if (!reportJob) throw new HttpError(404, 'report_pdf_not_found', 'Report PDF is not available.')
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

  router.get('/survey-submissions/page', async (req, res, next) => {
    try {
      const cursor = parsePaginationCursor(req.query.cursor, req.query.before, req.query.beforeId, config.adminCursorSecret)
      const data = await repository.listSubmissionsPage({
        ...cursor,
        limit: parseLimit(req.query.limit),
        roundtableRegistered: parseRoundtable(req.query.roundtable),
        search: parseSearch(req.query.search),
        status: parseStatus(req.query.status),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/survey-submissions', async (req, res, next) => {
    try {
      const data = await repository.listSubmissions({
        ...parsePaginationCursor(req.query.cursor, req.query.before, req.query.beforeId, config.adminCursorSecret),
        limit: parseLimit(req.query.limit),
        roundtableRegistered: parseRoundtable(req.query.roundtable),
        search: parseSearch(req.query.search),
        status: parseStatus(req.query.status),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/survey-submissions/full', async (req, res, next) => {
    try {
      const page = parsePage(req.query.page)
      const limit = parseFullSubmissionLimit(req.query.limit)
      const result = await repository.listSubmissionDetails({
        limit,
        page,
        roundtableRegistered: parseRoundtable(req.query.roundtable),
        search: parseSearch(req.query.search),
        status: parseStatus(req.query.status),
      })
      const totalPages = result.totalItems === 0 ? 0 : Math.ceil(result.totalItems / limit)
      res.setHeader('X-API-Deprecated', 'Use /survey-submissions/page and /survey-submissions/:id instead.')
      res.json({
        data: {
          items: result.items,
          pagination: {
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1 && totalPages > 0,
            limit,
            page,
            totalItems: result.totalItems,
            totalPages,
          },
        },
      })
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

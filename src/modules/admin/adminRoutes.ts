import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from '../auth/authService.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import type { PgReportRepository } from '../reports/reportRepository.js'
import type { PgAdminRepository } from './adminRepository.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validStatuses = new Set(['part1_only', 'part2_refused_privacy', 'full_private_report'])
const validRoundtableLinkStatuses = new Set(['linked', 'standalone'])

function parseLimit(value: unknown) {
  if (typeof value !== 'string') return 50
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 50
  return Math.min(100, Math.max(1, parsed))
}
function parsePage(value: unknown) {
  if (value === undefined) return 1
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, 'invalid_page', 'page must be a positive integer.')
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100_000) {
    throw new HttpError(400, 'invalid_page', 'page must be between 1 and 100000.')
  }

  return parsed
}

function parseFullListLimit(value: unknown) {
  if (value === undefined) return 10
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, 'invalid_limit', 'limit must be a positive integer.')
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100) {
    throw new HttpError(400, 'invalid_limit', 'limit must be between 1 and 100.')
  }

  return parsed
}

function parseBefore(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'invalid_before_cursor', 'before must be an ISO timestamp.')
  }
  return parsed
}

function parseStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!validStatuses.has(value)) {
    throw new HttpError(400, 'invalid_submission_status', 'submission_status filter is invalid.')
  }
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
  if (!id || !uuidPattern.test(id)) {
    throw new HttpError(400, code, message)
  }
  return id
}

function reportStorageErrorToHttp(error: ReportAssetStorageError): HttpError {
  if (error.status === 404) {
    return new HttpError(404, 'report_pdf_missing', 'Report PDF file is missing from storage.')
  }

  if (error.retryable) {
    return new HttpError(503, 'report_storage_unavailable', 'Report storage is temporarily unavailable.')
  }

  return new HttpError(500, 'report_storage_error', 'Report storage request failed.')
}

function contentDisposition(value: unknown) {
  const mode = value === '1' || value === 'true' ? 'attachment' : 'inline'
  return `${mode}; filename="cwi-report.pdf"`
}

export function createAdminRouter(
  repository: PgAdminRepository,
  reportRepository: PgReportRepository,
  reportAssetStorage: ReportAssetStorage,
  authService: AuthService,
  config: RuntimeConfig,
) {
  const router = Router()

  router.use(requireAdminSession(authService, config))

  router.get('/roundtable-registrations/stats', async (_req, res, next) => {
    try {
      const data = await repository.getRoundtableRegistrationStats()
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/roundtable-registrations', async (req, res, next) => {
    try {
      const data = await repository.listRoundtableRegistrations({
        before: parseBefore(req.query.before),
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
      if (!reportJob) {
        throw new HttpError(404, 'report_pdf_not_found', 'Report PDF is not available.')
      }

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

  router.get('/survey-submissions', async (req, res, next) => {
    try {
      const data = await repository.listSubmissions({
        before: parseBefore(req.query.before),
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
      const limit = parseFullListLimit(req.query.limit)
      const result = await repository.listSubmissionDetails({
        limit,
        page,
        roundtableRegistered: parseRoundtable(req.query.roundtable),
        search: parseSearch(req.query.search),
        status: parseStatus(req.query.status),
      })
      const totalPages = result.totalItems === 0 ? 0 : Math.ceil(result.totalItems / limit)

      res.json({
        data: result.items,
        pagination: {
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1 && totalPages > 0,
          limit,
          page,
          totalItems: result.totalItems,
          totalPages,
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
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import type { RuntimeConfig } from '../../config/runtime.js'
import { decodeCursor } from '../../http/cursor.js'
import { createAdminRequestRateLimit, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import { getRequestMeta } from '../../http/requestMeta.js'
import type { AuthService } from '../auth/authService.js'
import { contentDispositionAttachment } from '../reportDelivery/reportDeliveryFilename.js'
import { MultipartUploadError, parsePdfUpload, removeParsedPdfUpload } from '../reportDelivery/reportDeliveryMultipart.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import { QuarterlyReportDownloadTokenService } from './quarterlyReportDownloadToken.js'
import { PgQuarterlyReportRepository } from './quarterlyReportRepository.js'
import { normalizeQuarterlyReportDownload, normalizeQuarterlyReportUpload } from './quarterlyReportValidation.js'

const slugPattern = /^q[1-4]-\d{4}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validRangePattern = /^bytes=\d*-\d*$/

function assertEnabled(config: RuntimeConfig) {
  if (!config.quarterlyReportsEnabled) {
    throw new HttpError(503, 'quarterly_reports_disabled', 'Báo cáo quý hiện chưa được bật.')
  }
}

function assertAdmin(req: Request) {
  const session = getRequiredAdminSession(req)
  if (session.user.role !== 'admin') throw new HttpError(403, 'admin_required', 'Bạn không có quyền thực hiện thao tác này.')
  return session
}

function parseSlug(value: unknown) {
  if (typeof value !== 'string' || !slugPattern.test(value)) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
  return value
}

function parseLimit(value: unknown) {
  if (value === undefined) return 10
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new HttpError(400, 'invalid_limit', 'limit phải là số nguyên dương.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > 100) throw new HttpError(400, 'invalid_limit', 'limit phải từ 1 đến 100.')
  return parsed
}

function parseSearch(value: unknown) {
  if (value === undefined) return null
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_search', 'Từ khóa tìm kiếm không hợp lệ.')
  const search = value.trim().replace(/\s+/g, ' ')
  if (search.length > 160) throw new HttpError(400, 'invalid_search', 'Từ khóa tìm kiếm quá dài.')
  return search || null
}

function mapStorageError(error: unknown) {
  if (error instanceof MultipartUploadError) return new HttpError(400, 'invalid_quarterly_report_pdf', error.message)
  if (error instanceof ReportAssetStorageError) {
    return new HttpError(error.retryable ? 503 : 500, error.retryable ? 'quarterly_report_storage_unavailable' : 'quarterly_report_storage_error', 'Kho lưu trữ báo cáo hiện chưa khả dụng.')
  }
  return error
}

function safeRangeHeader(value: string | undefined) {
  if (!value) return undefined
  if (!validRangePattern.test(value.trim())) throw new HttpError(416, 'invalid_pdf_range', 'Yêu cầu phạm vi PDF không hợp lệ.')
  return value.trim()
}

async function sendPdf(res: Response, storage: ReportAssetStorage, input: { attachment: boolean; fileName: string; storagePath: string }, range?: string) {
  const asset = await storage.download(input.storagePath, range)
  res.status(asset.status)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, no-store, no-transform')
  res.setHeader('Content-Disposition', input.attachment ? contentDispositionAttachment(input.fileName) : `inline; filename="${input.fileName.replace(/["\\]/g, '_')}"`)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
  if (asset.contentRange) res.setHeader('Content-Range', asset.contentRange)
  Readable.fromWeb(asset.body as globalThis.ReadableStream<Uint8Array>).pipe(res)
}

export function createQuarterlyReportPublicRouter(
  repository: PgQuarterlyReportRepository,
  storage: ReportAssetStorage,
  tokenService: QuarterlyReportDownloadTokenService,
  config: RuntimeConfig,
) {
  const router = Router()
  const downloadRateLimit = rateLimit({ limit: Math.min(config.rateLimitMax, 20), standardHeaders: 'draft-7', legacyHeaders: false, windowMs: Math.min(config.rateLimitWindowMs, 60_000) })

  router.get('/active', async (_req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getActivePublic()
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Chưa có báo cáo quý được công bố.')
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: report })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/:slug', async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getPublicBySlug(parseSlug(req.params.slug))
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: report })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/:slug/pdf', async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getFileBySlug(parseSlug(req.params.slug))
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      await sendPdf(res, storage, { attachment: false, fileName: report.fileName, storagePath: report.storagePath }, safeRangeHeader(req.get('range') ?? undefined))
    } catch (error) { next(mapStorageError(error)) }
  })

  router.post('/:slug/downloads', downloadRateLimit, async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getPublicBySlug(parseSlug(req.params.slug))
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      const requestMeta = getRequestMeta(req, config.ipHashSecret)
      const download = await repository.registerDownload(report, normalizeQuarterlyReportDownload(req.body, requestMeta.idempotencyKey), requestMeta)
      const issued = tokenService.issue(report.id, download.id)
      res.status(download.deduplicated ? 200 : 201).json({
        data: {
          deduplicated: download.deduplicated,
          downloadUrl: `/api/v1/public/quarterly-reports/${report.slug}/download?token=${encodeURIComponent(issued.token)}`,
          expiresAt: issued.expiresAt,
          requestedAt: download.requestedAt,
        },
      })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/:slug/download', async (req, res, next) => {
    try {
      assertEnabled(config)
      const token = typeof req.query.token === 'string' ? req.query.token : ''
      const report = await repository.getFileBySlug(parseSlug(req.params.slug))
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      const downloadId = token.split('.')[0] ?? ''
      if (!uuidPattern.test(downloadId) || !tokenService.verify(report.id, downloadId, token)) {
        throw new HttpError(403, 'quarterly_report_download_token_invalid', 'Liên kết tải báo cáo đã hết hạn. Vui lòng gửi lại thông tin để tiếp tục.')
      }
      if (!await repository.markDownloaded(report.id, downloadId)) {
        throw new HttpError(403, 'quarterly_report_download_invalid', 'Thông tin tải báo cáo không hợp lệ.')
      }
      await sendPdf(res, storage, { attachment: true, fileName: report.fileName, storagePath: report.storagePath })
    } catch (error) { next(mapStorageError(error)) }
  })

  return router
}

export function createQuarterlyReportAdminRouter(
  repository: PgQuarterlyReportRepository,
  storage: ReportAssetStorage,
  authService: AuthService,
  config: RuntimeConfig,
) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  router.get('/reports', async (_req, res, next) => {
    try {
      assertEnabled(config)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await repository.listReports() })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.post('/reports', async (req, res, next) => {
    let upload: Awaited<ReturnType<typeof parsePdfUpload>> | null = null
    let uploadedPath: string | null = null
    let saved = false
    try {
      assertEnabled(config)
      const session = assertAdmin(req)
      upload = await parsePdfUpload(req, config.quarterlyReportUploadMaxBytes, ['periodYear', 'periodQuarter', 'title', 'subtitle', 'activate'])
      const details = normalizeQuarterlyReportUpload(upload.fields)
      uploadedPath = `quarterly/${details.periodYear}/q${details.periodQuarter}/${randomUUID()}.pdf`
      await storage.uploadFile(uploadedPath, upload.filePath, 'application/pdf')
      const result = await repository.saveReport({
        ...details,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        sha256: upload.sha256,
        storageBucket: config.quarterlyReportBucket,
        storagePath: uploadedPath,
        uploadedBy: session.user.id,
      })
      saved = true
      if (result.previousPath && result.previousPath !== uploadedPath) await storage.removeFile(result.previousPath).catch(() => undefined)
      res.status(201).json({ data: result.report })
    } catch (error) {
      if (!saved && uploadedPath) await storage.removeFile(uploadedPath).catch(() => undefined)
      next(mapStorageError(error))
    } finally {
      if (upload) await removeParsedPdfUpload(upload)
    }
  })

  router.get('/downloads/page', async (req, res, next) => {
    try {
      assertEnabled(config)
      const cursor = req.query.cursor === undefined ? { before: null, beforeId: null } : decodeCursor(config.adminCursorSecret, req.query.cursor)
      const page = await repository.listDownloadsPage({ ...cursor, limit: parseLimit(req.query.limit), search: parseSearch(req.query.search) })
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: page })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/downloads/stats', async (_req, res, next) => {
    try {
      assertEnabled(config)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await repository.getDownloadStats() })
    } catch (error) { next(mapStorageError(error)) }
  })

  return router
}

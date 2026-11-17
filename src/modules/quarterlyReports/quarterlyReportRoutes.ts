import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import type { RuntimeConfig } from '../../config/runtime.js'
import { decodeCursor } from '../../http/cursor.js'
import { createAdminRequestRateLimit, getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import { uuidPattern } from '../../http/ids.js'
import { getRequestMeta } from '../../http/requestMeta.js'
import { streamToResponse } from '../../http/streamResponse.js'
import type { AuditActor } from '../audit/adminAuditLog.js'
import { canManageContent } from '../auth/adminRoles.js'
import type { AuthService } from '../auth/authService.js'
import { contentDispositionAttachment, contentDispositionInline } from '../reportDelivery/reportDeliveryFilename.js'
import { MultipartUploadError, parsePdfUpload, removeParsedPdfUpload } from '../reportDelivery/reportDeliveryMultipart.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import { parseImageUpload, removeImageUpload } from '../surveyQuarters/surveyQuarterImageUpload.js'
import { QuarterlyReportDownloadTokenService } from './quarterlyReportDownloadToken.js'
import { isListed, pickReportFile, type PgQuarterlyReportRepository, type QuarterlyReport, type QuarterlyReportImage, type QuarterlyReportPage } from './quarterlyReportRepository.js'
import {
  normalizeQuarterlyReportCreate,
  normalizeQuarterlyReportDownload,
  normalizeQuarterlyReportPageUpdate,
  normalizeQuarterlyReportUpdate,
  parseReportLanguage,
  REPORT_LANGUAGES,
  type ReportLanguage,
} from './quarterlyReportValidation.js'

const slugPattern = /^q[1-4]-\d{4}$/
const validRangePattern = /^bytes=\d*-\d*$/
const PUBLIC_BASE = '/api/v1/public/quarterly-reports'
const ADMIN_BASE = '/api/v1/admin/quarterly-reports/reports'

function assertEnabled(config: RuntimeConfig) {
  if (!config.quarterlyReportsEnabled) {
    throw new HttpError(503, 'quarterly_reports_disabled', 'Báo cáo quý hiện chưa được bật.')
  }
}

function parseSlug(value: unknown) {
  if (typeof value !== 'string' || !slugPattern.test(value)) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
  return value
}

function parseLanguageParam(value: unknown): ReportLanguage {
  const language = parseReportLanguage(value)
  if (!language) throw new HttpError(404, 'quarterly_report_file_not_found', 'Không tìm thấy file báo cáo.')
  return language
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
  if (error instanceof MultipartUploadError) return new HttpError(400, 'invalid_quarterly_report_upload', error.message)
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
  res.setHeader('Content-Disposition', input.attachment ? contentDispositionAttachment(input.fileName) : contentDispositionInline(input.fileName))
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
  if (asset.contentRange) res.setHeader('Content-Range', asset.contentRange)
  await streamToResponse(asset.body as globalThis.ReadableStream<Uint8Array>, res)
}

async function sendImage(res: Response, storage: ReportAssetStorage, image: QuarterlyReportImage, cacheControl: string) {
  const asset = await storage.download(image.storagePath)
  res.status(200)
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('Content-Type', image.contentType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
  await streamToResponse(asset.body as globalThis.ReadableStream<Uint8Array>, res)
}

// The URL carries the image's hash (?v=), so a new image gets a new URL.
function imagePath(base: string, report: Pick<QuarterlyReport, 'image' | 'slug'>) {
  return report.image ? `${base}/${report.slug}/image?v=${report.image.sha256.slice(0, 16)}` : null
}

function languagesOf(report: Pick<QuarterlyReport, 'files'>) {
  return REPORT_LANGUAGES.filter((language) => report.files[language])
}

// What /bao-cao-quy shows: the heading and the listed quarters (visible, with a PDF) in card
// order. The newest of them is the current one.
export function toPublicQuarterlyReports(page: QuarterlyReportPage, reports: QuarterlyReport[]) {
  const shown = reports.filter(isListed)
  const newest = [...shown].sort((a, b) => b.periodYear - a.periodYear || b.periodQuarter - a.periodQuarter)[0]
  return {
    page: { description: page.description, kicker: page.kicker, title: page.title },
    reports: shown.map((report) => ({
      description: report.description,
      imageUrl: imagePath(PUBLIC_BASE, report),
      isCurrent: report.slug === newest?.slug,
      label: report.label,
      languages: languagesOf(report),
      periodQuarter: report.periodQuarter,
      periodYear: report.periodYear,
      slug: report.slug,
      title: report.title,
    })),
  }
}

function toAdminReport(report: QuarterlyReport) {
  const { files, image: _image, ...rest } = report
  const file = (language: ReportLanguage) => {
    const value = files[language]
    return value ? { fileName: value.fileName, fileSize: value.fileSize, uploadedAt: value.uploadedAt } : null
  }
  return { ...rest, files: { en: file('en'), vi: file('vi') }, imageUrl: imagePath(ADMIN_BASE, report), isListed: isListed(report) }
}

export function createQuarterlyReportPublicRouter(
  repository: PgQuarterlyReportRepository,
  storage: ReportAssetStorage,
  imageStorage: ReportAssetStorage,
  tokenService: QuarterlyReportDownloadTokenService,
  config: RuntimeConfig,
) {
  const router = Router()
  const downloadRateLimit = rateLimit({ limit: Math.min(config.rateLimitMax, 20), standardHeaders: 'draft-7', legacyHeaders: false, windowMs: Math.min(config.rateLimitWindowMs, 60_000) })

  async function listedReport(slugValue: unknown) {
    const report = await repository.findListed(parseSlug(slugValue))
    if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
    return report
  }

  router.get('/', async (_req, res, next) => {
    try {
      assertEnabled(config)
      const [page, reports] = await Promise.all([repository.getPage(), repository.list()])
      // Short cache: an admin's change shows up within a minute.
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.json({ data: toPublicQuarterlyReports(page, reports) })
    } catch (error) { next(mapStorageError(error)) }
  })

  // Kept for pages loaded before the card list (Vietnamese text only).
  router.get('/active', async (_req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getActiveLegacy()
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Chưa có báo cáo quý được công bố.')
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: report })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/:slug', async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getListedLegacy(parseSlug(req.params.slug))
      if (!report) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: report })
    } catch (error) { next(mapStorageError(error)) }
  })

  // ?lang=vi|en; without it (pages loaded before this change) the Vietnamese PDF.
  router.get('/:slug/pdf', async (req, res, next) => {
    try {
      assertEnabled(config)
      const picked = pickReportFile(await listedReport(req.params.slug), parseReportLanguage(req.query.lang))
      if (!picked) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      await sendPdf(res, storage, { attachment: false, fileName: picked.file.fileName, storagePath: picked.file.storagePath }, safeRangeHeader(req.get('range') ?? undefined))
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/:slug/image', async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await listedReport(req.params.slug)
      if (!report.image) throw new HttpError(404, 'quarterly_report_image_not_found', 'Không tìm thấy ảnh.')
      // A public picture: it may be shown by a page on another origin (the landing page's dev
      // server, or a preview), which helmet's default "same-origin" would block.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      await sendImage(res, imageStorage, report.image, 'public, max-age=86400')
    } catch (error) { next(mapStorageError(error)) }
  })

  router.post('/:slug/downloads', downloadRateLimit, async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await listedReport(req.params.slug)
      const requestMeta = getRequestMeta(req, config.ipHashSecret)
      const input = normalizeQuarterlyReportDownload(req.body, requestMeta.idempotencyKey)
      const picked = pickReportFile(report, input.language)
      if (!picked) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      const download = await repository.registerDownload(report, input, requestMeta)
      const issued = tokenService.issue(report.id, download.id)
      res.status(download.deduplicated ? 200 : 201).json({
        data: {
          deduplicated: download.deduplicated,
          downloadUrl: `${PUBLIC_BASE}/${report.slug}/download?token=${encodeURIComponent(issued.token)}&lang=${picked.language}`,
          expiresAt: issued.expiresAt,
          language: picked.language,
          requestedAt: download.requestedAt,
        },
      })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/:slug/download', async (req, res, next) => {
    try {
      assertEnabled(config)
      const token = typeof req.query.token === 'string' ? req.query.token : ''
      const report = await listedReport(req.params.slug)
      const downloadId = token.split('.')[0] ?? ''
      if (!uuidPattern.test(downloadId) || !tokenService.verify(report.id, downloadId, token)) {
        throw new HttpError(403, 'quarterly_report_download_token_invalid', 'Liên kết tải báo cáo đã hết hạn. Vui lòng gửi lại thông tin để tiếp tục.')
      }
      const picked = pickReportFile(report, parseReportLanguage(req.query.lang))
      if (!picked) throw new HttpError(404, 'quarterly_report_not_found', 'Không tìm thấy báo cáo quý.')
      if (!await repository.markDownloaded(report.id, downloadId, picked.language)) {
        throw new HttpError(403, 'quarterly_report_download_invalid', 'Thông tin tải báo cáo không hợp lệ.')
      }
      await sendPdf(res, storage, { attachment: true, fileName: picked.file.fileName, storagePath: picked.file.storagePath })
    } catch (error) { next(mapStorageError(error)) }
  })

  return router
}

// Dashboard "Quản lý báo cáo quý". Everyone signed in can see it; admins and super admins
// change it. Every change is written to the admin audit log.
export function createQuarterlyReportAdminRouter(
  repository: PgQuarterlyReportRepository,
  storage: ReportAssetStorage,
  imageStorage: ReportAssetStorage,
  authService: AuthService,
  config: RuntimeConfig,
) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  const requireEditor = (req: Request): AuditActor => {
    const session = getRequiredAdminSession(req)
    if (!canManageContent(session.user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền thay đổi báo cáo quý.')
    return { meta: getAuthRequestMeta(req, config), user: session.user }
  }

  router.get('/reports', async (_req, res, next) => {
    try {
      assertEnabled(config)
      const [page, reports] = await Promise.all([repository.getPage(), repository.list()])
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { page, reports: reports.map(toAdminReport) } })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.post('/reports', async (req, res, next) => {
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      res.status(201).json({ data: toAdminReport(await repository.create(normalizeQuarterlyReportCreate(req.body), actor)) })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.put('/page', async (req, res, next) => {
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      res.json({ data: await repository.updatePage(normalizeQuarterlyReportPageUpdate(req.body), actor) })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.put('/reports/:slug', async (req, res, next) => {
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      res.json({ data: toAdminReport(await repository.update(parseSlug(req.params.slug), normalizeQuarterlyReportUpdate(req.body), actor)) })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/reports/:slug/history', async (req, res, next) => {
    try {
      assertEnabled(config)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { items: await repository.history(parseSlug(req.params.slug)) } })
    } catch (error) { next(mapStorageError(error)) }
  })

  // Opens the uploaded PDF in the browser, to check it before showing the quarter. Viewers see
  // file names only: they open no report PDF in the dashboard.
  router.get('/reports/:slug/files/:language', async (req, res, next) => {
    try {
      assertEnabled(config)
      requireEditor(req)
      const report = await repository.getBySlug(parseSlug(req.params.slug))
      const file = report.files[parseLanguageParam(req.params.language)]
      if (!file) throw new HttpError(404, 'quarterly_report_file_not_found', 'Quý này chưa có file này.')
      await sendPdf(res, storage, { attachment: false, fileName: file.fileName, storagePath: file.storagePath }, safeRangeHeader(req.get('range') ?? undefined))
    } catch (error) { next(mapStorageError(error)) }
  })

  // The new file is uploaded first, then the row points at it; the old file is removed only
  // after that commit, so a failure never leaves the quarter without its PDF.
  router.post('/reports/:slug/files/:language', async (req, res, next) => {
    let upload: Awaited<ReturnType<typeof parsePdfUpload>> | null = null
    let uploadedPath: string | null = null
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      const report = await repository.getBySlug(parseSlug(req.params.slug))
      const language = parseLanguageParam(req.params.language)
      upload = await parsePdfUpload(req, config.quarterlyReportUploadMaxBytes)
      uploadedPath = `quarterly/${report.periodYear}/q${report.periodQuarter}/${language}-${randomUUID()}.pdf`
      await storage.uploadFile(uploadedPath, upload.filePath, 'application/pdf')
      const result = await repository.setFile(report.slug, language, {
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        sha256: upload.sha256,
        storageBucket: config.quarterlyReportBucket,
        storagePath: uploadedPath,
      }, actor)
      uploadedPath = null
      if (result.previous) await storage.removeFile(result.previous.storagePath).catch(() => undefined)
      res.status(201).json({ data: toAdminReport(result.report) })
    } catch (error) {
      if (uploadedPath) await storage.removeFile(uploadedPath).catch(() => undefined)
      next(mapStorageError(error))
    } finally {
      if (upload) await removeParsedPdfUpload(upload)
    }
  })

  router.delete('/reports/:slug/files/:language', async (req, res, next) => {
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      const slug = parseSlug(req.params.slug)
      const language = parseLanguageParam(req.params.language)
      const result = await repository.setFile(slug, language, null, actor)
      if (result.previous) await storage.removeFile(result.previous.storagePath).catch(() => undefined)
      res.json({ data: toAdminReport(result.report) })
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/reports/:slug/image', async (req, res, next) => {
    try {
      assertEnabled(config)
      const report = await repository.getBySlug(parseSlug(req.params.slug))
      if (!report.image) throw new HttpError(404, 'quarterly_report_image_not_found', 'Quý này chưa có ảnh.')
      await sendImage(res, imageStorage, report.image, 'private, max-age=300')
    } catch (error) { next(mapStorageError(error)) }
  })

  router.post('/reports/:slug/image', async (req, res, next) => {
    let upload: Awaited<ReturnType<typeof parseImageUpload>> | null = null
    let uploadedPath: string | null = null
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      const report = await repository.getBySlug(parseSlug(req.params.slug))
      upload = await parseImageUpload(req)
      uploadedPath = `quarterly-reports/${report.slug}/${randomUUID()}.${upload.extension}`
      await imageStorage.uploadFile(uploadedPath, upload.filePath, upload.contentType)
      const result = await repository.setImage(report.slug, { contentType: upload.contentType, sha256: upload.sha256, storagePath: uploadedPath }, actor)
      uploadedPath = null
      if (result.previous) await imageStorage.removeFile(result.previous.storagePath).catch(() => undefined)
      res.status(201).json({ data: toAdminReport(result.report) })
    } catch (error) {
      if (uploadedPath) await imageStorage.removeFile(uploadedPath).catch(() => undefined)
      next(mapStorageError(error))
    } finally {
      if (upload) await removeImageUpload(upload)
    }
  })

  router.delete('/reports/:slug/image', async (req, res, next) => {
    try {
      assertEnabled(config)
      const actor = requireEditor(req)
      const result = await repository.setImage(parseSlug(req.params.slug), null, actor)
      if (result.previous) await imageStorage.removeFile(result.previous.storagePath).catch(() => undefined)
      res.json({ data: toAdminReport(result.report) })
    } catch (error) { next(mapStorageError(error)) }
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

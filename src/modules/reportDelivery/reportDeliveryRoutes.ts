import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { Router, type Request } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from '../auth/authService.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import { MultipartUploadError, parsePdfUpload, removeParsedPdfUpload } from './reportDeliveryMultipart.js'
import { PgReportDeliveryRepository, ReportDeliveryRepositoryError } from './reportDeliveryRepository.js'
import type { SmtpReportMailer } from './smtpMailer.js'
import { contentDispositionAttachment } from './reportDeliveryFilename.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertUuid(value: unknown, code: string) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new HttpError(400, code, 'Mã lượt gửi không hợp lệ.')
  return value
}

function enabled(config: RuntimeConfig) {
  if (!config.reportDeliveryEnabled) throw new HttpError(503, 'report_delivery_disabled', 'Tính năng gửi báo cáo hiện chưa được bật.')
}

function assertAdmin(req: Request) {
  const session = getRequiredAdminSession(req)
  if (session.user.role !== 'admin') throw new HttpError(403, 'admin_required', 'Bạn không có quyền thực hiện thao tác này.')
  return session
}

function mapRepositoryError(error: unknown) {
  if (error instanceof ReportDeliveryRepositoryError) return new HttpError(error.statusCode, error.code, error.message)
  if (error instanceof MultipartUploadError) return new HttpError(400, 'invalid_pdf_upload', error.message)
  if (error instanceof ReportAssetStorageError) {
    if (error.status === 404) return new HttpError(404, 'report_pdf_missing', 'Không tìm thấy file PDF trong kho lưu trữ.')
    return new HttpError(error.retryable ? 503 : 500, error.retryable ? 'report_storage_unavailable' : 'report_storage_error', 'Kho lưu trữ báo cáo đang tạm thời không khả dụng.')
  }
  return error
}

function exposeStatus(status: Awaited<ReturnType<PgReportDeliveryRepository['getStatus']>>) {
  status.file.downloadUrl = status.file.available ? `/api/v1/admin/report-delivery/submissions/${status.submissionId}/report-pdf` : null
  return status
}

export function createReportDeliveryRouter(
  repository: PgReportDeliveryRepository,
  storage: ReportAssetStorage,
  mailer: SmtpReportMailer,
  authService: AuthService,
  config: RuntimeConfig,
) {
  const router = Router()
  router.use(requireAdminSession(authService, config))

  router.get('/submissions/status', async (req, res, next) => {
    try {
      enabled(config)
      assertAdmin(req)
      const raw = typeof req.query.ids === 'string' ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean) : []
      if (!raw.length || raw.length > 100 || raw.some((id) => !uuidPattern.test(id))) throw new HttpError(400, 'invalid_submission_ids', 'ids phải chứa từ 1 đến 100 mã lượt gửi hợp lệ.')
      const rows = await repository.getStatuses(raw)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: rows.map((row) => exposeStatus(row)) })
    } catch (error) { next(mapRepositoryError(error)) }
  })

  router.get('/submissions/:submissionId/status', async (req, res, next) => {
    try {
      enabled(config)
      assertAdmin(req)
      const status = await repository.getStatus(assertUuid(req.params.submissionId, 'invalid_submission_id'))
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: exposeStatus(status) })
    } catch (error) { next(mapRepositoryError(error)) }
  })

  router.put('/submissions/:submissionId/report-pdf', async (req, res, next) => {
    let upload: Awaited<ReturnType<typeof parsePdfUpload>> | null = null
    let uploadedPath: string | null = null
    try {
      enabled(config)
      const session = assertAdmin(req)
      const submissionId = assertUuid(req.params.submissionId, 'invalid_submission_id')
      upload = await parsePdfUpload(req, config.reportUploadMaxBytes)
      const now = new Date()
      uploadedPath = `submissions/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${submissionId}/${randomUUID()}.pdf`
      await storage.uploadFile(uploadedPath, upload.filePath, 'application/pdf')
      const saved = await repository.saveFile({
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        sha256: upload.sha256,
        storageBucket: config.reportDeliveryBucket,
        storagePath: uploadedPath,
        submissionId,
        uploadedBy: session.user.id,
      })
      if (saved.previousPath && saved.previousPath !== uploadedPath) await storage.removeFile(saved.previousPath).catch(() => undefined)
      res.status(201).json({ data: exposeStatus(await repository.getStatus(submissionId)) })
    } catch (error) {
      if (uploadedPath) await storage.removeFile(uploadedPath).catch(() => undefined)
      next(mapRepositoryError(error))
    } finally {
      if (upload) await removeParsedPdfUpload(upload)
    }
  })

  router.get('/submissions/:submissionId/report-pdf', async (req, res, next) => {
    try {
      enabled(config)
      assertAdmin(req)
      const submissionId = assertUuid(req.params.submissionId, 'invalid_submission_id')
      const file = await repository.getFileRecord(submissionId)
      if (!file || !file.storage_path) throw new HttpError(404, "report_pdf_missing", "Lượt gửi này chưa có file PDF.")
      const download = await storage.download(file.storage_path)
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', contentDispositionAttachment(file.original_file_name))
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (download.contentLength) res.setHeader('Content-Length', download.contentLength)
      Readable.fromWeb(download.body as globalThis.ReadableStream<Uint8Array>).pipe(res)
    } catch (error) { next(mapRepositoryError(error)) }
  })

  router.post('/campaigns/preview', async (req, res, next) => {
    try {
      enabled(config)
      const session = assertAdmin(req)
      const campaign = await repository.createPreview(session.user.id)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: campaign })
    } catch (error) { next(mapRepositoryError(error)) }
  })

  router.post('/campaigns/:campaignId/confirm', async (req, res, next) => {
    try {
      enabled(config)
      const session = assertAdmin(req)
      const campaign = await repository.confirmCampaign(assertUuid(req.params.campaignId, 'invalid_campaign_id'), session.user.id)
      res.status(202).json({ data: campaign })
    } catch (error) { next(mapRepositoryError(error)) }
  })

  router.get('/campaigns/:campaignId', async (req, res, next) => {
    try {
      enabled(config)
      assertAdmin(req)
      const campaign = await repository.getCampaign(assertUuid(req.params.campaignId, 'invalid_campaign_id'))
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: campaign })
    } catch (error) { next(mapRepositoryError(error)) }
  })

  router.post('/smtp/verify', async (req, res, next) => {
    try {
      enabled(config)
      assertAdmin(req)
      await mailer.verify()
      res.json({ data: { status: 'ok' } })
    } catch (error) { next(mapRepositoryError(error)) }
  })

  return router
}

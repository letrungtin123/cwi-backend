import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Router, type Request } from 'express'
import { HttpError } from '../../http/errors.js'
import type { ReportAccessTokenService } from './reportAccessToken.js'
import { ReportAssetStorageError, type ReportAssetStorage } from './reportAssetStorage.js'
import type { PgReportRepository } from './reportRepository.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertUuid(id: string | undefined) {
  if (!id || !uuidPattern.test(id)) throw new HttpError(404, 'report_not_found', 'Báo cáo không tồn tại hoặc quyền truy cập đã hết hạn.')
  return id
}

function assertAccess(req: Request, jobId: string, accessTokens: ReportAccessTokenService) {
  const token = req.get('x-cwi-report-token')
  if (!token || !accessTokens.verify(jobId, token)) {
    throw new HttpError(404, 'report_not_found', 'Báo cáo không tồn tại hoặc quyền truy cập đã hết hạn.')
  }
}

function storageErrorToHttp(error: ReportAssetStorageError) {
  if (error.status === 404) return new HttpError(404, 'report_not_found', 'Báo cáo không tồn tại hoặc quyền truy cập đã hết hạn.')
  if (error.retryable) return new HttpError(503, 'report_storage_unavailable', 'Báo cáo đang được xử lý. Vui lòng thử lại sau.')
  return new HttpError(500, 'report_storage_error', 'Không thể tải báo cáo lúc này.')
}

export function createPublicReportRouter(
  repository: PgReportRepository,
  assetStorage: ReportAssetStorage,
  accessTokens: ReportAccessTokenService,
) {
  const router = Router()

  router.get('/report-jobs/:id/status', async (req, res, next) => {
    try {
      const jobId = assertUuid(req.params.id)
      assertAccess(req, jobId, accessTokens)
      const job = await repository.getPublicReportJob(jobId)
      if (!job) throw new HttpError(404, 'report_not_found', 'Báo cáo không tồn tại hoặc quyền truy cập đã hết hạn.')

      res.setHeader('Cache-Control', 'no-store')
      res.json({
        data: {
          createdAt: job.createdAt,
          emailStatus: job.emailStatus,
          htmlAvailable: job.htmlAvailable,
          jobId: job.id,
          pdfAvailable: job.pdfAvailable,
          reportType: job.reportType,
          status: job.status,
          updatedAt: job.updatedAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/report-jobs/:id/html', async (req, res, next) => {
    try {
      const jobId = assertUuid(req.params.id)
      assertAccess(req, jobId, accessTokens)
      const job = await repository.getPublicReportJob(jobId)
      if (!job || !job.htmlAvailable) throw new HttpError(409, 'report_html_not_ready', 'Báo cáo chưa sẵn sàng.')

      const reportJob = await repository.getReportJobAsset(jobId, 'html')
      if (!reportJob) throw new HttpError(409, 'report_html_not_ready', 'Báo cáo chưa sẵn sàng.')

      const asset = await assetStorage.download(reportJob.storagePath)
      // Keep the upstream HTML byte-for-byte intact. Cloudflare Email Address
      // Obfuscation may rewrite text/html responses unless no-transform is set.
      res.setHeader('Cache-Control', 'private, no-store, no-transform')
      res.setHeader('Content-Disposition', 'inline; filename="bao-cao-cwi.html"')
      res.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src data:; form-action 'none'; frame-ancestors 'none'; img-src data: blob:; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'")
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
      await pipeline(Readable.fromWeb(asset.body), res)
    } catch (error) {
      if (error instanceof ReportAssetStorageError) {
        next(storageErrorToHttp(error))
        return
      }
      next(error)
    }
  })

  return router
}

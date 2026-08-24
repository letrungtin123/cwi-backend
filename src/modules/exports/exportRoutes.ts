import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { getRequiredAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { ReportAssetStorage } from '../reports/reportAssetStorage.js'
import { ReportAssetStorageError } from '../reports/reportAssetStorage.js'
import { PgExportRepository } from './exportRepository.js'
import { createExportSchema } from './exportTypes.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertAdmin(req: Parameters<typeof getRequiredAdminSession>[0]) {
  const session = getRequiredAdminSession(req)
  if (session.user.role !== 'admin') {
    throw new HttpError(403, 'export_forbidden', 'Chỉ quản trị viên mới được xuất dữ liệu.')
  }
  return session
}

function assertId(value: string | undefined) {
  if (!value || !uuidPattern.test(value)) {
    throw new HttpError(400, 'invalid_export_id', 'Mã lượt xuất dữ liệu không hợp lệ.')
  }
  return value
}

function mapPublicJob(row: Awaited<ReturnType<PgExportRepository['getJob']>>) {
  if (!row) return null
  return {
    createdAt: row.created_at.toISOString(),
    dataset: row.dataset,
    errorMessage: row.error_message,
    expiresAt: row.expires_at.toISOString(),
    fileName: row.file_name,
    fileSize: row.file_size ? Number(row.file_size) : null,
    id: row.id,
    rowCount: row.row_count ? Number(row.row_count) : null,
    status: row.status,
  }
}

function contentDisposition(fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return 'attachment; filename="' + safeName + '"'
}

function storageError(error: ReportAssetStorageError) {
  if (error.status === 404) return new HttpError(404, 'export_file_not_found', 'File xuất dữ liệu không còn tồn tại.')
  if (error.retryable) return new HttpError(503, 'export_storage_unavailable', 'Kho lưu trữ đang tạm thời không khả dụng.')
  return new HttpError(500, 'export_storage_error', 'Không thể đọc file xuất dữ liệu.')
}

export function createExportRouter(repository: PgExportRepository, storage: ReportAssetStorage, config: RuntimeConfig) {
  const router = Router()

  router.post('/', async (req, res, next) => {
    try {
      const session = assertAdmin(req)
      if (!config.adminExportEnabled) {
        throw new HttpError(503, 'export_disabled', 'Tính năng xuất dữ liệu chưa được bật.')
      }
      const input = createExportSchema.parse(req.body)
      const job = await repository.createJob({
        dataset: input.dataset,
        filters: input.filters,
        requestedBy: session.user.id,
      })
      res.status(202).json({ data: job })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const session = assertAdmin(req)
      if (!config.adminExportEnabled) {
        throw new HttpError(503, 'export_disabled', 'Tính năng xuất dữ liệu chưa được bật.')
      }
      const job = await repository.getJob(assertId(req.params.id), session.user.id)
      if (!job) throw new HttpError(404, 'export_not_found', 'Không tìm thấy lượt xuất dữ liệu.')
      res.json({ data: mapPublicJob(job) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:id/download', async (req, res, next) => {
    try {
      const session = assertAdmin(req)
      if (!config.adminExportEnabled) {
        throw new HttpError(503, 'export_disabled', 'Tính năng xuất dữ liệu chưa được bật.')
      }
      const job = await repository.getJob(assertId(req.params.id), session.user.id)
      if (!job) throw new HttpError(404, 'export_not_found', 'Không tìm thấy lượt xuất dữ liệu.')
      if (job.status !== 'completed' || !job.storage_path || !job.file_name) {
        throw new HttpError(409, 'export_not_ready', 'File xuất dữ liệu chưa sẵn sàng.')
      }

      const asset = await storage.download(job.storage_path)
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Content-Disposition', contentDisposition(job.file_name))
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
      await pipeline(Readable.fromWeb(asset.body), res)
    } catch (error) {
      if (error instanceof ReportAssetStorageError) {
        next(storageError(error))
        return
      }
      next(error)
    }
  })

  return router
}

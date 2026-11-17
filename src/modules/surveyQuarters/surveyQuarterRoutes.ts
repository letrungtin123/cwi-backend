import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import { streamToResponse } from '../../http/streamResponse.js'
import type { AuditActor } from '../audit/adminAuditLog.js'
import { canManageContent } from '../auth/adminRoles.js'
import type { AuthService } from '../auth/authService.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import type { PgReportRepository } from '../reports/reportRepository.js'
import { parseImageUpload, removeImageUpload } from './surveyQuarterImageUpload.js'
import type { PgSurveyQuarterRepository, SurveyQuarter, SurveyQuarterPage, SurveyQuarterPageUpdate, SurveyQuarterUpdate } from './surveyQuarterRepository.js'

const versionPattern = /^[0-9]{4}Q[1-4]$/

const singleLine = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\r\n]/.test(value))
const paragraph = (max: number) => z.string().trim().max(max)
const bilingual = <T extends z.ZodTypeAny>(schema: T) => z.object({ en: schema, vi: schema }).strict()

const quarterUpdateSchema = z
  .object({
    deferredResultDays: z.number().int().min(1).max(60),
    description: bilingual(paragraph(400)),
    isVisible: z.boolean(),
    reportGenerationEnabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(999),
    title: bilingual(singleLine(120)),
  })
  .strict()

const pageUpdateSchema = z
  .object({
    description: bilingual(paragraph(400)),
    kicker: bilingual(singleLine(80)),
    title: bilingual(singleLine(120)),
  })
  .strict()

export function normalizeSurveyQuarterUpdate(payload: unknown): SurveyQuarterUpdate {
  const parsed = quarterUpdateSchema.safeParse(payload)
  if (!parsed.success) {
    throw new HttpError(
      422,
      'invalid_survey_quarter',
      'Tiêu đề cần từ 1 đến 120 ký tự, mô tả tối đa 400 ký tự, thứ tự từ 0 đến 999 và số ngày chờ từ 1 đến 60.',
    )
  }
  return parsed.data
}

export function normalizeSurveyQuarterPageUpdate(payload: unknown): SurveyQuarterPageUpdate {
  const parsed = pageUpdateSchema.safeParse(payload)
  if (!parsed.success) {
    throw new HttpError(422, 'invalid_survey_quarter_page', 'Dòng nhỏ tối đa 80 ký tự, tiêu đề từ 1 đến 120 ký tự và mô tả tối đa 400 ký tự.')
  }
  return parsed.data
}

function surveyVersion(req: Request) {
  const value = req.params.version
  if (typeof value !== 'string' || !versionPattern.test(value)) throw new HttpError(400, 'invalid_survey_version', 'Quý khảo sát phải có dạng 2026Q4.')
  return value
}

function imagePath(base: string, quarter: Pick<SurveyQuarter, 'image' | 'surveyVersion'>) {
  return quarter.image ? `${base}/${quarter.surveyVersion}/image?v=${quarter.image.sha256.slice(0, 16)}` : null
}

function storageError(error: unknown) {
  if (error instanceof ReportAssetStorageError) {
    return new HttpError(error.retryable ? 503 : 500, 'survey_quarter_image_storage_error', 'Kho lưu trữ ảnh hiện chưa khả dụng. Vui lòng thử lại sau.')
  }
  return error
}

async function sendImage(res: Response, storage: ReportAssetStorage, image: NonNullable<SurveyQuarter['image']>, cacheControl: string) {
  const asset = await storage.download(image.storagePath)
  res.status(200)
  res.setHeader('Cache-Control', cacheControl)
  res.setHeader('Content-Type', image.contentType)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
  await streamToResponse(asset.body as globalThis.ReadableStream<Uint8Array>, res)
}

// What the landing page shows: the heading and the visible cards of quarters the code
// has a question set for, in card order. The newest of them is the current quarter.
export function toPublicSurveyQuarters(page: SurveyQuarterPage, quarters: SurveyQuarter[]) {
  const shown = quarters.filter((quarter) => quarter.isVisible && quarter.supported)
  const current = shown.map((quarter) => quarter.surveyVersion).sort().at(-1) ?? null
  return {
    page: { description: page.description, kicker: page.kicker, title: page.title },
    quarters: shown.map((quarter) => ({
      description: quarter.description,
      imageUrl: imagePath('/api/v1/public/survey-quarters', quarter),
      isCurrent: quarter.surveyVersion === current,
      label: quarter.label,
      surveyVersion: quarter.surveyVersion,
      title: quarter.title,
    })),
  }
}

export function createSurveyQuarterPublicRouter(repository: PgSurveyQuarterRepository, storage: ReportAssetStorage) {
  const router = Router()

  router.get('/', async (_req, res, next) => {
    try {
      const [page, quarters] = await Promise.all([repository.getPage(), repository.list()])
      // Short cache: an admin's change shows up within a minute.
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.json({ data: toPublicSurveyQuarters(page, quarters) })
    } catch (error) {
      next(error)
    }
  })

  // The URL carries the image's hash (?v=), so a new image gets a new URL and the old
  // one can be cached for a long time.
  router.get('/:version/image', async (req, res, next) => {
    try {
      const quarter = await repository.get(surveyVersion(req))
      if (!quarter.isVisible || !quarter.supported || !quarter.image) throw new HttpError(404, 'survey_quarter_image_not_found', 'Không tìm thấy ảnh.')
      // A public picture: it may be shown by a page on another origin (the landing page's dev
      // server, or a preview), which helmet's default "same-origin" would block.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      await sendImage(res, storage, quarter.image, 'public, max-age=86400')
    } catch (error) {
      next(storageError(error))
    }
  })

  return router
}

// Dashboard tab "Quý khảo sát". Everyone signed in can see it; admins and super admins
// change it. Every change is written to the admin audit log.
export function createSurveyQuarterAdminRouter(
  repository: PgSurveyQuarterRepository,
  reportRepository: Pick<PgReportRepository, 'getGenerationSettings'>,
  storage: ReportAssetStorage,
  authService: AuthService,
  config: RuntimeConfig,
) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  const requireEditor = (req: Request): AuditActor => {
    const session = getRequiredAdminSession(req)
    if (!canManageContent(session.user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền thay đổi quý khảo sát.')
    return { meta: getAuthRequestMeta(req, config), user: session.user }
  }

  const adminQuarter = (quarter: SurveyQuarter) => {
    const { image: _image, ...rest } = quarter
    return { ...rest, imageUrl: imagePath('/api/v1/admin/survey-quarters', quarter) }
  }

  router.get('/', async (_req, res, next) => {
    try {
      const [page, quarters, settings] = await Promise.all([repository.getPage(), repository.list(), reportRepository.getGenerationSettings()])
      res.setHeader('Cache-Control', 'no-store')
      res.json({
        data: {
          // Report creation paused for every quarter by the developers (.env), shown read-only.
          globalPaused: !settings.aiCallsEnabled,
          page,
          quarters: quarters.filter((quarter) => quarter.supported).map(adminQuarter),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.put('/page', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      res.json({ data: await repository.updatePage(normalizeSurveyQuarterPageUpdate(req.body), actor) })
    } catch (error) {
      next(error)
    }
  })

  router.put('/:version', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      const version = surveyVersion(req)
      res.json({ data: adminQuarter(await repository.update(version, normalizeSurveyQuarterUpdate(req.body), actor)) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:version/history', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: { items: await repository.history(surveyVersion(req)) } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/:version/image', async (req, res, next) => {
    try {
      const quarter = await repository.get(surveyVersion(req))
      if (!quarter.image) throw new HttpError(404, 'survey_quarter_image_not_found', 'Quý này chưa có ảnh.')
      await sendImage(res, storage, quarter.image, 'private, max-age=300')
    } catch (error) {
      next(storageError(error))
    }
  })

  // The new file is uploaded first, then the row points at it; the old file is removed
  // only after that commit, so a failure never leaves the card without an image.
  router.post('/:version/image', async (req, res, next) => {
    let upload: Awaited<ReturnType<typeof parseImageUpload>> | null = null
    let uploadedPath: string | null = null
    try {
      const actor = requireEditor(req)
      const version = surveyVersion(req)
      await repository.get(version)
      upload = await parseImageUpload(req)
      uploadedPath = `quarters/${version}/${randomUUID()}.${upload.extension}`
      await storage.uploadFile(uploadedPath, upload.filePath, upload.contentType)
      const result = await repository.setImage(version, { contentType: upload.contentType, sha256: upload.sha256, storagePath: uploadedPath }, actor)
      uploadedPath = null
      if (result.previous) await storage.removeFile(result.previous.storagePath).catch(() => undefined)
      res.status(201).json({ data: adminQuarter(result.quarter) })
    } catch (error) {
      if (uploadedPath) await storage.removeFile(uploadedPath).catch(() => undefined)
      next(storageError(error))
    } finally {
      if (upload) await removeImageUpload(upload)
    }
  })

  router.delete('/:version/image', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      const result = await repository.setImage(surveyVersion(req), null, actor)
      if (result.previous) await storage.removeFile(result.previous.storagePath).catch(() => undefined)
      res.json({ data: adminQuarter(result.quarter) })
    } catch (error) {
      next(storageError(error))
    }
  })

  return router
}

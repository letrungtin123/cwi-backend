import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { createAdminRequestRateLimit, getAuthRequestMeta, getRequiredAdminSession, requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import { uuidPattern } from '../../http/ids.js'
import { streamToResponse } from '../../http/streamResponse.js'
import type { AuditActor } from '../audit/adminAuditLog.js'
import { canManageContent } from '../auth/adminRoles.js'
import type { AuthService } from '../auth/authService.js'
import { ReportAssetStorageError, type ReportAssetStorage } from '../reports/reportAssetStorage.js'
import { parseImageUpload, removeImageUpload } from '../surveyQuarters/surveyQuarterImageUpload.js'
import { newsImageSrc } from './newsContent.js'
import { DEFAULT_NEWS_AUTHOR, type NewsPost, type PgNewsRepository } from './newsRepository.js'
import { newsSlugPattern, normalizeNewsCategoryInput, normalizeNewsPostInput, normalizeNewsShareSettingsInput, NEWS_POST_STATUSES, type NewsLanguage, type NewsPostStatus } from './newsValidation.js'

const SITE_NAME = 'CEO Workforce Index'
// Lists and posts change rarely; a minute of browser cache keeps ads traffic cheap while an
// admin's change (or a scheduled post) still shows up within a minute.
const PUBLIC_CACHE = 'public, max-age=60'
const PAGE_SIZE_MAX = 24

const newsHomeCopy = {
  en: {
    description: 'News, events and insights on leadership capability, management teams and the workforce of Vietnamese companies from CEO Workforce Index.',
    title: `News | ${SITE_NAME}`,
  },
  vi: {
    description: 'Tin tức, sự kiện và góc nhìn về năng lực lãnh đạo, đội ngũ quản lý và Hệ cộng lực của doanh nghiệp Việt Nam từ CEO Workforce Index.',
    title: `Tin tức | ${SITE_NAME}`,
  },
} as const

function mapStorageError(error: unknown) {
  if (error instanceof ReportAssetStorageError) {
    return new HttpError(error.retryable ? 503 : 500, error.retryable ? 'news_storage_unavailable' : 'news_storage_error', 'Kho ảnh hiện chưa khả dụng. Vui lòng thử lại sau.')
  }
  return error
}

function parseId(value: unknown, what: 'post' | 'category' | 'image') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    const messages = { category: 'Không tìm thấy chuyên mục.', image: 'Không tìm thấy ảnh.', post: 'Không tìm thấy bài viết.' }
    throw new HttpError(404, `news_${what}_not_found`, messages[what])
  }
  return value
}

function parseSlug(value: unknown) {
  if (typeof value !== 'string' || value.length > 120 || !newsSlugPattern.test(value)) throw new HttpError(404, 'news_not_found', 'Không tìm thấy trang.')
  return value
}

function parseInteger(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new HttpError(400, 'invalid_number', 'Tham số không hợp lệ.')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new HttpError(400, 'invalid_number', 'Tham số không hợp lệ.')
  return parsed
}

function parseSearch(value: unknown) {
  if (value === undefined) return null
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_search', 'Từ khóa tìm kiếm không hợp lệ.')
  const search = value.trim().replace(/\s+/g, ' ')
  if (search.length > 160) throw new HttpError(400, 'invalid_search', 'Từ khóa tìm kiếm quá dài.')
  return search || null
}

function parseStatusFilter(value: unknown): NewsPostStatus | 'scheduled' | null {
  if (value === undefined || value === '' || value === 'all') return null
  if (value === 'scheduled' || (typeof value === 'string' && (NEWS_POST_STATUSES as readonly string[]).includes(value))) return value as NewsPostStatus | 'scheduled'
  throw new HttpError(400, 'invalid_status', 'Trạng thái lọc không hợp lệ.')
}

function parseLanguage(value: unknown): NewsLanguage {
  return value === 'en' ? 'en' : 'vi'
}

async function removeFiles(storage: ReportAssetStorage, paths: string[]) {
  await Promise.all(paths.map((path) => storage.removeFile(path).catch(() => undefined)))
}

// The public view of a post: both languages, no editing details.
function toPublicPost(post: NewsPost) {
  return {
    author: { en: post.author.en || DEFAULT_NEWS_AUTHOR.en, vi: post.author.vi || DEFAULT_NEWS_AUTHOR.vi },
    // No author named: the page shows the CWI mark instead of an initial.
    authorIsDefault: { en: !post.author.en, vi: !post.author.vi },
    category: { name: post.category.name, slug: post.category.slug },
    content: post.content,
    coverAlt: post.coverAlt,
    coverUrl: post.coverImageId ? newsImageSrc(post.coverImageId) : null,
    excerpt: post.excerpt,
    publishedAt: post.publishedAt,
    readingMinutes: post.readingMinutes,
    seoDescription: post.seoDescription,
    seoTitle: post.seoTitle,
    slug: post.slug,
    source: post.source,
    tags: post.tags,
    title: post.title,
    updatedAt: post.updatedAt,
  }
}

function toAdminPost(post: NewsPost) {
  const { imageIds: _imageIds, ...rest } = post
  return { ...rest, coverUrl: post.coverImageId ? newsImageSrc(post.coverImageId) : null }
}

export type NewsPageMeta =
  | { redirect: string }
  | {
    description: string
    image: string | null
    imageAlt: string
    canonicalPath: string
    publishedAt: string | null
    status: 200 | 404
    title: string
    type: 'article' | 'website'
  }

// What the public server puts in <head> for a /tin-tuc page, so a shared link (Facebook,
// Zalo, LinkedIn) and search engines show the post's own title, text and picture.
export async function newsPageMeta(repository: PgNewsRepository, path: string, language: NewsLanguage): Promise<NewsPageMeta> {
  const home = newsHomeCopy[language]
  const notFound: NewsPageMeta = { canonicalPath: path, description: home.description, image: null, imageAlt: '', publishedAt: null, status: 404, title: language === 'en' ? `Page not found | ${SITE_NAME}` : `Không tìm thấy trang | ${SITE_NAME}`, type: 'website' }
  if (/^\/tin-tuc\/?$/.test(path)) {
    return { canonicalPath: '/tin-tuc', description: home.description, image: null, imageAlt: '', publishedAt: null, status: 200, title: home.title, type: 'website' }
  }
  const category = /^\/tin-tuc\/chuyen-muc\/([a-z0-9-]{1,80})\/?$/.exec(path)
  if (category) {
    const page = await repository.publicCategory(category[1]!, 0, 1)
    if (!page) return notFound
    return {
      canonicalPath: `/tin-tuc/chuyen-muc/${page.category.slug}`,
      description: page.category.description[language] || home.description,
      image: page.posts[0]?.coverUrl ?? null,
      imageAlt: page.category.name[language],
      publishedAt: null,
      status: 200,
      title: `${page.category.name[language]} | ${language === 'en' ? 'News' : 'Tin tức'} ${SITE_NAME}`,
      type: 'website',
    }
  }
  const tag = /^\/tin-tuc\/the\/([a-z0-9-]{1,60})\/?$/.exec(path)
  if (tag) {
    const page = await repository.publicTag(tag[1]!, 0, 1)
    if (!page) return notFound
    return {
      canonicalPath: `/tin-tuc/the/${page.tag.slug}`,
      description: home.description,
      image: page.posts[0]?.coverUrl ?? null,
      imageAlt: page.tag.label[language],
      publishedAt: null,
      status: 200,
      title: `#${page.tag.label[language]} | ${language === 'en' ? 'News' : 'Tin tức'} ${SITE_NAME}`,
      type: 'website',
    }
  }
  const postPath = /^\/tin-tuc\/([a-z0-9-]{1,120})\/?$/.exec(path)
  if (postPath) {
    const found = await repository.publicPost(postPath[1]!)
    if (!found) return notFound
    if ('redirectTo' in found) return { redirect: `/tin-tuc/${found.redirectTo}` }
    const { post } = found
    return {
      canonicalPath: `/tin-tuc/${post.slug}`,
      description: post.seoDescription[language] || post.excerpt[language] || post.excerpt.vi,
      image: post.coverImageId ? newsImageSrc(post.coverImageId) : null,
      imageAlt: post.coverAlt[language] || post.title[language] || post.title.vi,
      publishedAt: post.publishedAt,
      status: 200,
      title: `${post.seoTitle[language] || post.title[language] || post.title.vi} | ${SITE_NAME}`,
      type: 'article',
    }
  }
  return notFound
}

export function createNewsPublicRouter(repository: PgNewsRepository, imageStorage: ReportAssetStorage) {
  const router = Router()

  router.get('/home', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', PUBLIC_CACHE)
      res.json({ data: await repository.publicHome() })
    } catch (error) { next(error) }
  })

  router.get('/categories/:slug', async (req, res, next) => {
    try {
      const page = await repository.publicCategory(parseSlug(req.params.slug), parseInteger(req.query.offset, 0, 0, 100_000), parseInteger(req.query.limit, 9, 1, PAGE_SIZE_MAX))
      if (!page) throw new HttpError(404, 'news_category_not_found', 'Không tìm thấy chuyên mục.')
      res.setHeader('Cache-Control', PUBLIC_CACHE)
      res.json({ data: page })
    } catch (error) { next(error) }
  })

  router.get('/tags/:slug', async (req, res, next) => {
    try {
      const page = await repository.publicTag(parseSlug(req.params.slug), parseInteger(req.query.offset, 0, 0, 100_000), parseInteger(req.query.limit, 9, 1, PAGE_SIZE_MAX))
      if (!page) throw new HttpError(404, 'news_tag_not_found', 'Không tìm thấy thẻ.')
      res.setHeader('Cache-Control', PUBLIC_CACHE)
      res.json({ data: page })
    } catch (error) { next(error) }
  })

  // An old link answers with the post's current link ({ redirectTo }), so the page can
  // switch the address without losing the ad's utm_* parameters.
  router.get('/posts/:slug', async (req, res, next) => {
    try {
      const found = await repository.publicPost(parseSlug(req.params.slug))
      if (!found) throw new HttpError(404, 'news_post_not_found', 'Không tìm thấy bài viết.')
      res.setHeader('Cache-Control', PUBLIC_CACHE)
      if ('redirectTo' in found) {
        res.json({ data: { redirectTo: found.redirectTo } })
        return
      }
      // The page shows only the share buttons switched on in "Tin tức" -> "Cài đặt".
      const { share } = await repository.getSettings()
      res.json({ data: { post: toPublicPost(found.post), related: found.related, share } })
    } catch (error) { next(error) }
  })

  // Counted once per visit by the page (not by link previews or the server's <head> step).
  router.post('/posts/:slug/views', async (req, res, next) => {
    try {
      await repository.countView(parseSlug(req.params.slug))
      res.setHeader('Cache-Control', 'no-store')
      res.status(204).end()
    } catch (error) { next(error) }
  })

  // A picture never changes under its id, so it may be cached for good.
  router.get('/images/:id', async (req, res, next) => {
    try {
      const image = await repository.findImage(parseId(req.params.id, 'image'))
      if (!image) throw new HttpError(404, 'news_image_not_found', 'Không tìm thấy ảnh.')
      const asset = await imageStorage.download(image.storagePath)
      res.status(200)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.setHeader('Content-Type', image.contentType)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // Shown by pages on other origins too (link previews, the dashboard's dev server).
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
      if (asset.contentLength) res.setHeader('Content-Length', asset.contentLength)
      await streamToResponse(asset.body as globalThis.ReadableStream<Uint8Array>, res)
    } catch (error) { next(mapStorageError(error)) }
  })

  router.get('/meta', async (req, res, next) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path.slice(0, 300) : ''
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await newsPageMeta(repository, path, parseLanguage(req.query.lang)) })
    } catch (error) { next(error) }
  })

  router.get('/sitemap', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ data: await repository.publicSitemap() })
    } catch (error) { next(error) }
  })

  return router
}

// Dashboard "Tin tức". Everyone signed in sees the list of posts and categories; admins and
// super admins write, publish and delete. Every change is written to the admin audit log.
export function createNewsAdminRouter(repository: PgNewsRepository, imageStorage: ReportAssetStorage, authService: AuthService, config: RuntimeConfig) {
  const router = Router()
  router.use(requireAdminSession(authService, config))
  router.use(createAdminRequestRateLimit(config))

  const requireEditor = (req: Request): AuditActor => {
    const session = getRequiredAdminSession(req)
    if (!canManageContent(session.user.role)) throw new HttpError(403, 'admin_required', 'Bạn không có quyền thay đổi Tin tức.')
    return { meta: getAuthRequestMeta(req, config), user: session.user }
  }

  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store')

  router.get('/categories', async (_req, res, next) => {
    try {
      noStore(res)
      res.json({ data: { items: await repository.listCategories() } })
    } catch (error) { next(error) }
  })

  router.post('/categories', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      res.status(201).json({ data: await repository.createCategory(normalizeNewsCategoryInput(req.body), actor) })
    } catch (error) { next(error) }
  })

  router.put('/categories/:id', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      res.json({ data: await repository.updateCategory(parseId(req.params.id, 'category'), normalizeNewsCategoryInput(req.body), actor) })
    } catch (error) { next(error) }
  })

  router.delete('/categories/:id', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      await repository.deleteCategory(parseId(req.params.id, 'category'), actor)
      res.json({ data: { deleted: true } })
    } catch (error) { next(error) }
  })

  router.get('/categories/:id/history', async (req, res, next) => {
    try {
      noStore(res)
      res.json({ data: { items: await repository.categoryHistory(parseId(req.params.id, 'category')) } })
    } catch (error) { next(error) }
  })

  router.get('/posts', async (req, res, next) => {
    try {
      const pageSize = parseInteger(req.query.pageSize, 20, 1, 100)
      const page = parseInteger(req.query.page, 1, 1, 10_000)
      const categoryId = req.query.categoryId === undefined || req.query.categoryId === '' || req.query.categoryId === 'all' ? null : parseId(req.query.categoryId, 'category')
      const result = await repository.listPosts({ categoryId, limit: pageSize, offset: (page - 1) * pageSize, search: parseSearch(req.query.search), status: parseStatusFilter(req.query.status) })
      noStore(res)
      res.json({ data: { ...result, page, pageSize } })
    } catch (error) { next(error) }
  })

  router.get('/posts/:id', async (req, res, next) => {
    try {
      requireEditor(req)
      noStore(res)
      res.json({ data: toAdminPost(await repository.getPost(parseId(req.params.id, 'post'))) })
    } catch (error) { next(error) }
  })

  router.post('/posts', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      res.status(201).json({ data: toAdminPost(await repository.createPost(normalizeNewsPostInput(req.body), actor)) })
    } catch (error) { next(error) }
  })

  router.put('/posts/:id', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      const { post, removedImagePaths } = await repository.updatePost(parseId(req.params.id, 'post'), normalizeNewsPostInput(req.body), actor)
      await removeFiles(imageStorage, removedImagePaths)
      res.json({ data: toAdminPost(post) })
    } catch (error) { next(error) }
  })

  router.delete('/posts/:id', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      const { removedImagePaths } = await repository.deletePost(parseId(req.params.id, 'post'), actor)
      await removeFiles(imageStorage, removedImagePaths)
      res.json({ data: { deleted: true } })
    } catch (error) { next(error) }
  })

  router.get('/posts/:id/history', async (req, res, next) => {
    try {
      noStore(res)
      res.json({ data: { items: await repository.postHistory(parseId(req.params.id, 'post')) } })
    } catch (error) { next(error) }
  })

  router.get('/settings', async (_req, res, next) => {
    try {
      noStore(res)
      res.json({ data: await repository.getSettings() })
    } catch (error) { next(error) }
  })

  router.put('/settings', async (req, res, next) => {
    try {
      const actor = requireEditor(req)
      res.json({ data: await repository.saveSettings(normalizeNewsShareSettingsInput(req.body), actor) })
    } catch (error) { next(error) }
  })

  // One picture (cover or inline). The file goes to storage first, then gets its row.
  router.post('/images', async (req, res, next) => {
    let upload: Awaited<ReturnType<typeof parseImageUpload>> | null = null
    let uploadedPath: string | null = null
    try {
      const actor = requireEditor(req)
      upload = await parseImageUpload(req)
      const now = new Date()
      uploadedPath = `news/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${upload.extension}`
      await imageStorage.uploadFile(uploadedPath, upload.filePath, upload.contentType)
      const image = await repository.registerImage({ contentType: upload.contentType, fileSize: upload.fileSize, sha256: upload.sha256, storagePath: uploadedPath }, actor)
      uploadedPath = null
      res.status(201).json({ data: image })
      // Tidy up pictures from posts that were never saved.
      void repository.removeOrphanImages().then((paths) => removeFiles(imageStorage, paths)).catch(() => undefined)
    } catch (error) {
      if (uploadedPath) await imageStorage.removeFile(uploadedPath).catch(() => undefined)
      next(mapStorageError(error))
    } finally {
      if (upload) await removeImageUpload(upload)
    }
  })

  return router
}

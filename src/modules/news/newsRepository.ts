import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import { listAdminAudit, writeAdminAudit, type AuditActor, type AuditEntry } from '../audit/adminAuditLog.js'
import { EMPTY_NEWS_DOC, newsDocHasContent, newsDocImageIds, newsImageSrc, newsReadingMinutes, type NewsDoc } from './newsContent.js'
import { slugify, type Bilingual, type NewsCategoryInput, type NewsPostInput, type NewsPostStatus } from './newsValidation.js'

export const NEWS_POST_AUDIT_TARGET = 'news_post'
export const NEWS_CATEGORY_AUDIT_TARGET = 'news_category'

// Shown when a post names no author.
export const DEFAULT_NEWS_AUTHOR: Bilingual = { en: 'CWI Editorial Team', vi: 'Ban biên tập CWI' }

// An uploaded picture no post uses is removed after this long (an editor may still have
// it in an unsaved post).
const ORPHAN_IMAGE_HOURS = 48

// Public: published, its time has come (a later time means scheduled) and its category is shown.
const PUBLIC_POST = `p.status = 'published' AND p.published_at <= now() AND c.is_visible`

export type NewsCategory = {
  createdAt: string
  description: Bilingual
  id: string
  isVisible: boolean
  name: Bilingual
  postCount: number
  publicPostCount: number
  slug: string
  sortOrder: number
  updatedAt: string
  updatedByEmail: string | null
}

export type NewsPost = {
  author: Bilingual
  category: { id: string; isVisible: boolean; name: Bilingual; slug: string }
  content: Bilingual<NewsDoc>
  coverAlt: Bilingual
  coverImageId: string | null
  createdAt: string
  createdBy: { email: string | null; name: string | null }
  excerpt: Bilingual
  id: string
  imageIds: string[]
  isPinned: boolean
  previousSlugs: string[]
  publishedAt: string | null
  readingMinutes: Bilingual<number>
  seoDescription: Bilingual
  seoTitle: Bilingual
  slug: string
  source: { name: string; url: string }
  status: NewsPostStatus
  tags: Bilingual<string[]>
  title: Bilingual
  updatedAt: string
  updatedBy: { email: string | null; name: string | null }
  version: number
  viewCount: number
}

export type NewsPostListItem = {
  category: { id: string; name: Bilingual }
  coverImageId: string | null
  hasEnglish: boolean
  id: string
  isPinned: boolean
  publishedAt: string | null
  slug: string
  status: NewsPostStatus
  title: Bilingual
  updatedAt: string
  updatedBy: { email: string | null; name: string | null }
  viewCount: number
}

export type NewsCard = {
  category: { name: Bilingual; slug: string }
  coverAlt: Bilingual
  coverUrl: string | null
  excerpt: Bilingual
  isPinned: boolean
  publishedAt: string
  readingMinutes: Bilingual<number>
  slug: string
  title: Bilingual
}

export type NewsImage = { contentType: string; id: string; storagePath: string }

type CategoryRow = {
  created_at: Date
  description_en: string
  description_vi: string
  id: string
  is_visible: boolean
  name_en: string
  name_vi: string
  post_count: number
  public_post_count: number
  slug: string
  sort_order: number
  updated_at: Date
  updated_by_email: string | null
}

type PostRow = {
  author_en: string
  author_vi: string
  category_id: string
  category_name_en: string
  category_name_vi: string
  category_slug: string
  category_visible: boolean
  content_en: NewsDoc | null
  content_vi: NewsDoc | null
  cover_alt_en: string
  cover_alt_vi: string
  cover_image_id: string | null
  created_at: Date
  created_by_email: string | null
  created_by_name: string | null
  excerpt_en: string
  excerpt_vi: string
  id: string
  image_ids: string[]
  is_pinned: boolean
  previous_slugs: string[]
  published_at: Date | null
  reading_minutes_en: number
  reading_minutes_vi: number
  seo_description_en: string
  seo_description_vi: string
  seo_title_en: string
  seo_title_vi: string
  slug: string
  source_name: string
  source_url: string
  status: NewsPostStatus
  tags_en: string[]
  tags_vi: string[]
  title_en: string
  title_vi: string
  updated_at: Date
  updated_by_email: string | null
  updated_by_name: string | null
  version: number
  view_count: string
}

type CardRow = {
  category_name_en: string
  category_name_vi: string
  category_slug: string
  cover_alt_en: string
  cover_alt_vi: string
  cover_image_id: string | null
  excerpt_en: string
  excerpt_vi: string
  id: string
  is_pinned: boolean
  published_at: Date
  reading_minutes_en: number
  reading_minutes_vi: number
  slug: string
  title_en: string
  title_vi: string
}

type Queryable = Pick<pg.Pool, 'query'> | pg.PoolClient

const categorySelect = `SELECT
    c.id, c.slug, c.name_vi, c.name_en, c.description_vi, c.description_en, c.sort_order, c.is_visible,
    c.created_at, c.updated_at, c.updated_by_email,
    (SELECT count(*)::int FROM public.cwi_news_posts AS p WHERE p.category_id = c.id) AS post_count,
    (SELECT count(*)::int FROM public.cwi_news_posts AS p WHERE p.category_id = c.id AND ${PUBLIC_POST}) AS public_post_count
  FROM public.cwi_news_categories AS c`

const postSelect = `SELECT
    p.id, p.slug, p.previous_slugs, p.category_id, p.status, p.published_at, p.is_pinned,
    p.title_vi, p.title_en, p.excerpt_vi, p.excerpt_en, p.content_vi, p.content_en,
    p.reading_minutes_vi, p.reading_minutes_en, p.cover_image_id, p.cover_alt_vi, p.cover_alt_en,
    p.tags_vi, p.tags_en, p.author_vi, p.author_en, p.source_name, p.source_url,
    p.seo_title_vi, p.seo_title_en, p.seo_description_vi, p.seo_description_en,
    p.image_ids, p.view_count, p.version, p.created_at, p.updated_at, p.created_by_email, p.updated_by_email,
    creator.display_name AS created_by_name, editor.display_name AS updated_by_name,
    c.slug AS category_slug, c.name_vi AS category_name_vi, c.name_en AS category_name_en, c.is_visible AS category_visible
  FROM public.cwi_news_posts AS p
  JOIN public.cwi_news_categories AS c ON c.id = p.category_id
  LEFT JOIN public.cwi_admin_users AS creator ON creator.id = p.created_by_admin_id
  LEFT JOIN public.cwi_admin_users AS editor ON editor.id = p.updated_by_admin_id`

const cardSelect = `SELECT
    p.id, p.slug, p.title_vi, p.title_en, p.excerpt_vi, p.excerpt_en, p.cover_image_id, p.cover_alt_vi, p.cover_alt_en,
    p.published_at, p.reading_minutes_vi, p.reading_minutes_en, p.is_pinned,
    c.slug AS category_slug, c.name_vi AS category_name_vi, c.name_en AS category_name_en
  FROM public.cwi_news_posts AS p
  JOIN public.cwi_news_categories AS c ON c.id = p.category_id`

function mapCategory(row: CategoryRow): NewsCategory {
  return {
    createdAt: row.created_at.toISOString(),
    description: { en: row.description_en, vi: row.description_vi },
    id: row.id,
    isVisible: row.is_visible,
    name: { en: row.name_en, vi: row.name_vi },
    postCount: row.post_count,
    publicPostCount: row.public_post_count,
    slug: row.slug,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at.toISOString(),
    updatedByEmail: row.updated_by_email,
  }
}

function mapPost(row: PostRow): NewsPost {
  return {
    author: { en: row.author_en, vi: row.author_vi },
    category: { id: row.category_id, isVisible: row.category_visible, name: { en: row.category_name_en, vi: row.category_name_vi }, slug: row.category_slug },
    content: { en: row.content_en ?? EMPTY_NEWS_DOC, vi: row.content_vi ?? EMPTY_NEWS_DOC },
    coverAlt: { en: row.cover_alt_en, vi: row.cover_alt_vi },
    coverImageId: row.cover_image_id,
    createdAt: row.created_at.toISOString(),
    createdBy: { email: row.created_by_email, name: row.created_by_name },
    excerpt: { en: row.excerpt_en, vi: row.excerpt_vi },
    id: row.id,
    imageIds: row.image_ids,
    isPinned: row.is_pinned,
    previousSlugs: row.previous_slugs,
    publishedAt: row.published_at?.toISOString() ?? null,
    readingMinutes: { en: row.reading_minutes_en, vi: row.reading_minutes_vi },
    seoDescription: { en: row.seo_description_en, vi: row.seo_description_vi },
    seoTitle: { en: row.seo_title_en, vi: row.seo_title_vi },
    slug: row.slug,
    source: { name: row.source_name, url: row.source_url },
    status: row.status,
    tags: { en: row.tags_en, vi: row.tags_vi },
    title: { en: row.title_en, vi: row.title_vi },
    updatedAt: row.updated_at.toISOString(),
    updatedBy: { email: row.updated_by_email, name: row.updated_by_name },
    version: row.version,
    viewCount: Number(row.view_count),
  }
}

export function mapCard(row: CardRow): NewsCard {
  return {
    category: { name: { en: row.category_name_en, vi: row.category_name_vi }, slug: row.category_slug },
    coverAlt: { en: row.cover_alt_en, vi: row.cover_alt_vi },
    coverUrl: row.cover_image_id ? newsImageSrc(row.cover_image_id) : null,
    excerpt: { en: row.excerpt_en, vi: row.excerpt_vi },
    isPinned: row.is_pinned,
    publishedAt: row.published_at.toISOString(),
    readingMinutes: { en: row.reading_minutes_en, vi: row.reading_minutes_vi },
    slug: row.slug,
    title: { en: row.title_en, vi: row.title_vi },
  }
}

function isUniqueViolation(error: unknown, constraint?: string) {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== '23505') return false
  return !constraint || ('constraint' in error && error.constraint === constraint)
}

function isForeignKeyViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23503'
}

function categoryNotFound() {
  return new HttpError(404, 'news_category_not_found', 'Không tìm thấy chuyên mục.')
}

function postNotFound() {
  return new HttpError(404, 'news_post_not_found', 'Không tìm thấy bài viết.')
}

// What "Đăng" needs: both languages written, and a cover picture.
export function missingForPublish(input: Pick<NewsPostInput, 'content' | 'coverImageId' | 'excerpt' | 'title'>) {
  const missing: string[] = []
  for (const [language, label] of [['vi', 'tiếng Việt'], ['en', 'tiếng Anh']] as const) {
    if (!input.title[language]) missing.push(`Tiêu đề (${label})`)
    if (!input.excerpt[language]) missing.push(`Sapo (${label})`)
    if (!newsDocHasContent(input.content[language])) missing.push(`Nội dung (${label})`)
  }
  if (!input.coverImageId) missing.push('Ảnh đại diện')
  return missing
}

type Changes = string[]

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Field names (not values) that a save changed, for the history.
function diffPost(before: NewsPost, input: NewsPostInput, publishedAt: Date | null): Changes {
  const changes: Changes = []
  const bilingualFields = ['title', 'excerpt', 'coverAlt', 'author', 'seoTitle', 'seoDescription', 'tags', 'content'] as const
  for (const field of bilingualFields) {
    for (const language of ['vi', 'en'] as const) {
      if (!same(before[field][language], input[field][language])) changes.push(`${field}.${language}`)
    }
  }
  if (before.slug !== input.slug) changes.push('slug')
  if (before.category.id !== input.categoryId) changes.push('category')
  if (before.status !== input.status) changes.push('status')
  if ((before.publishedAt ?? null) !== (publishedAt?.toISOString() ?? null)) changes.push('publishedAt')
  if (before.isPinned !== input.isPinned) changes.push('isPinned')
  if (before.coverImageId !== input.coverImageId) changes.push('coverImage')
  if (!same(before.source, input.source)) changes.push('source')
  return changes
}

function postImageIds(input: Pick<NewsPostInput, 'content' | 'coverImageId'>) {
  const ids = new Set<string>([...newsDocImageIds(input.content.vi), ...newsDocImageIds(input.content.en)])
  if (input.coverImageId) ids.add(input.coverImageId)
  return [...ids]
}

async function assertImagesExist(db: Queryable, ids: string[]) {
  if (!ids.length) return
  const found = await db.query<{ id: string }>('SELECT id FROM public.cwi_news_images WHERE id = ANY($1::uuid[])', [ids])
  if (found.rows.length !== ids.length) {
    throw new HttpError(422, 'news_image_missing', 'Bài viết có ảnh không còn trong kho ảnh. Vui lòng tải lại ảnh đó.')
  }
}

// An old link of another post must keep opening that post (ads may still point at it).
async function assertSlugFree(db: Queryable, slug: string, postId: string | null) {
  const taken = await db.query<{ slug: string; title_vi: string }>(
    `SELECT slug, title_vi FROM public.cwi_news_posts
    WHERE (slug = $1 OR $1 = ANY(previous_slugs)) AND ($2::uuid IS NULL OR id <> $2::uuid)
    LIMIT 1`,
    [slug, postId],
  )
  const row = taken.rows[0]
  if (!row) return
  throw new HttpError(409, 'news_post_slug_taken', row.slug === slug
    ? `Đường dẫn “${slug}” đã được bài “${row.title_vi}” dùng. Vui lòng chọn đường dẫn khác.`
    : `Đường dẫn “${slug}” là link cũ của bài “${row.title_vi}” (link cũ vẫn đang mở bài đó). Vui lòng chọn đường dẫn khác.`)
}

async function assertCategoryExists(db: Queryable, categoryId: string) {
  const found = await db.query('SELECT 1 FROM public.cwi_news_categories WHERE id = $1', [categoryId])
  if (!found.rowCount) throw new HttpError(422, 'news_category_missing', 'Chuyên mục đã chọn không còn tồn tại. Vui lòng chọn chuyên mục khác.')
}

// Removes the given pictures where no post uses them any more. Returns their storage paths
// so the caller can delete the files after the commit.
async function removeUnusedImages(db: Queryable, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const removed = await db.query<{ storage_path: string }>(
    `DELETE FROM public.cwi_news_images AS image
    WHERE image.id = ANY($1::uuid[])
      AND NOT EXISTS (SELECT 1 FROM public.cwi_news_posts AS p WHERE p.image_ids @> ARRAY[image.id])
    RETURNING image.storage_path`,
    [ids],
  )
  return removed.rows.map((row) => row.storage_path)
}

// The publish time the admin chose, else the one the post already has. Null on a post being
// published means "now": the database fills in its own clock (publishedAtSql), the same clock
// the public pages compare with, so a post published now is never shown as scheduled.
function publishedAtFor(input: NewsPostInput, before: NewsPost | null): Date | null {
  if (input.publishedAt) return input.publishedAt
  return before?.publishedAt ? new Date(before.publishedAt) : null
}

function publishedAtSql(statusParam: string, publishedAtParam: string) {
  return `CASE WHEN ${statusParam} = 'published' THEN COALESCE(${publishedAtParam}::timestamptz, now()) ELSE ${publishedAtParam}::timestamptz END`
}

function assertPublishable(input: NewsPostInput) {
  if (input.status !== 'published') return
  const missing = missingForPublish(input)
  if (missing.length) {
    throw new HttpError(422, 'news_post_incomplete', `Chưa đăng được, còn thiếu: ${missing.join(', ')}.`, { missing })
  }
}

const postWriteColumns = `slug, category_id, status, published_at, is_pinned,
  title_vi, title_en, excerpt_vi, excerpt_en, content_vi, content_en, reading_minutes_vi, reading_minutes_en,
  cover_image_id, cover_alt_vi, cover_alt_en, tags_vi, tags_en, author_vi, author_en, source_name, source_url,
  seo_title_vi, seo_title_en, seo_description_vi, seo_description_en, image_ids`

function postWriteValues(input: NewsPostInput, publishedAt: Date | null, imageIds: string[]) {
  return [
    input.slug, input.categoryId, input.status, publishedAt, input.isPinned,
    input.title.vi, input.title.en, input.excerpt.vi, input.excerpt.en,
    JSON.stringify(input.content.vi), JSON.stringify(input.content.en),
    newsReadingMinutes(input.content.vi), newsReadingMinutes(input.content.en),
    input.coverImageId, input.coverAlt.vi, input.coverAlt.en, input.tags.vi, input.tags.en,
    input.author.vi, input.author.en, input.source.name, input.source.url,
    input.seoTitle.vi, input.seoTitle.en, input.seoDescription.vi, input.seoDescription.en, imageIds,
  ]
}

function rethrowSlugConflict(error: unknown, slug: string): never {
  if (isUniqueViolation(error, 'cwi_news_posts_slug_key')) {
    throw new HttpError(409, 'news_post_slug_taken', `Đường dẫn “${slug}” đã được bài khác dùng. Vui lòng chọn đường dẫn khác.`)
  }
  if (isForeignKeyViolation(error)) throw new HttpError(422, 'news_reference_missing', 'Chuyên mục hoặc ảnh của bài không còn tồn tại. Vui lòng tải lại trang.')
  throw error
}

export class PgNewsRepository {
  constructor(private readonly pool: pg.Pool) {}

  // ---- Categories --------------------------------------------------------------------

  async listCategories(): Promise<NewsCategory[]> {
    const result = await this.pool.query<CategoryRow>(`${categorySelect} ORDER BY c.sort_order, c.name_vi, c.id`)
    return result.rows.map(mapCategory)
  }

  async getCategory(id: string, db: Queryable = this.pool): Promise<NewsCategory> {
    const result = await db.query<CategoryRow>(`${categorySelect} WHERE c.id = $1`, [id])
    const row = result.rows[0]
    if (!row) throw categoryNotFound()
    return mapCategory(row)
  }

  async createCategory(input: NewsCategoryInput, actor: AuditActor): Promise<NewsCategory> {
    try {
      const id = await withTransaction(this.pool, async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO public.cwi_news_categories (slug, name_vi, name_en, description_vi, description_en, sort_order, is_visible,
            created_by_admin_id, updated_by_admin_id, created_by_email, updated_by_email)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $9)
          RETURNING id`,
          [input.slug, input.name.vi, input.name.en, input.description.vi, input.description.en, input.sortOrder, input.isVisible, actor.user.id, actor.user.email],
        )
        const categoryId = created.rows[0]!.id
        await writeAdminAudit(client, actor, {
          action: 'news_category.create',
          metadata: { name: input.name.vi, slug: input.slug },
          targetId: categoryId,
          targetType: NEWS_CATEGORY_AUDIT_TARGET,
        })
        return categoryId
      })
      return this.getCategory(id)
    } catch (error) {
      if (isUniqueViolation(error, 'cwi_news_categories_slug_key')) throw new HttpError(409, 'news_category_slug_taken', `Đường dẫn chuyên mục “${input.slug}” đã có. Vui lòng chọn đường dẫn khác.`)
      throw error
    }
  }

  async updateCategory(id: string, input: NewsCategoryInput, actor: AuditActor): Promise<NewsCategory> {
    try {
      await withTransaction(this.pool, async (client) => {
        const current = await client.query<CategoryRow>(`${categorySelect} WHERE c.id = $1 FOR UPDATE OF c`, [id])
        const row = current.rows[0]
        if (!row) throw categoryNotFound()
        const before = mapCategory(row)
        const changes: Record<string, { from: unknown; to: unknown }> = {}
        const note = (key: string, from: unknown, to: unknown) => { if (!same(from, to)) changes[key] = { from, to } }
        note('slug', before.slug, input.slug)
        note('nameVi', before.name.vi, input.name.vi)
        note('nameEn', before.name.en, input.name.en)
        note('descriptionVi', before.description.vi, input.description.vi)
        note('descriptionEn', before.description.en, input.description.en)
        note('sortOrder', before.sortOrder, input.sortOrder)
        note('isVisible', before.isVisible, input.isVisible)
        if (!Object.keys(changes).length) return
        await client.query(
          `UPDATE public.cwi_news_categories
          SET slug = $2, name_vi = $3, name_en = $4, description_vi = $5, description_en = $6, sort_order = $7, is_visible = $8,
              updated_by_admin_id = $9, updated_by_email = $10
          WHERE id = $1`,
          [id, input.slug, input.name.vi, input.name.en, input.description.vi, input.description.en, input.sortOrder, input.isVisible, actor.user.id, actor.user.email],
        )
        await writeAdminAudit(client, actor, {
          action: 'news_category.update',
          metadata: { changes, name: input.name.vi },
          targetId: id,
          targetType: NEWS_CATEGORY_AUDIT_TARGET,
        })
      })
    } catch (error) {
      if (isUniqueViolation(error, 'cwi_news_categories_slug_key')) throw new HttpError(409, 'news_category_slug_taken', `Đường dẫn chuyên mục “${input.slug}” đã có. Vui lòng chọn đường dẫn khác.`)
      throw error
    }
    return this.getCategory(id)
  }

  // Only an empty category can go; one with posts is hidden instead.
  async deleteCategory(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const current = await client.query<CategoryRow>(`${categorySelect} WHERE c.id = $1 FOR UPDATE OF c`, [id])
      const row = current.rows[0]
      if (!row) throw categoryNotFound()
      const posts = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM public.cwi_news_posts WHERE category_id = $1', [id])
      const count = posts.rows[0]?.count ?? 0
      if (count > 0) {
        throw new HttpError(409, 'news_category_not_empty', `Chuyên mục “${row.name_vi}” còn ${count} bài viết. Hãy chuyển các bài sang chuyên mục khác, hoặc ẩn chuyên mục thay vì xóa.`)
      }
      await writeAdminAudit(client, actor, {
        action: 'news_category.delete',
        metadata: { name: row.name_vi, slug: row.slug },
        targetId: id,
        targetType: NEWS_CATEGORY_AUDIT_TARGET,
      })
      await client.query('DELETE FROM public.cwi_news_categories WHERE id = $1', [id])
    })
  }

  categoryHistory(id: string): Promise<AuditEntry[]> {
    return listAdminAudit(this.pool, NEWS_CATEGORY_AUDIT_TARGET, id)
  }

  // ---- Posts (dashboard) -------------------------------------------------------------

  async listPosts(filters: { categoryId: string | null; limit: number; offset: number; search: string | null; status: NewsPostStatus | 'scheduled' | null }): Promise<{ items: NewsPostListItem[]; total: number }> {
    const where: string[] = []
    const values: unknown[] = []
    const add = (value: unknown) => {
      values.push(value)
      return `$${values.length}`
    }
    if (filters.categoryId) where.push(`p.category_id = ${add(filters.categoryId)}`)
    if (filters.status === 'scheduled') where.push(`p.status = 'published' AND p.published_at > now()`)
    else if (filters.status === 'published') where.push(`p.status = 'published' AND p.published_at <= now()`)
    else if (filters.status) where.push(`p.status = ${add(filters.status)}`)
    if (filters.search) {
      const pattern = add(`%${filters.search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`)
      where.push(`(p.title_vi ILIKE ${pattern} OR p.title_en ILIKE ${pattern} OR p.slug ILIKE ${pattern})`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = await this.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.cwi_news_posts AS p ${whereSql}`, values)
    const limit = add(filters.limit)
    const offset = add(filters.offset)
    const result = await this.pool.query<{
      category_id: string
      category_name_en: string
      category_name_vi: string
      cover_image_id: string | null
      has_english: boolean
      id: string
      is_pinned: boolean
      published_at: Date | null
      slug: string
      status: NewsPostStatus
      title_en: string
      title_vi: string
      updated_at: Date
      updated_by_email: string | null
      updated_by_name: string | null
      view_count: string
    }>(
      `SELECT p.id, p.slug, p.status, p.published_at, p.is_pinned, p.title_vi, p.title_en, p.cover_image_id, p.view_count,
        p.updated_at, p.updated_by_email, editor.display_name AS updated_by_name,
        p.category_id, c.name_vi AS category_name_vi, c.name_en AS category_name_en,
        (length(btrim(p.title_en)) > 0 AND length(btrim(p.excerpt_en)) > 0 AND jsonb_array_length(COALESCE(p.content_en->'content', '[]'::jsonb)) > 0) AS has_english
      FROM public.cwi_news_posts AS p
      JOIN public.cwi_news_categories AS c ON c.id = p.category_id
      LEFT JOIN public.cwi_admin_users AS editor ON editor.id = p.updated_by_admin_id
      ${whereSql}
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
      values,
    )
    return {
      items: result.rows.map((row) => ({
        category: { id: row.category_id, name: { en: row.category_name_en, vi: row.category_name_vi } },
        coverImageId: row.cover_image_id,
        hasEnglish: row.has_english,
        id: row.id,
        isPinned: row.is_pinned,
        publishedAt: row.published_at?.toISOString() ?? null,
        slug: row.slug,
        status: row.status,
        title: { en: row.title_en, vi: row.title_vi },
        updatedAt: row.updated_at.toISOString(),
        updatedBy: { email: row.updated_by_email, name: row.updated_by_name },
        viewCount: Number(row.view_count),
      })),
      total: total.rows[0]?.count ?? 0,
    }
  }

  async getPost(id: string, db: Queryable = this.pool): Promise<NewsPost> {
    const result = await db.query<PostRow>(`${postSelect} WHERE p.id = $1`, [id])
    const row = result.rows[0]
    if (!row) throw postNotFound()
    return mapPost(row)
  }

  async createPost(input: NewsPostInput, actor: AuditActor): Promise<NewsPost> {
    assertPublishable(input)
    const publishedAt = publishedAtFor(input, null)
    const imageIds = postImageIds(input)
    try {
      const id = await withTransaction(this.pool, async (client) => {
        await assertCategoryExists(client, input.categoryId)
        await assertImagesExist(client, imageIds)
        await assertSlugFree(client, input.slug, null)
        const created = await client.query<{ id: string }>(
          `INSERT INTO public.cwi_news_posts (${postWriteColumns}, created_by_admin_id, updated_by_admin_id, created_by_email, updated_by_email)
          VALUES ($1, $2, $3, ${publishedAtSql('$3', '$4')}, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::uuid[], $28, $28, $29, $29)
          RETURNING id`,
          [...postWriteValues(input, publishedAt, imageIds), actor.user.id, actor.user.email],
        )
        const postId = created.rows[0]!.id
        await writeAdminAudit(client, actor, {
          action: 'news_post.create',
          metadata: { slug: input.slug, status: input.status, title: input.title.vi },
          targetId: postId,
          targetType: NEWS_POST_AUDIT_TARGET,
        })
        return postId
      })
      return this.getPost(id)
    } catch (error) {
      rethrowSlugConflict(error, input.slug)
    }
  }

  // Saving from an older copy (someone else saved meanwhile) is refused. Returns the
  // storage paths of pictures the post no longer uses, to delete after the commit.
  async updatePost(id: string, input: NewsPostInput, actor: AuditActor): Promise<{ post: NewsPost; removedImagePaths: string[] }> {
    if (input.version === null) throw new HttpError(400, 'news_post_version_required', 'Thiếu phiên bản của bài viết. Vui lòng tải lại trang.')
    assertPublishable(input)
    const imageIds = postImageIds(input)
    try {
      const removedImagePaths = await withTransaction(this.pool, async (client) => {
        const current = await client.query<PostRow>(`${postSelect} WHERE p.id = $1 FOR UPDATE OF p`, [id])
        const row = current.rows[0]
        if (!row) throw postNotFound()
        const before = mapPost(row)
        if (before.version !== input.version) {
          throw new HttpError(409, 'news_post_conflict', `Bài này vừa được ${before.updatedBy.name || before.updatedBy.email || 'người khác'} lưu lúc bạn đang sửa. Hãy sao chép phần mình viết, tải lại bài rồi sửa tiếp.`)
        }
        const publishedAt = publishedAtFor(input, before)
        const changes = diffPost(before, input, publishedAt)
        if (!changes.length) return []
        if (before.category.id !== input.categoryId) await assertCategoryExists(client, input.categoryId)
        await assertImagesExist(client, imageIds.filter((imageId) => !before.imageIds.includes(imageId)))
        if (before.slug !== input.slug) await assertSlugFree(client, input.slug, id)
        // A post that has been public keeps its old link working.
        const keepOldSlug = before.slug !== input.slug && before.status !== 'draft'
        const previousSlugs = [...new Set([...(keepOldSlug ? [before.slug] : []), ...before.previousSlugs])].filter((slug) => slug !== input.slug).slice(0, 50)
        await client.query(
          `UPDATE public.cwi_news_posts
          SET (${postWriteColumns}) = ($2, $3, $4, ${publishedAtSql('$4', '$5')}, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::uuid[]),
              previous_slugs = $29, version = version + 1, updated_by_admin_id = $30, updated_by_email = $31
          WHERE id = $1`,
          [id, ...postWriteValues(input, publishedAt, imageIds), previousSlugs, actor.user.id, actor.user.email],
        )
        const statusChange = before.status !== input.status ? { from: before.status, to: input.status } : null
        const slugChange = before.slug !== input.slug ? { from: before.slug, to: input.slug } : null
        await writeAdminAudit(client, actor, {
          action: 'news_post.update',
          metadata: { changes, slug: input.slug, slugChange, statusChange, title: input.title.vi },
          targetId: id,
          targetType: NEWS_POST_AUDIT_TARGET,
        })
        return removeUnusedImages(client, before.imageIds.filter((imageId) => !imageIds.includes(imageId)))
      })
      return { post: await this.getPost(id), removedImagePaths }
    } catch (error) {
      rethrowSlugConflict(error, input.slug)
    }
  }

  async deletePost(id: string, actor: AuditActor): Promise<{ removedImagePaths: string[] }> {
    const removedImagePaths = await withTransaction(this.pool, async (client) => {
      const current = await client.query<PostRow>(`${postSelect} WHERE p.id = $1 FOR UPDATE OF p`, [id])
      const row = current.rows[0]
      if (!row) throw postNotFound()
      await writeAdminAudit(client, actor, {
        action: 'news_post.delete',
        metadata: { slug: row.slug, status: row.status, title: row.title_vi },
        targetId: id,
        targetType: NEWS_POST_AUDIT_TARGET,
      })
      await client.query('DELETE FROM public.cwi_news_posts WHERE id = $1', [id])
      return removeUnusedImages(client, row.image_ids)
    })
    return { removedImagePaths }
  }

  postHistory(id: string): Promise<AuditEntry[]> {
    return listAdminAudit(this.pool, NEWS_POST_AUDIT_TARGET, id)
  }

  // ---- Pictures ----------------------------------------------------------------------

  async registerImage(image: { contentType: string; fileSize: number; sha256: string; storagePath: string }, actor: AuditActor): Promise<{ id: string; url: string }> {
    const created = await this.pool.query<{ id: string }>(
      `INSERT INTO public.cwi_news_images (storage_path, content_type, file_size, sha256, created_by_admin_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [image.storagePath, image.contentType, image.fileSize, image.sha256, actor.user.id],
    )
    const id = created.rows[0]!.id
    return { id, url: newsImageSrc(id) }
  }

  async findImage(id: string): Promise<NewsImage | null> {
    const result = await this.pool.query<{ content_type: string; id: string; storage_path: string }>(
      'SELECT id, storage_path, content_type FROM public.cwi_news_images WHERE id = $1',
      [id],
    )
    const row = result.rows[0]
    return row ? { contentType: row.content_type, id: row.id, storagePath: row.storage_path } : null
  }

  // Pictures uploaded but never saved into a post (the editor was closed), after 48 hours.
  async removeOrphanImages(limit = 50): Promise<string[]> {
    const removed = await this.pool.query<{ storage_path: string }>(
      `DELETE FROM public.cwi_news_images AS image
      WHERE image.id IN (
        SELECT orphan.id FROM public.cwi_news_images AS orphan
        WHERE orphan.created_at < now() - make_interval(hours => $1)
          AND NOT EXISTS (SELECT 1 FROM public.cwi_news_posts AS p WHERE p.image_ids @> ARRAY[orphan.id])
        ORDER BY orphan.created_at
        LIMIT $2
      )
      RETURNING image.storage_path`,
      [ORPHAN_IMAGE_HOURS, limit],
    )
    return removed.rows.map((row) => row.storage_path)
  }

  // ---- Public pages ------------------------------------------------------------------

  // /tin-tuc: pinned posts on top (or the newest one when nothing is pinned), then each
  // shown category with its 3 newest other posts.
  async publicHome(): Promise<{ categories: Array<{ category: { description: Bilingual; name: Bilingual; slug: string }; posts: NewsCard[]; total: number }>; featured: NewsCard[] }> {
    const pinned = await this.pool.query<CardRow>(`${cardSelect} WHERE ${PUBLIC_POST} AND p.is_pinned ORDER BY p.published_at DESC, p.id DESC LIMIT 3`)
    const featuredRows = pinned.rows.length ? pinned.rows : (await this.pool.query<CardRow>(`${cardSelect} WHERE ${PUBLIC_POST} ORDER BY p.published_at DESC, p.id DESC LIMIT 1`)).rows
    const featuredIds = featuredRows.map((row) => row.id)
    const [categories, blockRows] = await Promise.all([
      this.pool.query<{ description_en: string; description_vi: string; id: string; name_en: string; name_vi: string; slug: string; total: number }>(
        `SELECT c.id, c.slug, c.name_vi, c.name_en, c.description_vi, c.description_en,
          (SELECT count(*)::int FROM public.cwi_news_posts AS p WHERE p.category_id = c.id AND ${PUBLIC_POST}) AS total
        FROM public.cwi_news_categories AS c
        WHERE c.is_visible
        ORDER BY c.sort_order, c.name_vi, c.id`,
      ),
      this.pool.query<CardRow & { category_id: string }>(
        `SELECT * FROM (
          SELECT ranked.*, row_number() OVER (PARTITION BY ranked.category_id ORDER BY ranked.published_at DESC, ranked.id DESC) AS position
          FROM (${cardSelect.replace('SELECT', 'SELECT p.category_id,')} WHERE ${PUBLIC_POST} AND NOT (p.id = ANY($1::uuid[]))) AS ranked
        ) AS numbered
        WHERE numbered.position <= 3
        ORDER BY numbered.published_at DESC`,
        [featuredIds],
      ),
    ])
    return {
      categories: categories.rows
        .map((category) => ({
          category: { description: { en: category.description_en, vi: category.description_vi }, name: { en: category.name_en, vi: category.name_vi }, slug: category.slug },
          posts: blockRows.rows.filter((row) => row.category_id === category.id).map(mapCard),
          total: category.total,
        }))
        .filter((block) => block.posts.length > 0),
      featured: featuredRows.map(mapCard),
    }
  }

  async publicCategory(slug: string, offset: number, limit: number) {
    const category = await this.pool.query<{ description_en: string; description_vi: string; id: string; name_en: string; name_vi: string; slug: string }>(
      'SELECT id, slug, name_vi, name_en, description_vi, description_en FROM public.cwi_news_categories AS c WHERE c.slug = $1 AND c.is_visible',
      [slug],
    )
    const row = category.rows[0]
    if (!row) return null
    const [posts, total] = await Promise.all([
      this.pool.query<CardRow>(`${cardSelect} WHERE ${PUBLIC_POST} AND p.category_id = $1 ORDER BY p.published_at DESC, p.id DESC LIMIT $2 OFFSET $3`, [row.id, limit, offset]),
      this.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.cwi_news_posts AS p JOIN public.cwi_news_categories AS c ON c.id = p.category_id WHERE ${PUBLIC_POST} AND p.category_id = $1`, [row.id]),
    ])
    return {
      category: { description: { en: row.description_en, vi: row.description_vi }, name: { en: row.name_en, vi: row.name_vi }, slug: row.slug },
      posts: posts.rows.map(mapCard),
      total: total.rows[0]?.count ?? 0,
    }
  }

  // Tags are free text in each language; their link is the tag made into a slug.
  async publicTag(tagSlug: string, offset: number, limit: number) {
    const tagged = await this.pool.query<{ id: string; tags_en: string[]; tags_vi: string[] }>(
      `SELECT p.id, p.tags_vi, p.tags_en FROM public.cwi_news_posts AS p
      JOIN public.cwi_news_categories AS c ON c.id = p.category_id
      WHERE ${PUBLIC_POST} AND (cardinality(p.tags_vi) > 0 OR cardinality(p.tags_en) > 0)`,
    )
    const label: Bilingual = { en: '', vi: '' }
    const ids: string[] = []
    for (const row of tagged.rows) {
      const vi = row.tags_vi.find((tag) => slugify(tag, 60) === tagSlug)
      const en = row.tags_en.find((tag) => slugify(tag, 60) === tagSlug)
      if (!vi && !en) continue
      ids.push(row.id)
      if (vi && !label.vi) label.vi = vi
      if (en && !label.en) label.en = en
    }
    if (!ids.length) return null
    const posts = await this.pool.query<CardRow>(`${cardSelect} WHERE p.id = ANY($1::uuid[]) ORDER BY p.published_at DESC, p.id DESC LIMIT $2 OFFSET $3`, [ids, limit, offset])
    return {
      posts: posts.rows.map(mapCard),
      tag: { label: { en: label.en || label.vi, vi: label.vi || label.en }, slug: tagSlug },
      total: ids.length,
    }
  }

  // A public post by its link, or the post's current link when an old one was used.
  async publicPost(slug: string): Promise<{ post: NewsPost; related: NewsCard[] } | { redirectTo: string } | null> {
    const result = await this.pool.query<PostRow>(`${postSelect} WHERE p.slug = $1 AND ${PUBLIC_POST}`, [slug])
    const row = result.rows[0]
    if (!row) {
      const moved = await this.pool.query<{ slug: string }>(
        `SELECT p.slug FROM public.cwi_news_posts AS p JOIN public.cwi_news_categories AS c ON c.id = p.category_id
        WHERE $1 = ANY(p.previous_slugs) AND ${PUBLIC_POST}
        ORDER BY p.published_at DESC LIMIT 1`,
        [slug],
      )
      return moved.rows[0] ? { redirectTo: moved.rows[0].slug } : null
    }
    const post = mapPost(row)
    const sameCategory = await this.pool.query<CardRow>(
      `${cardSelect} WHERE ${PUBLIC_POST} AND p.id <> $1 AND p.category_id = $2 ORDER BY p.published_at DESC, p.id DESC LIMIT 3`,
      [post.id, post.category.id],
    )
    let related = sameCategory.rows
    if (related.length < 3) {
      const others = await this.pool.query<CardRow>(
        `${cardSelect} WHERE ${PUBLIC_POST} AND p.id <> $1 AND p.category_id <> $2 ORDER BY p.published_at DESC, p.id DESC LIMIT $3`,
        [post.id, post.category.id, 3 - related.length],
      )
      related = [...related, ...others.rows]
    }
    return { post, related: related.map(mapCard) }
  }

  async countView(slug: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE public.cwi_news_posts AS p SET view_count = p.view_count + 1
      FROM public.cwi_news_categories AS c
      WHERE c.id = p.category_id AND p.slug = $1 AND ${PUBLIC_POST}`,
      [slug],
    )
    return (result.rowCount ?? 0) > 0
  }

  // Everything public, for the sitemap.
  async publicSitemap(): Promise<{ categories: Array<{ slug: string; updatedAt: string }>; posts: Array<{ slug: string; updatedAt: string }> }> {
    const [posts, categories] = await Promise.all([
      this.pool.query<{ slug: string; updated_at: Date }>(
        `SELECT p.slug, greatest(p.updated_at, p.published_at) AS updated_at FROM public.cwi_news_posts AS p
        JOIN public.cwi_news_categories AS c ON c.id = p.category_id
        WHERE ${PUBLIC_POST} ORDER BY p.published_at DESC LIMIT 5000`,
      ),
      this.pool.query<{ slug: string; updated_at: Date }>(
        `SELECT c.slug, c.updated_at FROM public.cwi_news_categories AS c
        WHERE c.is_visible AND EXISTS (SELECT 1 FROM public.cwi_news_posts AS p WHERE p.category_id = c.id AND ${PUBLIC_POST})
        ORDER BY c.sort_order`,
      ),
    ])
    return {
      categories: categories.rows.map((row) => ({ slug: row.slug, updatedAt: row.updated_at.toISOString() })),
      posts: posts.rows.map((row) => ({ slug: row.slug, updatedAt: row.updated_at.toISOString() })),
    }
  }
}

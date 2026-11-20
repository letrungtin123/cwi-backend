import { z } from 'zod'
import { HttpError } from '../../http/errors.js'
import { uuidPattern } from '../../http/ids.js'
import { normalizeNewsDoc, type NewsDoc } from './newsContent.js'

export const NEWS_LANGUAGES = ['vi', 'en'] as const
export type NewsLanguage = (typeof NEWS_LANGUAGES)[number]
export type Bilingual<T = string> = { en: T; vi: T }

export const NEWS_POST_STATUSES = ['draft', 'published', 'hidden'] as const
export type NewsPostStatus = (typeof NEWS_POST_STATUSES)[number]

// "chuyen-muc" and "the" are the category and tag pages under /tin-tuc.
export const RESERVED_POST_SLUGS = new Set(['chuyen-muc', 'the'])
export const newsSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const NEWS_POST_SLUG_MAX = 120
export const NEWS_CATEGORY_SLUG_MAX = 80

const languageLabels: Record<NewsLanguage, string> = { en: 'tiếng Anh', vi: 'tiếng Việt' }

// "Năng lực lãnh đạo Q3/2026!" -> "nang-luc-lanh-dao-q3-2026". Used for post, category and
// tag links.
export function slugify(value: string, max = NEWS_POST_SLUG_MAX) {
  const slug = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= max) return slug
  const cut = slug.slice(0, max)
  const lastDash = cut.lastIndexOf('-')
  return (lastDash > max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, '')
}

export function isValidPostSlug(value: string) {
  return value.length <= NEWS_POST_SLUG_MAX && newsSlugPattern.test(value) && !RESERVED_POST_SLUGS.has(value)
}

const singleLine = (min: number, max: number) => z.string().transform((value) => value.replace(/[\r\n\t]+/g, ' ').trim()).pipe(z.string().min(min).max(max))
const paragraph = (max: number) => z.string().transform((value) => value.replace(/\r\n/g, '\n').trim()).pipe(z.string().max(max))
const bilingual = <T extends z.ZodTypeAny>(schema: T) => z.object({ en: schema, vi: schema }).strict()

const tagList = z.array(singleLine(1, 40)).max(10).transform((tags) => {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const key = tag.toLocaleLowerCase('vi')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})

const uuid = z.string().regex(uuidPattern)

const categorySchema = z.object({
  description: bilingual(paragraph(300)),
  isVisible: z.boolean(),
  name: bilingual(singleLine(1, 80)),
  slug: z.string().trim().max(NEWS_CATEGORY_SLUG_MAX).regex(newsSlugPattern).optional(),
  sortOrder: z.number().int().min(0).max(999),
}).strict()

export type NewsCategoryInput = {
  description: Bilingual
  isVisible: boolean
  name: Bilingual
  slug: string
  sortOrder: number
}

function invalidInput(error: z.ZodError, code: string, message: string) {
  return new HttpError(400, code, message, {
    issues: error.issues.map((issue) => ({ code: issue.code, message: issue.message, path: issue.path })),
  })
}

export function normalizeNewsCategoryInput(value: unknown): NewsCategoryInput {
  const parsed = categorySchema.safeParse(value)
  if (!parsed.success) throw invalidInput(parsed.error, 'invalid_news_category', 'Thông tin chuyên mục không hợp lệ.')
  const slug = parsed.data.slug || slugify(parsed.data.name.vi, NEWS_CATEGORY_SLUG_MAX)
  if (!slug) throw new HttpError(422, 'invalid_news_category_slug', 'Không tạo được đường dẫn từ tên chuyên mục. Vui lòng nhập đường dẫn.')
  return { ...parsed.data, slug }
}

const postSchema = z.object({
  author: bilingual(singleLine(0, 80)),
  categoryId: uuid,
  content: bilingual(z.unknown()),
  coverAlt: bilingual(singleLine(0, 200)),
  coverImageId: uuid.nullable(),
  excerpt: bilingual(paragraph(300)),
  isPinned: z.boolean(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  seoDescription: bilingual(paragraph(200)),
  seoTitle: bilingual(singleLine(0, 120)),
  slug: z.string().trim().max(NEWS_POST_SLUG_MAX),
  source: z.object({
    name: singleLine(0, 120),
    url: z.string().trim().max(500),
  }).strict(),
  status: z.enum(NEWS_POST_STATUSES),
  tags: bilingual(tagList),
  title: bilingual(singleLine(0, 200)),
  version: z.number().int().min(1).optional(),
}).strict()

export type NewsPostInput = {
  author: Bilingual
  categoryId: string
  content: Bilingual<NewsDoc>
  coverAlt: Bilingual
  coverImageId: string | null
  excerpt: Bilingual
  isPinned: boolean
  publishedAt: Date | null
  seoDescription: Bilingual
  seoTitle: Bilingual
  slug: string
  source: { name: string; url: string }
  status: NewsPostStatus
  tags: Bilingual<string[]>
  title: Bilingual
  version: number | null
}

export function normalizeNewsPostInput(value: unknown): NewsPostInput {
  const parsed = postSchema.safeParse(value)
  if (!parsed.success) throw invalidInput(parsed.error, 'invalid_news_post', 'Thông tin bài viết không hợp lệ.')
  const data = parsed.data
  if (!data.title.vi) throw new HttpError(422, 'news_post_title_required', 'Vui lòng nhập tiêu đề tiếng Việt.')
  const slug = data.slug || slugify(data.title.vi)
  if (!isValidPostSlug(slug)) {
    throw new HttpError(422, 'invalid_news_post_slug', RESERVED_POST_SLUGS.has(slug)
      ? `Đường dẫn “${slug}” đã dành cho trang chuyên mục/thẻ. Vui lòng chọn đường dẫn khác.`
      : 'Đường dẫn chỉ gồm chữ thường không dấu, số và dấu gạch ngang (ví dụ: nang-luc-lanh-dao-q3).')
  }
  const sourceUrl = data.source.url
  if (sourceUrl) {
    let ok = false
    try {
      const url = new URL(sourceUrl)
      ok = url.protocol === 'https:' || url.protocol === 'http:'
    } catch {
      ok = false
    }
    if (!ok) throw new HttpError(422, 'invalid_news_source_url', 'Link bài gốc phải bắt đầu bằng https://')
  }
  return {
    author: data.author,
    categoryId: data.categoryId,
    content: { en: normalizeNewsDoc(data.content.en, languageLabels.en), vi: normalizeNewsDoc(data.content.vi, languageLabels.vi) },
    coverAlt: data.coverAlt,
    coverImageId: data.coverImageId,
    excerpt: data.excerpt,
    isPinned: data.isPinned,
    publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
    seoDescription: data.seoDescription,
    seoTitle: data.seoTitle,
    slug,
    source: { name: data.source.name, url: sourceUrl },
    status: data.status,
    tags: data.tags,
    title: data.title,
    version: data.version ?? null,
  }
}

export function newsLanguageLabel(language: NewsLanguage) {
  return languageLabels[language]
}

import { describe, expect, it } from 'vitest'
import { newsDocHasContent, newsDocImageIds, newsReadingMinutes, normalizeLinkHref, normalizeNewsDoc, youtubeVideoId } from '../src/modules/news/newsContent.js'
import { missingForPublish } from '../src/modules/news/newsRepository.js'
import { isValidPostSlug, normalizeNewsPostInput, slugify } from '../src/modules/news/newsValidation.js'

const imageId = '3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f'

function errorOf(run: () => unknown) {
  try {
    run()
  } catch (error) {
    const { code, message, statusCode } = error as { code?: string; message?: string; statusCode?: number }
    return { code, message, statusCode }
  }
  return null
}

describe('news content (rich text documents)', () => {
  it('keeps only the allowed parts and attributes', () => {
    const doc = normalizeNewsDoc({
      content: [
        { type: 'paragraph' },
        { attrs: { level: 2, textAlign: 'left' }, content: [{ text: 'Tiêu đề', type: 'text' }], type: 'heading' },
        {
          content: [
            { marks: [{ type: 'bold' }, { attrs: { class: 'x', href: 'https://cafebiz.vn/a', rel: 'noopener', target: '_blank' }, type: 'link' }], text: 'Đọc bài gốc', type: 'text' },
            { type: 'hardBreak' },
          ],
          type: 'paragraph',
        },
        { attrs: { alt: 'Toàn cảnh', height: 300, src: `/api/v1/public/news/images/${imageId}`, title: 'Chú thích', width: 400 }, type: 'image' },
        { attrs: { src: 'https://youtu.be/dQw4w9WgXcQ', start: 30 }, type: 'youtube' },
        { attrs: { start: 3, type: null }, content: [{ content: [{ content: [{ text: 'Một', type: 'text' }], type: 'paragraph' }], type: 'listItem' }], type: 'orderedList' },
        { type: 'paragraph' },
      ],
      type: 'doc',
    }, 'tiếng Việt')

    expect(doc).toEqual({
      content: [
        { attrs: { level: 2 }, content: [{ text: 'Tiêu đề', type: 'text' }], type: 'heading' },
        {
          content: [
            { marks: [{ type: 'bold' }, { attrs: { href: 'https://cafebiz.vn/a' }, type: 'link' }], text: 'Đọc bài gốc', type: 'text' },
            { type: 'hardBreak' },
          ],
          type: 'paragraph',
        },
        { attrs: { alt: 'Toàn cảnh', src: `/api/v1/public/news/images/${imageId}`, title: 'Chú thích' }, type: 'image' },
        { attrs: { src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', start: 30 }, type: 'youtube' },
        { attrs: { start: 3 }, content: [{ content: [{ content: [{ text: 'Một', type: 'text' }], type: 'paragraph' }], type: 'listItem' }], type: 'orderedList' },
      ],
      type: 'doc',
    })
    expect(newsDocImageIds(doc)).toEqual([imageId])
    expect(newsDocHasContent(doc)).toBe(true)
  })

  it('refuses scripts, other sites\' pictures and unknown parts with a 422', () => {
    const link = errorOf(() => normalizeNewsDoc({ content: [{ content: [{ marks: [{ attrs: { href: 'javascript:alert(1)' }, type: 'link' }], text: 'x', type: 'text' }], type: 'paragraph' }], type: 'doc' }, 'tiếng Anh'))
    expect(link).toMatchObject({ code: 'invalid_news_content', statusCode: 422 })
    expect(link?.message).toContain('Nội dung (tiếng Anh)')
    expect(errorOf(() => normalizeNewsDoc({ content: [{ attrs: { src: 'https://evil.example/x.png' }, type: 'image' }], type: 'doc' }, 'vi'))).toMatchObject({ statusCode: 422 })
    expect(errorOf(() => normalizeNewsDoc({ content: [{ content: [{ text: '<b>', type: 'text' }], type: 'codeBlock' }], type: 'doc' }, 'vi'))).toMatchObject({ statusCode: 422 })
    expect(errorOf(() => normalizeNewsDoc({ content: [{ attrs: { src: 'https://vimeo.com/123' }, type: 'youtube' }], type: 'doc' }, 'vi'))).toMatchObject({ statusCode: 422 })
    expect(errorOf(() => normalizeNewsDoc('<p>html</p>', 'vi'))).toMatchObject({ statusCode: 422 })
  })

  it('accepts site, web, e-mail and phone links only', () => {
    expect(normalizeLinkHref('/survey')).toBe('/survey')
    expect(normalizeLinkHref('https://ceo-workforce-index.com/bao-cao-quy')).toBe('https://ceo-workforce-index.com/bao-cao-quy')
    expect(normalizeLinkHref('mailto:info@example.com')).toBe('mailto:info@example.com')
    expect(normalizeLinkHref('tel:+84 28 1234 5678')).toBe('tel:+842812345678')
    expect(normalizeLinkHref('//evil.example')).toBeNull()
    expect(normalizeLinkHref('data:text/html,x')).toBeNull()
    expect(normalizeLinkHref('JavaScript:alert(1)')).toBeNull()
  })

  it('reads YouTube ids from the usual link shapes', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('counts reading time and treats an empty editor as no content', () => {
    const words = Array.from({ length: 660 }, () => 'chữ').join(' ')
    expect(newsReadingMinutes(normalizeNewsDoc({ content: [{ content: [{ text: words, type: 'text' }], type: 'paragraph' }], type: 'doc' }, 'vi'))).toBe(3)
    const empty = normalizeNewsDoc({ content: [{ type: 'paragraph' }], type: 'doc' }, 'vi')
    expect(empty.content).toEqual([])
    expect(newsDocHasContent(empty)).toBe(false)
  })
})

describe('news links and post input', () => {
  it('makes Vietnamese titles into links', () => {
    expect(slugify('Năng lực lãnh đạo cho tăng trưởng – Quý 3/2026!')).toBe('nang-luc-lanh-dao-cho-tang-truong-quy-3-2026')
    expect(slugify('Đội ngũ điều hành')).toBe('doi-ngu-dieu-hanh')
    expect(slugify('a'.repeat(50) + ' ' + 'b'.repeat(100)).length).toBeLessThanOrEqual(120)
    expect(isValidPostSlug('chuyen-muc')).toBe(false)
    expect(isValidPostSlug('the')).toBe(false)
    expect(isValidPostSlug('Bad Slug')).toBe(false)
  })

  const base = {
    author: { en: '', vi: '' },
    categoryId: '9b6c2f1a-3d4e-4f5a-8b6c-7d8e9f0a1b2c',
    content: { en: null, vi: { content: [{ content: [{ text: 'Xin chào', type: 'text' }], type: 'paragraph' }], type: 'doc' } },
    coverAlt: { en: '', vi: '' },
    coverImageId: null,
    excerpt: { en: '', vi: 'Sapo' },
    isPinned: false,
    publishedAt: null,
    seoDescription: { en: '', vi: '' },
    seoTitle: { en: '', vi: '' },
    slug: '',
    source: { name: '', url: '' },
    status: 'draft',
    tags: { en: [], vi: ['Lãnh đạo', 'lãnh đạo', ' AI '] },
    title: { en: '', vi: '  Bài đầu tiên  ' },
  }

  it('fills the link from the Vietnamese title and removes repeated tags', () => {
    const input = normalizeNewsPostInput(base)
    expect(input.slug).toBe('bai-dau-tien')
    expect(input.title.vi).toBe('Bài đầu tiên')
    expect(input.tags.vi).toEqual(['Lãnh đạo', 'AI'])
    expect(input.content.en).toEqual({ content: [], type: 'doc' })
  })

  it('lists what is missing before a post can be published', () => {
    expect(missingForPublish(normalizeNewsPostInput(base))).toEqual([
      'Tiêu đề (tiếng Anh)', 'Sapo (tiếng Anh)', 'Nội dung (tiếng Anh)', 'Ảnh đại diện',
    ])
  })

  it('refuses a reserved link and a source that is not a web address', () => {
    expect(errorOf(() => normalizeNewsPostInput({ ...base, slug: 'chuyen-muc' }))).toMatchObject({ code: 'invalid_news_post_slug', statusCode: 422 })
    expect(errorOf(() => normalizeNewsPostInput({ ...base, source: { name: 'X', url: 'javascript:alert(1)' } }))).toMatchObject({ code: 'invalid_news_source_url', statusCode: 422 })
    expect(errorOf(() => normalizeNewsPostInput({ ...base, extra: true }))).toMatchObject({ code: 'invalid_news_post', statusCode: 400 })
  })
})

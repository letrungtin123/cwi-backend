import { HttpError } from '../../http/errors.js'

// A post's body is a rich-text document made in the dashboard editor (TipTap). Before it
// is stored it is rebuilt here from the parts we allow, keeping only known attributes, so
// the public page can render it as elements without ever inserting raw HTML.
//
// Blocks: paragraph, heading (h2, h3), bulletList / orderedList / listItem, blockquote,
// horizontalRule, image (only pictures uploaded to the news store), youtube.
// Inline: text with bold / italic / underline / strike / link marks, hardBreak.

export const NEWS_IMAGE_PATH_PREFIX = '/api/v1/public/news/images/'

const MAX_NODES = 5000
const MAX_DEPTH = 12
const MAX_TEXT_CHARACTERS = 60_000
const MAX_TEXT_NODE_CHARACTERS = 10_000
const WORDS_PER_MINUTE = 220

const imageSrcPattern = /^\/api\/v1\/public\/news\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/

export type NewsMark =
  | { type: 'bold' | 'italic' | 'strike' | 'underline' }
  | { attrs: { href: string }; type: 'link' }

export type NewsInline =
  | { marks?: NewsMark[]; text: string; type: 'text' }
  | { type: 'hardBreak' }

export type NewsBlock =
  | { content?: NewsInline[]; type: 'paragraph' }
  | { attrs: { level: 2 | 3 }; content?: NewsInline[]; type: 'heading' }
  | { content: NewsListItem[]; type: 'bulletList' }
  | { attrs: { start: number }; content: NewsListItem[]; type: 'orderedList' }
  | { content: NewsBlock[]; type: 'blockquote' }
  | { type: 'horizontalRule' }
  | { attrs: { alt: string; src: string; title: string }; type: 'image' }
  | { attrs: { src: string; start: number }; type: 'youtube' }

export type NewsListItem = { content: NewsBlock[]; type: 'listItem' }

export type NewsDoc = { content: NewsBlock[]; type: 'doc' }

export const EMPTY_NEWS_DOC: NewsDoc = { content: [], type: 'doc' }

class ContentError extends Error {}

type Walk = { nodes: number; textCharacters: number }

function fail(message: string): never {
  throw new ContentError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function attrsOf(node: Record<string, unknown>) {
  return isRecord(node.attrs) ? node.attrs : {}
}

function childrenOf(node: Record<string, unknown>) {
  if (node.content === undefined || node.content === null) return []
  if (!Array.isArray(node.content)) fail('Nội dung bài viết không đúng định dạng.')
  return node.content as unknown[]
}

function count(walk: Walk) {
  walk.nodes += 1
  if (walk.nodes > MAX_NODES) fail('Nội dung bài viết quá dài.')
}

function shortText(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : ''
}

// Links may go to a web page, an e-mail address, a phone number or a page of this site.
export function normalizeLinkHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = value.trim()
  if (/^tel:\+?[0-9 ().-]{3,30}$/i.test(href)) return `tel:${href.slice(4).replace(/[^0-9+]/g, '')}`
  if (!href || href.length > 1000 || /[\s<>"]/.test(href)) return null
  if (href.startsWith('/')) return href.startsWith('//') || href.includes('\\') ? null : href
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(href)) return href
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname) return null
    return url.toString()
  } catch {
    return null
  }
}

// youtube.com/watch?v=, youtu.be/, /embed/, /shorts/ and youtube-nocookie.com links.
export function youtubeVideoId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const match = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)
      id = match?.[1] ?? null
    }
  }
  return id && youtubeIdPattern.test(id) ? id : null
}

export function youtubeEmbedSrc(id: string) {
  return `https://www.youtube.com/embed/${id}`
}

function normalizeMarks(value: unknown): NewsMark[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) fail('Định dạng chữ trong bài viết không hợp lệ.')
  const marks: NewsMark[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.type !== 'string') fail('Định dạng chữ trong bài viết không hợp lệ.')
    if (seen.has(raw.type)) continue
    seen.add(raw.type)
    if (raw.type === 'bold' || raw.type === 'italic' || raw.type === 'strike' || raw.type === 'underline') {
      marks.push({ type: raw.type })
    } else if (raw.type === 'link') {
      const href = normalizeLinkHref(attrsOf(raw).href)
      if (!href) fail(`Liên kết “${shortText(attrsOf(raw).href, 80)}” không hợp lệ. Liên kết phải bắt đầu bằng https://, mailto:, tel: hoặc /.`)
      marks.push({ attrs: { href }, type: 'link' })
    } else {
      fail(`Bài viết có định dạng chữ không được hỗ trợ (${shortText(raw.type, 40)}).`)
    }
  }
  return marks.length ? marks : undefined
}

function normalizeInline(nodes: unknown[], walk: Walk, depth: number): NewsInline[] | undefined {
  const result: NewsInline[] = []
  for (const raw of nodes) {
    if (!isRecord(raw)) fail('Nội dung bài viết không đúng định dạng.')
    count(walk)
    if (raw.type === 'text') {
      if (typeof raw.text !== 'string') fail('Nội dung bài viết không đúng định dạng.')
      // Control characters other than tab / new line never belong in an article.
      // eslint-disable-next-line no-control-regex
      const text = raw.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      if (!text) continue
      if (text.length > MAX_TEXT_NODE_CHARACTERS) fail('Một đoạn văn trong bài quá dài.')
      walk.textCharacters += text.length
      if (walk.textCharacters > MAX_TEXT_CHARACTERS) fail('Nội dung bài viết quá dài.')
      const marks = normalizeMarks(raw.marks)
      result.push(marks ? { marks, text, type: 'text' } : { text, type: 'text' })
    } else if (raw.type === 'hardBreak') {
      result.push({ type: 'hardBreak' })
    } else {
      fail(`Bài viết có thành phần không được hỗ trợ (${shortText(raw.type, 40)}).`)
    }
  }
  if (depth > MAX_DEPTH) fail('Nội dung bài viết lồng nhau quá sâu.')
  return result.length ? result : undefined
}

function normalizeListItems(nodes: unknown[], walk: Walk, depth: number): NewsListItem[] {
  const items: NewsListItem[] = []
  for (const raw of nodes) {
    if (!isRecord(raw) || raw.type !== 'listItem') fail('Danh sách trong bài viết không đúng định dạng.')
    count(walk)
    const content = normalizeBlocks(childrenOf(raw), walk, depth + 1)
    items.push({ content: content.length ? content : [{ type: 'paragraph' }], type: 'listItem' })
  }
  return items
}

function normalizeBlocks(nodes: unknown[], walk: Walk, depth: number): NewsBlock[] {
  if (depth > MAX_DEPTH) fail('Nội dung bài viết lồng nhau quá sâu.')
  const blocks: NewsBlock[] = []
  for (const raw of nodes) {
    if (!isRecord(raw) || typeof raw.type !== 'string') fail('Nội dung bài viết không đúng định dạng.')
    count(walk)
    const attrs = attrsOf(raw)
    switch (raw.type) {
      case 'paragraph': {
        const content = normalizeInline(childrenOf(raw), walk, depth + 1)
        blocks.push(content ? { content, type: 'paragraph' } : { type: 'paragraph' })
        break
      }
      case 'heading': {
        const level = attrs.level === 3 || attrs.level === 4 ? 3 : 2
        const content = normalizeInline(childrenOf(raw), walk, depth + 1)
        blocks.push(content ? { attrs: { level }, content, type: 'heading' } : { attrs: { level }, type: 'heading' })
        break
      }
      case 'bulletList': {
        const content = normalizeListItems(childrenOf(raw), walk, depth)
        if (content.length) blocks.push({ content, type: 'bulletList' })
        break
      }
      case 'orderedList': {
        const content = normalizeListItems(childrenOf(raw), walk, depth)
        const start = typeof attrs.start === 'number' && Number.isInteger(attrs.start) && attrs.start >= 1 && attrs.start <= 10_000 ? attrs.start : 1
        if (content.length) blocks.push({ attrs: { start }, content, type: 'orderedList' })
        break
      }
      case 'blockquote': {
        const content = normalizeBlocks(childrenOf(raw), walk, depth + 1)
        if (content.length) blocks.push({ content, type: 'blockquote' })
        break
      }
      case 'horizontalRule':
        blocks.push({ type: 'horizontalRule' })
        break
      case 'image': {
        const src = typeof attrs.src === 'string' ? attrs.src.trim() : ''
        if (!imageSrcPattern.test(src)) fail('Bài viết có ảnh không nằm trong kho ảnh Tin tức. Vui lòng dùng nút “Ảnh” để tải ảnh lên.')
        blocks.push({ attrs: { alt: shortText(attrs.alt, 200), src, title: shortText(attrs.title, 300) }, type: 'image' })
        break
      }
      case 'youtube': {
        const id = youtubeVideoId(attrs.src)
        if (!id) fail('Bài viết có video không phải YouTube hoặc link video không hợp lệ.')
        const start = typeof attrs.start === 'number' && Number.isInteger(attrs.start) && attrs.start > 0 && attrs.start < 86_400 ? attrs.start : 0
        blocks.push({ attrs: { src: youtubeEmbedSrc(id), start }, type: 'youtube' })
        break
      }
      default:
        fail(`Bài viết có thành phần không được hỗ trợ (${shortText(raw.type, 40)}).`)
    }
  }
  return blocks
}

// Empty paragraphs at the start and end (the editor always keeps one) carry nothing.
function trimEmptyEdges(blocks: NewsBlock[]) {
  const isEmpty = (block: NewsBlock | undefined) => block?.type === 'paragraph' && !block.content
  let start = 0
  let end = blocks.length
  while (start < end && isEmpty(blocks[start])) start += 1
  while (end > start && isEmpty(blocks[end - 1])) end -= 1
  return blocks.slice(start, end)
}

// Throws a 422 naming what is wrong (in the language of the dashboard).
export function normalizeNewsDoc(value: unknown, languageLabel: string): NewsDoc {
  try {
    if (value === undefined || value === null) return EMPTY_NEWS_DOC
    if (!isRecord(value) || value.type !== 'doc') fail('Nội dung bài viết không đúng định dạng.')
    const walk: Walk = { nodes: 0, textCharacters: 0 }
    return { content: trimEmptyEdges(normalizeBlocks(childrenOf(value), walk, 0)), type: 'doc' }
  } catch (error) {
    if (error instanceof ContentError) throw new HttpError(422, 'invalid_news_content', `Nội dung (${languageLabel}): ${error.message}`)
    throw error
  }
}

function visit(blocks: readonly NewsBlock[], onBlock: (block: NewsBlock) => void) {
  for (const block of blocks) {
    onBlock(block)
    if (block.type === 'blockquote') visit(block.content, onBlock)
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      for (const item of block.content) visit(item.content, onBlock)
    }
  }
}

export function newsDocImageIds(doc: NewsDoc): string[] {
  const ids = new Set<string>()
  visit(doc.content, (block) => {
    if (block.type === 'image') {
      const id = imageSrcPattern.exec(block.attrs.src)?.[1]
      if (id) ids.add(id)
    }
  })
  return [...ids]
}

export function newsDocPlainText(doc: NewsDoc): string {
  const parts: string[] = []
  visit(doc.content, (block) => {
    if ((block.type === 'paragraph' || block.type === 'heading') && block.content) {
      parts.push(block.content.map((inline) => (inline.type === 'text' ? inline.text : ' ')).join(''))
    }
  })
  return parts.join('\n').replace(/[ \t]+/g, ' ').trim()
}

// Something a reader would see: text, a picture or a video.
export function newsDocHasContent(doc: NewsDoc) {
  if (newsDocPlainText(doc)) return true
  let media = false
  visit(doc.content, (block) => {
    if (block.type === 'image' || block.type === 'youtube') media = true
  })
  return media
}

export function newsReadingMinutes(doc: NewsDoc) {
  const words = newsDocPlainText(doc).split(/\s+/).filter(Boolean).length
  if (!words) return 0
  return Math.min(999, Math.max(1, Math.round(words / WORDS_PER_MINUTE)))
}

export function newsImageSrc(id: string) {
  return `${NEWS_IMAGE_PATH_PREFIX}${id}`
}

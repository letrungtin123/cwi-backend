import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable, pipeline } from 'node:stream'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])

const landingRoot = path.resolve(args.get('--landing-root') ?? 'cwi-fe-landing-page/dist')
const dashboardRoot = path.resolve(args.get('--dashboard-root') ?? 'cwi-fe-dashboard/dist')
const port = Number(args.get('--port') ?? 8080)
const host = args.get('--host') ?? '0.0.0.0'
const apiBaseUrl = (args.get('--api') ?? 'http://127.0.0.1:8088').replace(/\/+$/, '')

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
])

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const fetchRecomputedHeaders = new Set(['content-encoding', 'content-length', 'content-md5'])

// Security headers for the landing page and dashboard files (the API sets its own via helmet).
// frame-ancestors / X-Frame-Options stop other sites from framing the forms that collect personal
// data. The CSP only restricts framing, plugins and <base>, so scripts, styles, fonts and the PDF
// viewer keep working as before.
const staticSecurityHeaders = {
  'content-security-policy': "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'SAMEORIGIN',
}

// Stream a file; if reading fails half-way (e.g. a deploy replaced it) end this response instead
// of crashing the router with an unhandled stream error.
function sendFile(res, filePath, range) {
  pipeline(createReadStream(filePath, range), res, (error) => {
    if (error && !res.destroyed) res.destroy(error)
  })
}

function sendError(res, statusCode, message) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(message)
}

function resolveStaticPath(root, strippedPath) {
  const normalized = path.normalize(strippedPath || '/').replace(/^([/\\])+/, '')
  const requested = path.resolve(root, normalized)
  const rootWithSep = `${root}${path.sep}`
  if (requested !== root && !requested.startsWith(rootWithSep)) return null
  return requested
}

function decodeStaticPath(value) {
  try {
    const decoded = decodeURIComponent(value)
    return decoded.includes('\0') ? null : decoded
  } catch {
    return null
  }
}

function parseByteRange(header, fileSize) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return 'invalid'
  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid'
    return { end: fileSize - 1, start: Math.max(0, fileSize - suffixLength) }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : fileSize - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileSize) return 'invalid'
  return { end: Math.min(end, fileSize - 1), start }
}

async function proxyApi(req, res, url) {
  // Only the path and query come from the client; scheme, host and port are fixed.
  const target = new URL(apiBaseUrl)
  target.pathname = url.pathname
  target.search = url.search
  const headers = new Headers(req.headers)
  headers.set('host', target.host)
  headers.set('accept-encoding', 'identity')
  headers.delete('connection')
  headers.delete('content-length')

  const init = { headers, method: req.method }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req
    init.duplex = 'half'
  }

  const upstream = await fetch(target, init)
  const setCookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : []
  res.statusCode = upstream.status
  upstream.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key) && !fetchRecomputedHeaders.has(key) && key !== 'set-cookie') {
      res.setHeader(key, value)
    }
  })
  if (setCookies.length) res.setHeader('set-cookie', setCookies)
  if (!upstream.body) {
    res.end()
    return
  }
  await new Promise((resolve, reject) => {
    Readable.fromWeb(upstream.body).pipe(res).on('finish', resolve).on('error', reject)
  })
}

async function serveApp(req, res, root, strippedPath) {
  const decodedPath = decodeStaticPath(strippedPath)
  if (decodedPath === null) return sendError(res, 400, 'Invalid URL path')

  const requested = resolveStaticPath(root, decodedPath)
  if (!requested) return sendError(res, 403, 'Forbidden')

  let filePath = requested
  let fileStat = null
  try {
    fileStat = await stat(filePath)
    if (fileStat.isDirectory()) filePath = path.join(filePath, 'index.html')
    fileStat = await stat(filePath)
  } catch {
    // A missing hashed asset (an old tab after a deploy) must be a 404, not index.html served as
    // JavaScript/CSS with status 200.
    if (decodedPath.startsWith('/assets/')) return sendError(res, 404, 'Not Found')
    filePath = path.join(root, 'index.html')
    fileStat = await stat(filePath)
  }

  const ext = path.extname(filePath).toLowerCase()
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`)
  const headers = {
    ...staticSecurityHeaders,
    'accept-ranges': 'bytes',
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'content-type': mimeTypes.get(ext) ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  }
  const byteRange = parseByteRange(req.headers.range, fileStat.size)
  if (byteRange === 'invalid') {
    res.writeHead(416, { ...headers, 'content-range': `bytes */${fileStat.size}` })
    res.end()
    return
  }

  if (byteRange) {
    const contentLength = byteRange.end - byteRange.start + 1
    res.writeHead(206, {
      ...headers,
      'content-length': String(contentLength),
      'content-range': `bytes ${byteRange.start}-${byteRange.end}/${fileStat.size}`,
    })
    if (req.method !== 'HEAD') sendFile(res, filePath, byteRange)
    else res.end()
    return
  }

  res.writeHead(200, { ...headers, 'content-length': String(fileStat.size) })
  if (req.method !== 'HEAD') sendFile(res, filePath)
  else res.end()
}

// ---- News pages (/tin-tuc) ----------------------------------------------------------
// Link previews (Facebook, Zalo, LinkedIn) and search engines read the HTML without running
// the page's scripts, so the server writes each news page's own title, description and
// picture into <head>. An old link of a post answers 301 to its current link, keeping the
// query (utm_* of running ads). If the API does not answer quickly, the plain page is served.

const NEWS_PATH = /^\/tin-tuc(?:\/|$)/
const NEWS_META_TIMEOUT_MS = 1500
const FALLBACK_ORIGIN = 'https://ceo-workforce-index.com'
let landingIndexCache = null

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

// The site's own address as the visitor used it, for absolute links in previews.
function publicOrigin(req) {
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim()
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(forwardedHost)) return FALLBACK_ORIGIN
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(forwardedHost)
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : local ? 'http' : 'https'
  return `${proto}://${forwardedHost}`
}

async function landingIndexHtml() {
  const filePath = path.join(landingRoot, 'index.html')
  const fileStat = await stat(filePath)
  if (!landingIndexCache || landingIndexCache.mtimeMs !== fileStat.mtimeMs) {
    landingIndexCache = { html: await readFile(filePath, 'utf8'), mtimeMs: fileStat.mtimeMs }
  }
  return landingIndexCache.html
}

async function fetchNewsMeta(url) {
  const target = new URL('/api/v1/public/news/meta', apiBaseUrl)
  target.searchParams.set('path', url.pathname)
  target.searchParams.set('lang', url.searchParams.get('lang') === 'en' ? 'en' : 'vi')
  try {
    const response = await fetch(target, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(NEWS_META_TIMEOUT_MS) })
    if (!response.ok) return null
    const payload = await response.json()
    return payload?.data ?? null
  } catch {
    return null
  }
}

function metaPattern(attribute, name) {
  const escaped = name.replace(/[.:]/g, '\\$&')
  return new RegExp(`<meta\\s+${attribute}="${escaped}"\\s+content="[^"]*"\\s*/?>`)
}

function replaceTag(html, pattern, tag) {
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', `  ${tag}\n  </head>`)
}

function newsHead(html, meta, origin, language) {
  const canonical = `${origin}${meta.canonicalPath}${language === 'en' ? '?lang=en' : ''}`
  const image = meta.image ? `${origin}${meta.image}` : `${origin}/og-image.jpg`
  const title = escapeHtml(meta.title)
  const description = escapeHtml(meta.description)
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
  out = replaceTag(out, metaPattern('name', 'description'), `<meta name="description" content="${description}" />`)
  out = replaceTag(out, metaPattern('property', 'og:type'), `<meta property="og:type" content="${meta.type === 'article' ? 'article' : 'website'}" />`)
  out = replaceTag(out, metaPattern('property', 'og:locale'), `<meta property="og:locale" content="${language === 'en' ? 'en_US' : 'vi_VN'}" />`)
  out = replaceTag(out, metaPattern('property', 'og:title'), `<meta property="og:title" content="${title}" />`)
  out = replaceTag(out, metaPattern('property', 'og:description'), `<meta property="og:description" content="${description}" />`)
  out = replaceTag(out, metaPattern('property', 'og:image'), `<meta property="og:image" content="${escapeHtml(image)}" />`)
  out = replaceTag(out, metaPattern('property', 'og:image:alt'), `<meta property="og:image:alt" content="${escapeHtml(meta.imageAlt || meta.title)}" />`)
  if (meta.image) {
    // A post's picture has its own size; the fixed 1200x630 belongs to the site's default picture.
    out = out.replace(metaPattern('property', 'og:image:width'), '').replace(metaPattern('property', 'og:image:height'), '')
  }
  out = replaceTag(out, metaPattern('property', 'og:url'), `<meta property="og:url" content="${escapeHtml(canonical)}" />`)
  out = replaceTag(out, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
  if (meta.type === 'article' && meta.publishedAt) {
    out = replaceTag(out, metaPattern('property', 'article:published_time'), `<meta property="article:published_time" content="${escapeHtml(meta.publishedAt)}" />`)
  }
  if (language === 'en') out = out.replace('<html lang="vi">', '<html lang="en">')
  return out
}

async function serveNewsPage(req, res, url) {
  const meta = await fetchNewsMeta(url)
  if (meta?.redirect && /^\/tin-tuc\/[a-z0-9-]+$/.test(meta.redirect)) {
    res.writeHead(301, { ...staticSecurityHeaders, 'cache-control': 'no-cache', location: `${meta.redirect}${url.search}` })
    res.end()
    return
  }
  if (!meta?.title) {
    await serveApp(req, res, landingRoot, url.pathname)
    return
  }
  const language = url.searchParams.get('lang') === 'en' ? 'en' : 'vi'
  const body = Buffer.from(newsHead(await landingIndexHtml(), meta, publicOrigin(req), language), 'utf8')
  res.writeHead(meta.status === 404 ? 404 : 200, {
    ...staticSecurityHeaders,
    'cache-control': 'no-cache',
    'content-length': String(body.length),
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}

// /sitemap.xml: the landing pages and every public news post and category, for search engines.
async function serveSitemap(req, res) {
  const origin = publicOrigin(req)
  let news = { categories: [], posts: [] }
  try {
    const response = await fetch(new URL('/api/v1/public/news/sitemap', apiBaseUrl), { signal: AbortSignal.timeout(3000) })
    if (response.ok) news = (await response.json())?.data ?? news
  } catch {
    // The landing pages are still listed.
  }
  const entry = (pathname, lastmod) => `  <url><loc>${escapeHtml(origin + pathname)}</loc>${lastmod ? `<lastmod>${escapeHtml(lastmod.slice(0, 10))}</lastmod>` : ''}</url>`
  const urls = [
    entry('/'),
    entry('/survey'),
    entry('/bao-cao-quy'),
    entry('/tin-tuc'),
    ...news.categories.map((category) => entry(`/tin-tuc/chuyen-muc/${category.slug}`, category.updatedAt)),
    ...news.posts.map((post) => entry(`/tin-tuc/${post.slug}`, post.updatedAt)),
  ]
  const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`, 'utf8')
  res.writeHead(200, { 'cache-control': 'public, max-age=600', 'content-length': String(body.length), 'content-type': 'application/xml; charset=utf-8', 'x-content-type-options': 'nosniff' })
  res.end(req.method === 'HEAD' ? undefined : body)
}

function serveRobots(req, res) {
  const body = Buffer.from(`User-agent: *\nAllow: /\nDisallow: /dashboard/\n\nSitemap: ${publicOrigin(req)}/sitemap.xml\n`, 'utf8')
  res.writeHead(200, { 'cache-control': 'public, max-age=3600', 'content-length': String(body.length), 'content-type': 'text/plain; charset=utf-8' })
  res.end(req.method === 'HEAD' ? undefined : body)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    // Accept origin-form targets only. "//host/..." or "/\host/..." would otherwise
    // parse as another host.
    if (url.origin !== 'http://localhost' || !(req.url ?? '').startsWith('/')) {
      sendError(res, 400, 'Bad Request')
      return
    }
    if (url.pathname.startsWith('/api/')) {
      await proxyApi(req, res, url)
      return
    }

    if (url.pathname === '/dashboard') {
      res.writeHead(308, { location: '/dashboard/' })
      res.end()
      return
    }

    if (url.pathname.startsWith('/dashboard/')) {
      await serveApp(req, res, dashboardRoot, url.pathname.slice('/dashboard'.length))
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (url.pathname === '/sitemap.xml') return await serveSitemap(req, res)
      if (url.pathname === '/robots.txt') return serveRobots(req, res)
      if (NEWS_PATH.test(url.pathname)) return await serveNewsPage(req, res, url)
    }

    await serveApp(req, res, landingRoot, url.pathname)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) sendError(res, 502, 'Bad Gateway')
    else res.destroy(error)
  }
}).listen(port, host, () => {
  console.log(`CWI public router on ${host}:${port}; landing=${landingRoot}; dashboard=${dashboardRoot}; api=${apiBaseUrl}`)
})

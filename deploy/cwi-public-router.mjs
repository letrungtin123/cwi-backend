import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])

const landingRoot = path.resolve(args.get('--landing-root') ?? 'source4/dist')
const dashboardRoot = path.resolve(args.get('--dashboard-root') ?? 'cwi-dashboard/dist')
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

async function proxyApi(req, res) {
  const target = new URL(req.url ?? '/', apiBaseUrl)
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
  const requested = resolveStaticPath(root, strippedPath)
  if (!requested) return sendError(res, 403, 'Forbidden')

  let filePath = requested
  let fileStat = null
  try {
    fileStat = await stat(filePath)
    if (fileStat.isDirectory()) filePath = path.join(filePath, 'index.html')
    fileStat = await stat(filePath)
  } catch {
    filePath = path.join(root, 'index.html')
    fileStat = await stat(filePath)
  }

  const ext = path.extname(filePath).toLowerCase()
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'content-length': String(fileStat.size),
    'content-type': mimeTypes.get(ext) ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(filePath).pipe(res)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/api/')) {
      await proxyApi(req, res)
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

    await serveApp(req, res, landingRoot, url.pathname)
  } catch (error) {
    console.error(error)
    if (!res.headersSent) sendError(res, 502, 'Bad Gateway')
    else res.destroy(error)
  }
}).listen(port, host, () => {
  console.log(`CWI public router on ${host}:${port}; landing=${landingRoot}; dashboard=${dashboardRoot}; api=${apiBaseUrl}`)
})

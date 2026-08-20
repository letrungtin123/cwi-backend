import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

export class ReportAssetStorageError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number | null

  constructor(message: string, options: { code: string; retryable: boolean; status?: number | null }) {
    super(message)
    this.name = 'ReportAssetStorageError'
    this.code = options.code
    this.retryable = options.retryable
    this.status = options.status ?? null
  }
}

export type ReportAssetStorageConfig = {
  bucket: string
  serviceRoleKey: string
  storageUrl: string
  timeoutMs: number
}

export type ReportObjectPaths = {
  htmlPath: string
  pdfPath: string
}

export type ReportAssetDownload = {
  body: ReadableStream<Uint8Array>
  contentLength: string | null
  contentType: string
}

export type ReportObjectPathInput = {
  reportJobId: string
  submissionId: string
  timestamp?: Date
}

type StorageRequestBody = NonNullable<RequestInit['body']>
type StorageRequestInit = RequestInit & { duplex?: 'half' }

const safeIdPattern = /^[a-zA-Z0-9._-]+$/

function encodeObjectPath(value: string) {
  return value.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

function joinUrl(baseUrl: string, path: string) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(path.replace(/^\/+/, ''), base).toString()
}

function assertObjectPath(value: string) {
  if (!value || value.length > 1024 || value.startsWith('/') || value.includes('\\')) {
    throw new ReportAssetStorageError('Report asset path is invalid.', {
      code: 'invalid_report_asset_path',
      retryable: false,
    })
  }

  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ReportAssetStorageError('Report asset path is invalid.', {
      code: 'invalid_report_asset_path',
      retryable: false,
    })
  }
}

function safeSegment(value: string) {
  if (safeIdPattern.test(value)) return value
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function parseStorageError(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return response.statusText || 'Supabase Storage request failed.'

  try {
    const body = JSON.parse(text) as { error?: string; message?: string }
    return body.message ?? body.error ?? text.slice(0, 500)
  } catch {
    return text.slice(0, 500)
  }
}

export function buildReportObjectPaths(input: ReportObjectPathInput): ReportObjectPaths {
  const timestamp = input.timestamp ?? new Date()
  const year = String(timestamp.getUTCFullYear())
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, '0')
  const base = [
    'reports',
    year,
    month,
    safeSegment(input.submissionId),
    safeSegment(input.reportJobId),
  ].join('/')

  return {
    htmlPath: `${base}/report.html`,
    pdfPath: `${base}/report.pdf`,
  }
}

export class ReportAssetStorage {
  constructor(private readonly config: ReportAssetStorageConfig) {}

  async uploadFile(objectPath: string, filePath: string, contentType: string) {
    assertObjectPath(objectPath)
    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>
    await this.request(`object/${encodeURIComponent(this.config.bucket)}/${encodeObjectPath(objectPath)}`, {
      body: body as StorageRequestBody,
      duplex: 'half',
      headers: {
        'cache-control': 'private, max-age=0, no-store',
        'content-type': contentType,
        'x-upsert': 'true',
      },
      method: 'POST',
    })
  }

  async download(objectPath: string): Promise<ReportAssetDownload> {
    assertObjectPath(objectPath)
    const response = await this.request(`object/authenticated/${encodeURIComponent(this.config.bucket)}/${encodeObjectPath(objectPath)}`, {
      method: 'GET',
    })

    if (!response.body) {
      throw new ReportAssetStorageError('Supabase Storage returned an empty file stream.', {
        code: 'storage_empty_stream',
        retryable: true,
        status: response.status,
      })
    }

    return {
      body: response.body,
      contentLength: response.headers.get('content-length'),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    }
  }

  private async request(path: string, init: StorageRequestInit) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const headers = new Headers(init.headers)
      headers.set('apikey', this.config.serviceRoleKey)
      headers.set('authorization', `Bearer ${this.config.serviceRoleKey}`)

      const response = await fetch(joinUrl(this.config.storageUrl, path), {
        ...init,
        headers,
        signal: controller.signal,
      })

      if (!response.ok) {
        const message = await parseStorageError(response)
        throw new ReportAssetStorageError(message, {
          code: `storage_${response.status}`,
          retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
          status: response.status,
        })
      }

      return response
    } catch (error) {
      if (error instanceof ReportAssetStorageError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ReportAssetStorageError('Supabase Storage request timed out.', {
          code: 'storage_timeout',
          retryable: true,
        })
      }

      throw new ReportAssetStorageError(error instanceof Error ? error.message : 'Supabase Storage request failed.', {
        code: 'storage_request_failed',
        retryable: true,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
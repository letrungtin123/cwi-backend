import { createHmac, timingSafeEqual } from 'node:crypto'

export type IssuedQuarterlyReportDownloadToken = {
  expiresAt: string
  token: string
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function signaturesMatch(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}

export class QuarterlyReportDownloadTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(reportId: string, downloadId: string): IssuedQuarterlyReportDownloadToken {
    const expiresAtMs = Date.now() + this.ttlSeconds * 1000
    const payload = `${reportId}.${downloadId}.${expiresAtMs}`
    return {
      expiresAt: new Date(expiresAtMs).toISOString(),
      token: `${downloadId}.${expiresAtMs}.${sign(payload, this.secret)}`,
    }
  }

  verify(reportId: string, downloadId: string, token: string) {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== downloadId) return false

    const expiresAtMs = Number(parts[1])
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < Date.now()) return false

    return signaturesMatch(sign(`${reportId}.${downloadId}.${expiresAtMs}`, this.secret), parts[2] ?? '')
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto'

export type IssuedReportAccessToken = {
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

export class ReportAccessTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(jobId: string): IssuedReportAccessToken {
    const expiresAtMs = Date.now() + this.ttlSeconds * 1000
    const expiresAt = new Date(expiresAtMs)
    const payload = `${jobId}.${expiresAtMs}`
    return {
      expiresAt: expiresAt.toISOString(),
      token: `${payload}.${sign(payload, this.secret)}`,
    }
  }

  verify(jobId: string, token: string) {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== jobId) return false

    const expiresAtMs = Number(parts[1])
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < Date.now()) return false

    const payload = `${parts[0]}.${parts[1]}`
    return signaturesMatch(sign(payload, this.secret), parts[2] ?? '')
  }
}

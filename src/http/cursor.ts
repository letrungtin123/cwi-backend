import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from './errors.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CursorPayload = {
  id: string
  timestamp: string
  version: 1
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function invalidCursor(): never {
  throw new HttpError(400, 'invalid_cursor', 'cursor must be a valid pagination cursor.')
}

export function encodeCursor(secret: string, input: { id: string; timestamp: Date }) {
  const payload: CursorPayload = {
    id: input.id,
    timestamp: input.timestamp.toISOString(),
    version: 1,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload, secret)}`
}

export function decodeCursor(secret: string, value: unknown): { before: Date; beforeId: string } {
  if (typeof value !== 'string' || value.length < 20 || value.length > 512) invalidCursor()

  const separator = value.lastIndexOf('.')
  if (separator <= 0 || separator === value.length - 1) invalidCursor()

  const encodedPayload = value.slice(0, separator)
  const providedSignature = value.slice(separator + 1)
  const expectedSignature = sign(encodedPayload, secret)
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    invalidCursor()
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    invalidCursor()
  }

  if (!payload || typeof payload !== 'object') invalidCursor()
  const candidate = payload as Partial<CursorPayload>
  if (candidate.version !== 1 || typeof candidate.id !== 'string' || !uuidPattern.test(candidate.id) || typeof candidate.timestamp !== 'string') {
    invalidCursor()
  }

  const before = new Date(candidate.timestamp)
  if (Number.isNaN(before.getTime())) invalidCursor()

  return { before, beforeId: candidate.id }
}

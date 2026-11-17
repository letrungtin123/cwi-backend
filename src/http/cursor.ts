import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from './errors.js'
import { uuidPattern } from './ids.js'


type CursorPayload = {
  id: string
  timestamp: string
  version: 1
}

function sign(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function invalidCursor(): never {
  throw new HttpError(400, 'invalid_cursor', 'Tham số phân trang (cursor) không hợp lệ.')
}

// The timestamp is the row's exact time as PostgreSQL gives it (microseconds), not a JS Date
// (milliseconds): rows less than a millisecond apart would otherwise be skipped between pages.
// SQL helpers: cursorTimestampSql().
export function encodeCursor(secret: string, input: { id: string; timestamp: string }) {
  if (!isCursorTimestamp(input.timestamp)) throw new Error('Cursor timestamp must be an ISO time')
  const payload: CursorPayload = {
    id: input.id,
    timestamp: input.timestamp,
    version: 1,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload, secret)}`
}

// "2026-11-17T05:12:34.123456Z": what cursorTimestampSql() produces, or an older ms ISO time.
const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/

export function isCursorTimestamp(value: unknown): value is string {
  return typeof value === 'string' && cursorTimestampPattern.test(value) && !Number.isNaN(Date.parse(value))
}

// A column's exact UTC time with microseconds, for encodeCursor().
export function cursorTimestampSql(column: string) {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}

// "before" is passed to PostgreSQL as text ($n::timestamptz), keeping its microseconds.
export function decodeCursor(secret: string, value: unknown): { before: string; beforeId: string } {
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

  if (!isCursorTimestamp(candidate.timestamp)) invalidCursor()

  return { before: candidate.timestamp, beforeId: candidate.id }
}

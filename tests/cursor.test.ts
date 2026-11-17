import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor, isCursorTimestamp } from '../src/http/cursor.js'
import { HttpError } from '../src/http/errors.js'

const secret = 'test-admin-cursor-secret-that-is-long-enough'
const input = {
  id: '2c78db0b-e97e-49ca-8a9a-2565077f0ffd',
  // Microseconds, as cursorTimestampSql() gives them; a JS Date would drop the last three digits.
  timestamp: '2026-08-24T05:00:00.123456Z',
}

describe('admin pagination cursor', () => {
  it('round-trips a signed cursor without exposing raw query parameters', () => {
    const cursor = encodeCursor(secret, input)

    expect(cursor).not.toContain(input.id)
    expect(decodeCursor(secret, cursor)).toEqual({
      before: input.timestamp,
      beforeId: input.id,
    })
  })

  it('keeps the microseconds and rejects a timestamp that is not an ISO time', () => {
    expect(decodeCursor(secret, encodeCursor(secret, input)).before).toBe('2026-08-24T05:00:00.123456Z')
    expect(() => encodeCursor(secret, { ...input, timestamp: 'yesterday' })).toThrowError()
    expect(isCursorTimestamp('2026-08-24T05:00:00.123Z')).toBe(true)
    expect(isCursorTimestamp('2026-08-24 05:00:00')).toBe(false)
  })

  it('rejects a tampered cursor', () => {
    const cursor = encodeCursor(secret, input)
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`

    expect(() => decodeCursor(secret, tampered)).toThrowError(HttpError)
  })

  it('rejects cursors signed with another secret', () => {
    const cursor = encodeCursor(secret, input)

    expect(() => decodeCursor('different-secret', cursor)).toThrowError(HttpError)
  })
})

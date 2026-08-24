import { describe, expect, it } from 'vitest'
import { decodeCursor, encodeCursor } from '../src/http/cursor.js'
import { HttpError } from '../src/http/errors.js'

const secret = 'test-admin-cursor-secret-that-is-long-enough'
const input = {
  id: '2c78db0b-e97e-49ca-8a9a-2565077f0ffd',
  timestamp: new Date('2026-08-24T05:00:00.000Z'),
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

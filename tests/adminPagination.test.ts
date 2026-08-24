import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { parseFullSubmissionLimit } from '../src/modules/admin/adminRoutes.js'

describe('full submission pagination', () => {
  it('defaults to ten rows', () => {
    expect(parseFullSubmissionLimit(undefined)).toBe(10)
  })

  it('accepts at most ten rows', () => {
    expect(parseFullSubmissionLimit('10')).toBe(10)
  })

  it.each(['11', '50', '101'])('rejects an oversized page: %s', (value) => {
    expect(() => parseFullSubmissionLimit(value)).toThrowError(HttpError)
    expect(() => parseFullSubmissionLimit(value)).toThrow('limit must be between 1 and 10')
  })
})

import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { parseFullSubmissionLimit, parseReportPdfUploaded, parseSurveyVersion } from '../src/modules/admin/adminRoutes.js'

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

describe('full submission PDF filter', () => {
  it('defaults to no PDF filter', () => {
    expect(parseReportPdfUploaded(undefined)).toBeNull()
  })

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses %s', (value, expected) => {
    expect(parseReportPdfUploaded(value)).toBe(expected)
  })

  it('rejects values other than true or false', () => {
    expect(() => parseReportPdfUploaded('1')).toThrowError(HttpError)
    expect(() => parseReportPdfUploaded('1')).toThrow('reportPdfUploaded filter must be true or false')
  })
})

describe('submission survey version filter', () => {
  it('defaults to every quarter', () => {
    expect(parseSurveyVersion(undefined)).toBeNull()
    expect(parseSurveyVersion('')).toBeNull()
  })

  it('accepts a quarter label', () => {
    expect(parseSurveyVersion('2026Q3')).toBe('2026Q3')
  })

  it.each(['2026Q5', 'q3-2026', "2026Q3' OR 1=1"])('rejects %s', (value) => {
    expect(() => parseSurveyVersion(value)).toThrowError(HttpError)
  })
})

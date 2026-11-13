import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { parseReportPdfUploaded, parseSurveyVersion } from '../src/modules/admin/adminRoutes.js'

describe('submission PDF filter', () => {
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
    expect(() => parseReportPdfUploaded('1')).toThrow('Bộ lọc file PDF chỉ nhận true hoặc false.')
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

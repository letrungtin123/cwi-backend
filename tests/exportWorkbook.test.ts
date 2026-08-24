import { describe, expect, it } from 'vitest'
import { sanitizeExcelCell } from '../src/modules/exports/exportWorkbook.js'

describe('export workbook cell safety', () => {
  it.each(['=HYPERLINK("https://example.com")', '+SUM(A1:A2)', '-2+3', '@cmd'])('escapes formula-like values: %s', (value) => {
    expect(sanitizeExcelCell(value)).toBe("'" + value)
  })

  it('keeps normal Vietnamese text unchanged', () => {
    expect(sanitizeExcelCell('Nguyễn Văn An')).toBe('Nguyễn Văn An')
  })

  it('limits oversized cell content', () => {
    const result = sanitizeExcelCell('a'.repeat(40_000))
    expect(result).toHaveLength(32_000)
    expect(result.endsWith('...')).toBe(true)
  })
})

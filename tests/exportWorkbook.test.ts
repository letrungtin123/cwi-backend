import { describe, expect, it } from 'vitest'
import { buildEventRegistrationValues, eventRegistrationColumns, sanitizeExcelCell } from '../src/modules/exports/exportWorkbook.js'

const registration = {
  company_name: 'Công ty CWI',
  email: 'an@company.com',
  full_name: 'Nguyễn Văn An',
  linked_answers_count: null,
  linked_email: null,
  linked_full_name: null,
  linked_position: null,
  linked_privacy_consent: null,
  linked_report_status: null,
  linked_submission_id: null,
  linked_submission_status: null,
  linked_submitted_at: null,
  phone: '+84901234567',
  position: 'CEO',
  quarter: null,
  registered_at: new Date('2026-10-20T00:00:00.000Z'),
  speaker_question: 'CEO nên bắt đầu từ đâu?',
}

describe('event registration export columns', () => {
  it('exports Webinar phone, company and speaker question under their headers', () => {
    const { headers, widths } = eventRegistrationColumns('webinar')
    const values = buildEventRegistrationValues('webinar', registration)

    expect(values).toHaveLength(headers.length)
    expect(widths).toHaveLength(headers.length)
    expect(values[headers.indexOf('Số điện thoại')]).toBe('+84901234567')
    expect(values[headers.indexOf('Công ty')]).toBe('Công ty CWI')
    expect(values[headers.indexOf('Câu hỏi cho diễn giả')]).toBe('CEO nên bắt đầu từ đâu?')
    expect(values[headers.indexOf('Tình trạng')]).toBe('Đăng ký riêng')
  })

  it('exports the Roundtable quarter, phone and company without the Webinar question', () => {
    const { headers, widths } = eventRegistrationColumns('roundtable')
    const values = buildEventRegistrationValues('roundtable', { ...registration, quarter: '2026Q4', speaker_question: null })

    expect(headers).not.toContain('Câu hỏi cho diễn giả')
    expect(values).toHaveLength(headers.length)
    expect(widths).toHaveLength(headers.length)
    expect(values.slice(0, 7)).toEqual(['2026Q4', 'Nguyễn Văn An', 'an@company.com', '+84901234567', 'CEO', 'Công ty CWI', 'Đăng ký riêng'])
  })

  it('leaves contact cells empty for older Roundtable registrations', () => {
    const values = buildEventRegistrationValues('roundtable', { ...registration, company_name: null, phone: null, quarter: '2026Q3', speaker_question: null })
    expect(values.slice(0, 6)).toEqual(['2026Q3', 'Nguyễn Văn An', 'an@company.com', '', 'CEO', ''])
  })
})

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

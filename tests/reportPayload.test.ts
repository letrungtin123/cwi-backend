import { describe, expect, it } from 'vitest'
import { normalizeStoredReportPayload } from '../src/modules/reports/reportPayload.js'

describe('stored report payload compatibility', () => {
  it('normalizes the legacy question 17 label without changing other answers', () => {
    const payload = {
      answers: [
        { answer: 'CEO và HR chưa thống nhất', idx: 17 },
        { answer: 'Khác', idx: 19, other_text: 'Câu trả lời riêng' },
      ],
      cohort_consent: true,
    }

    expect(normalizeStoredReportPayload(payload)).toEqual({
      answers: [
        { answer: 'CEO và Nhân sự chưa thống nhất', idx: 17 },
        { answer: 'Khác', idx: 19, other_text: 'Câu trả lời riêng' },
      ],
      cohort_consent: true,
    })
  })

  it('leaves malformed payloads untouched for the worker contract to reject', () => {
    expect(normalizeStoredReportPayload(null)).toBeNull()
    expect(normalizeStoredReportPayload({ cohort_consent: false })).toEqual({ cohort_consent: false })
  })
})

import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { parseSourceFilter } from '../src/modules/admin/adminRoutes.js'
import { exportFiltersSchema } from '../src/modules/exports/exportTypes.js'
import { buildSubmissionValues, NO_SURVEY_SOURCE_LABEL, submissionColumns } from '../src/modules/exports/exportWorkbook.js'
import { normalizeSurveySubmission } from '../src/modules/survey/submissionValidation.js'
import { readSubmittedSurveySourceCode } from '../src/modules/surveySources/surveySourceCode.js'
import { normalizeSurveySourceCreate, normalizeSurveySourceUpdate } from '../src/modules/surveySources/surveySourceRoutes.js'

const sourceId = '6f1e970a-8924-4870-9ab1-05804a0160fb'

function partOneSubmission(extra: Record<string, unknown> = {}) {
  return {
    answers: [
      ...Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 })),
      { answer: 'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.', idx: 17 },
      { answer: 'Đưa AI vào quá trình ra quyết định của Ban điều hành.', idx: 18 },
    ],
    participant: {
      companyName: 'Công ty CWI',
      email: 'an@company.com',
      fullName: 'Nguyễn Văn An',
      phone: '0901234567',
      position: 'CEO',
    },
    privacyConsent: 'not_applicable',
    submissionStatus: 'part1_only',
    surveyVersion: '2026Q4',
    ...extra,
  }
}

function expectHttpErrorCode(run: () => unknown, code: string) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).code).toBe(code)
    return
  }
  throw new Error(`Expected HttpError ${code}`)
}

describe('source code sent with a survey submission', () => {
  it('keeps a valid code, lowercased', () => {
    expect(readSubmittedSurveySourceCode('vcci-hcm')).toBe('vcci-hcm')
    expect(readSubmittedSurveySourceCode('  VCCI-HCM ')).toBe('vcci-hcm')
    expect(readSubmittedSurveySourceCode('a1')).toBe('a1')
  })

  it('drops anything that is not a valid code instead of failing', () => {
    for (const value of [undefined, null, 12, '', '-abc', 'abc-', 'có dấu', 'a_b', 'x'.repeat(49), { code: 'a' }]) {
      expect(readSubmittedSurveySourceCode(value)).toBeNull()
    }
  })

  it('stores the code without making it part of the retry check', () => {
    const withSource = normalizeSurveySubmission(partOneSubmission({ sourceCode: 'VCCI-HCM' }), null)
    const otherSource = normalizeSurveySubmission(partOneSubmission({ sourceCode: 'doi-tac-a' }), null)
    const noSource = normalizeSurveySubmission(partOneSubmission(), null)

    expect(withSource.sourceCode).toBe('vcci-hcm')
    expect(noSource.sourceCode).toBeNull()
    expect(withSource.payloadHash).toBe(otherSource.payloadHash)
    expect(withSource.payloadHash).toBe(noSource.payloadHash)
  })

  it('still accepts the submission when the link carried a broken code', () => {
    const submission = normalizeSurveySubmission(partOneSubmission({ sourceCode: '<script>' }), null)
    expect(submission.sourceCode).toBeNull()
    expect(submission.submissionStatus).toBe('part1_only')
  })
})

describe('admin source form', () => {
  it('normalizes a new source', () => {
    expect(normalizeSurveySourceCreate({ code: ' VCCI-HCM ', name: '  VCCI Hồ Chí Minh ', note: '  ' })).toEqual({
      code: 'vcci-hcm',
      name: 'VCCI Hồ Chí Minh',
      note: null,
    })
  })

  it('rejects codes that cannot be used in a link and empty names', () => {
    expectHttpErrorCode(() => normalizeSurveySourceCreate({ code: 'vcci hcm', name: 'VCCI' }), 'invalid_survey_source')
    expectHttpErrorCode(() => normalizeSurveySourceCreate({ code: 'vcci', name: '   ' }), 'invalid_survey_source')
    expectHttpErrorCode(() => normalizeSurveySourceCreate({ code: 'vcci', name: 'VCCI', extra: true }), 'invalid_survey_source')
  })

  it('never lets an update change the code', () => {
    expect(normalizeSurveySourceUpdate({ isActive: false, name: 'VCCI', note: 'Hội thảo 11/2026' })).toEqual({
      isActive: false,
      name: 'VCCI',
      note: 'Hội thảo 11/2026',
    })
    expectHttpErrorCode(() => normalizeSurveySourceUpdate({ code: 'other', isActive: true, name: 'VCCI' }), 'invalid_survey_source')
  })
})

describe('source filter', () => {
  it('accepts a source id or none for the submissions list', () => {
    expect(parseSourceFilter(undefined)).toBeNull()
    expect(parseSourceFilter('')).toBeNull()
    expect(parseSourceFilter('none')).toBe('none')
    expect(parseSourceFilter(sourceId)).toBe(sourceId)
    expectHttpErrorCode(() => parseSourceFilter('vcci-hcm'), 'invalid_source_filter')
  })

  it('accepts the same values for the Excel export', () => {
    expect(exportFiltersSchema.parse({ sourceId: 'none' })).toEqual({ sourceId: 'none' })
    expect(exportFiltersSchema.parse({ sourceId })).toEqual({ sourceId })
    expect(exportFiltersSchema.safeParse({ sourceId: 'vcci-hcm' }).success).toBe(false)
  })
})

describe('Excel export source column', () => {
  const row = {
    answers_count: 18,
    company_name: 'Công ty CWI',
    email: 'an@company.com',
    full_name: 'Nguyễn Văn An',
    part1_completed: true,
    part2_completed: false,
    phone: '+84901234567',
    position: 'CEO',
    privacy_consent: 'not_applicable',
    report_status: 'completed',
    roundtable_registered: false,
    status_note: 'Hoàn thành Phần 1 và gửi kết quả Phần 1.',
    submission_status: 'part1_only',
    submitted_at: new Date('2026-11-09T03:10:00.000Z'),
    survey_source_name: 'VCCI Hồ Chí Minh',
    survey_version: '2026Q4',
  }

  it('puts the source name under the "Nguồn mời" header', () => {
    const values = buildSubmissionValues(row)
    expect(values).toHaveLength(submissionColumns.headers.length)
    expect(submissionColumns.widths).toHaveLength(submissionColumns.headers.length)
    expect(values[submissionColumns.headers.indexOf('Nguồn mời')]).toBe('VCCI Hồ Chí Minh')
    expect(values[submissionColumns.headers.indexOf('Chức vụ')]).toBe('CEO')
    expect(values[submissionColumns.headers.indexOf('Thời gian gửi')]).toEqual(row.submitted_at)
  })

  it('says "Không có" when the submission came without a source link', () => {
    const values = buildSubmissionValues({ ...row, survey_source_name: null })
    expect(NO_SURVEY_SOURCE_LABEL).toBe('Không có')
    expect(values[submissionColumns.headers.indexOf('Nguồn mời')]).toBe('Không có')
  })
})

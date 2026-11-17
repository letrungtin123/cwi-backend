import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { buildReportEmail } from '../src/modules/reportDelivery/emailTemplate.js'
import { buildReportJobRequest } from '../src/modules/reports/reportPayload.js'
import { CURRENT_ROUNDTABLE_QUARTER } from '../src/modules/roundtable/roundtableQuarter.js'
import { normalizeSurveySubmission } from '../src/modules/survey/submissionValidation.js'
import { getSurveyEdition, LATEST_SURVEY_VERSION, SURVEY_VERSIONS, surveyQuarterLabel } from '../src/modules/survey/surveyEditions.js'
import { detectImageType } from '../src/modules/surveyQuarters/surveyQuarterImageUpload.js'
import type { SurveyQuarter, SurveyQuarterPage } from '../src/modules/surveyQuarters/surveyQuarterRepository.js'
import { normalizeSurveyQuarterPageUpdate, normalizeSurveyQuarterUpdate, toPublicSurveyQuarters } from '../src/modules/surveyQuarters/surveyQuarterRoutes.js'

const participant = { companyName: 'CWI', email: 'an@company.com', fullName: 'Nguyễn Văn An', phone: '0901234567', position: 'CEO' }

function q3PartOne() {
  return [
    ...Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 })),
    { answer: 'Mục khác:', idx: 17, otherText: 'Thiếu dữ liệu nhân sự' },
    { answer: 'Xây dựng đội ngũ kế nhiệm', idx: 18 },
  ]
}

function q3All() {
  return [
    ...q3PartOne(),
    { answer: 'Ban điều hành cùng thống nhất trước khi quyết định', idx: 19 },
    { answer: 'Tuyển đủ nhân sự', idx: 20 },
    { answer: 'Các đơn vị sẽ phối hợp kém', idx: 21 },
    { answer: 'Nguồn vốn', idx: 22 },
    { answer: 'Từ 300 - <1,000 tỷ VND', idx: 23 },
    { answer: 'https://example.com', idx: 24 },
  ]
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

describe('survey editions', () => {
  it('lists 2026Q3 and 2026Q4, newest last, with cwi-ai edition ids', () => {
    expect(SURVEY_VERSIONS).toEqual(['2026Q3', '2026Q4'])
    expect(LATEST_SURVEY_VERSION).toBe('2026Q4')
    expect(getSurveyEdition('2026Q3')?.aiEditionId).toBe('2026-q3')
    expect(getSurveyEdition('2026Q4')?.aiEditionId).toBe('2026-q4')
    expect(getSurveyEdition('2026Q2')).toBeNull()
    expect(surveyQuarterLabel('2026Q3')).toBe('Quý 3/2026')
    expect(surveyQuarterLabel('2026Q3', 'en')).toBe('Q3 2026')
  })

  it('keeps the CEO Roundtable on the newest quarter', () => {
    expect(CURRENT_ROUNDTABLE_QUARTER).toBe('2026Q4')
  })
})

describe('2026Q3 submissions', () => {
  it('stores the survey text and sends cwi-ai its registry text through the 2026-q3 route', () => {
    const submission = normalizeSurveySubmission(
      { answers: q3PartOne(), participant, privacyConsent: 'not_applicable', submissionStatus: 'part1_only', surveyVersion: '2026Q3' },
      null,
    )
    expect(submission.surveyVersion).toBe('2026Q3')
    expect(submission.answers.find((answer) => answer.idx === 6)?.questionText).toContain('Hệ cộng lực (bao gồm con người, AI, tự động hóa, hệ sinh thái)')
    expect(submission.answers.find((answer) => answer.idx === 17)?.answerValue).toEqual({ otherText: 'Thiếu dữ liệu nhân sự', selectedOption: 'Mục khác:' })

    const job = buildReportJobRequest(submission)
    expect(job.providerEndpoint).toBe('/v3/editions/2026-q3/reports/anonymous')
    expect(job.requestPayload.answers).toHaveLength(18)
    expect(job.requestPayload.answers.find((answer) => answer.idx === 6)?.question).toBe(
      'Tôi tin Hệ năng lực (bao gồm con người, AI, công nghệ, dữ liệu, đối tác) hiện tại sẽ tạo lợi thế cạnh tranh trong 3 năm tới.',
    )
    expect(job.requestPayload.answers.find((answer) => answer.idx === 17)).toEqual({
      answer: 'Khác',
      idx: 17,
      other_text: 'Thiếu dữ liệu nhân sự',
      question: 'Trong 12 tháng tới, rủi ro lớn nhất đối với tăng trưởng của doanh nghiệp liên quan đến đội ngũ quản lý là gì?',
    })
  })

  it('sends all 24 answers of a full 2026Q3 survey to the personalized route', () => {
    const submission = normalizeSurveySubmission(
      { answers: q3All(), participant, privacyConsent: 'yes', submissionStatus: 'full_private_report', surveyVersion: '2026Q3' },
      null,
    )
    const job = buildReportJobRequest(submission)
    expect(job.providerEndpoint).toBe('/v3/editions/2026-q3/reports/personalized')
    expect(job.requestPayload.answers).toHaveLength(24)
  })

  it('does not offer "Mục khác:" on questions 20 and 21 until cwi-ai accepts it', () => {
    for (const idx of [20, 21]) {
      const answers = q3All().map((answer) => (answer.idx === idx ? { answer: 'Mục khác:', idx, otherText: 'Khác hẳn' } : answer))
      expectHttpErrorCode(
        () => normalizeSurveySubmission({ answers, participant, privacyConsent: 'yes', submissionStatus: 'full_private_report', surveyVersion: '2026Q3' }, null),
        'invalid_mcq_option',
      )
    }
  })

  it('rejects 2026Q4 answers sent as 2026Q3', () => {
    expectHttpErrorCode(
      () =>
        normalizeSurveySubmission(
          {
            answers: [...q3PartOne().filter((answer) => answer.idx !== 17), { answer: 'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.', idx: 17 }],
            participant,
            privacyConsent: 'not_applicable',
            submissionStatus: 'part1_only',
            surveyVersion: '2026Q3',
          },
          null,
        ),
      'invalid_mcq_option',
    )
  })
})

describe('report emails', () => {
  it('names the theme of the survey quarter', () => {
    expect(buildReportEmail('personalized', 'vi', '2026Q3').text).toContain('"Năng lực lãnh đạo cho tăng trưởng"')
    expect(buildReportEmail('anonymous', 'vi', '2026Q4').text).toContain('“Hệ cộng lực sẵn sàng cho tương lai”')
    expect(buildReportEmail('anonymous', 'en', '2026Q3').text).toContain('“Leadership Capacity to Scale”')
    expect(buildReportEmail('personalized', 'en', null).text).toContain('"Workforce Plus for Future Readiness"')
    expect(buildReportEmail('personalized', 'vi', '2026Q3').html).not.toContain('{theme}')
  })
})

function quarter(overrides: Partial<SurveyQuarter>): SurveyQuarter {
  return {
    deferredResultDays: 7,
    description: { en: 'Description', vi: 'Mô tả' },
    id: '00000000-0000-4000-8000-000000000001',
    image: null,
    isVisible: true,
    label: { en: 'Q4 2026', vi: 'Quý 4/2026' },
    reportGenerationEnabled: true,
    sortOrder: 1,
    submissionCount: 0,
    supported: true,
    surveyVersion: '2026Q4',
    title: { en: 'Title', vi: 'Tiêu đề' },
    updatedAt: '2026-11-17T00:00:00.000Z',
    updatedByEmail: null,
    waitingReports: 0,
    ...overrides,
  }
}

const page: SurveyQuarterPage = {
  description: { en: 'd', vi: 'd' },
  kicker: { en: 'k', vi: 'k' },
  title: { en: 't', vi: 't' },
  updatedAt: null,
  updatedByEmail: null,
}

describe('public survey quarters', () => {
  it('shows visible quarters the code supports, in order, and marks the newest one current', () => {
    const result = toPublicSurveyQuarters(page, [
      quarter({ sortOrder: 1, surveyVersion: '2026Q3' }),
      quarter({ image: { contentType: 'image/png', sha256: 'a'.repeat(64), storagePath: 'quarters/2026Q4/x.png' }, sortOrder: 2, surveyVersion: '2026Q4' }),
      quarter({ isVisible: false, surveyVersion: '2026Q2' }),
      quarter({ supported: false, surveyVersion: '2027Q1' }),
    ])
    expect(result.quarters.map((item) => [item.surveyVersion, item.isCurrent])).toEqual([['2026Q3', false], ['2026Q4', true]])
    expect(result.quarters[0]?.imageUrl).toBeNull()
    expect(result.quarters[1]?.imageUrl).toBe(`/api/v1/public/survey-quarters/2026Q4/image?v=${'a'.repeat(16)}`)
    expect(result.quarters[1]).not.toHaveProperty('reportGenerationEnabled')
  })

  it('marks the newest visible quarter current when the newest one is hidden', () => {
    const result = toPublicSurveyQuarters(page, [quarter({ surveyVersion: '2026Q3' }), quarter({ isVisible: false, surveyVersion: '2026Q4' })])
    expect(result.quarters).toEqual([expect.objectContaining({ isCurrent: true, surveyVersion: '2026Q3' })])
  })
})

describe('survey quarter updates', () => {
  const valid = {
    deferredResultDays: 7,
    description: { en: 'Benchmark', vi: 'Đối chuẩn' },
    isVisible: true,
    reportGenerationEnabled: false,
    sortOrder: 2,
    title: { en: 'Title', vi: ' Tiêu đề ' },
  }

  it('accepts a full update and trims the text', () => {
    expect(normalizeSurveyQuarterUpdate(valid)).toEqual({ ...valid, title: { en: 'Title', vi: 'Tiêu đề' } })
  })

  it('rejects empty titles, days outside 1 to 60, long descriptions and unknown fields', () => {
    for (const payload of [
      { ...valid, title: { en: 'Title', vi: '  ' } },
      { ...valid, deferredResultDays: 0 },
      { ...valid, deferredResultDays: 61 },
      { ...valid, description: { en: 'x', vi: 'x'.repeat(401) } },
      { ...valid, title: { en: 'Two\nlines', vi: 'Tiêu đề' } },
      { ...valid, extra: true },
    ]) {
      expectHttpErrorCode(() => normalizeSurveyQuarterUpdate(payload), 'invalid_survey_quarter')
    }
  })

  it('validates the heading above the cards', () => {
    const heading = { description: { en: 'd', vi: 'd' }, kicker: { en: 'k', vi: 'k' }, title: { en: 't', vi: 't' } }
    expect(normalizeSurveyQuarterPageUpdate(heading)).toEqual(heading)
    expectHttpErrorCode(() => normalizeSurveyQuarterPageUpdate({ ...heading, kicker: { en: 'k', vi: 'x'.repeat(81) } }), 'invalid_survey_quarter_page')
  })
})

describe('card image type', () => {
  it('reads JPEG, PNG and WebP from the first bytes only', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ contentType: 'image/jpeg', extension: 'jpg' })
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ contentType: 'image/png', extension: 'png' })
    expect(detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]))).toEqual({ contentType: 'image/webp', extension: 'webp' })
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    expect(detectImageType(Buffer.from('%PDF-1.7'))).toBeNull()
  })
})

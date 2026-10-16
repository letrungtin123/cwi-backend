import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { buildAnonymousReportPayload } from '../src/modules/reports/anonymousReportPayload.js'
import { normalizeRoundtableEmailCheck, normalizeRoundtableRegistration } from '../src/modules/roundtable/roundtableValidation.js'
import { normalizeWebinarEmailCheck, normalizeWebinarRegistration } from '../src/modules/webinar/webinarValidation.js'
import { buildReportObjectPaths } from '../src/modules/reports/reportAssetStorage.js'
import { buildReportJobRequest } from '../src/modules/reports/reportPayload.js'
import { normalizeSurveySubmission } from '../src/modules/survey/submissionValidation.js'

function partOneAnswers() {
  return [
    ...Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 })),
    { answer: 'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.', idx: 17 },
    { answer: 'Đưa AI vào quá trình ra quyết định của Ban điều hành.', idx: 18 },
  ]
}

function allAnswers() {
  return [
    ...partOneAnswers(),
    { answer: 'Các phòng ban phối hợp chậm chạp, có xu hướng đùn đẩy trách nhiệm.', idx: 19 },
    { answer: 'Chủ yếu ứng dụng để cắt giảm chi phí và thay thế các tác vụ thủ công.', idx: 20 },
    { answer: 'Cấu trúc tổ chức hiện tại quá cứng nhắc để tích hợp công nghệ mới.', idx: 21 },
    { answer: 'Có hệ thống báo cáo nhưng thường chậm trễ, chỉ phản ánh dữ liệu quá khứ.', idx: 22 },
    { answer: 'Từ 300 - <1000 tỉ VND', idx: 23 },
    { answer: 'https://example.com', idx: 24 },
  ]
}

const participant = {
  email: 'AN@Company.com',
  fullName: 'Nguyễn Văn An',
  phone: '090 123 4567',
  position: 'HRM',
}

const surveyVersion = '2026Q4'

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

describe('normalizeSurveySubmission', () => {
  it('normalizes part1_only submissions and maps the anonymous report payload', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: partOneAnswers(),
        participant,
        privacyConsent: 'not_applicable',
        submissionStatus: 'part1_only',
        surveyVersion,
      },
      'survey-key-1',
    )

    expect(submission.answers).toHaveLength(18)
    expect(submission.part1Completed).toBe(true)
    expect(submission.part2Completed).toBe(false)
    expect(submission.participant.email).toBe('an@company.com')
    expect(submission.participant.phone).toBe('+84901234567')
    expect(submission.statusNote).toContain('Phần 1')
    expect(submission.surveyVersion).toBe('2026Q4')

    const reportPayload = buildAnonymousReportPayload(submission)
    expect(reportPayload.participant).toEqual({ position: 'HRM' })
    expect(reportPayload).not.toHaveProperty('phone')
    expect(reportPayload.delivery_contact).toEqual({ email: 'an@company.com', full_name: 'Nguyễn Văn An' })
    expect(reportPayload.cohort_consent).toBe(false)
    expect(reportPayload.answers).toHaveLength(18)
    expect(reportPayload.answers[0]).toEqual({
      answer: 1,
      idx: 1,
      question: 'Chúng tôi có đủ năng lực để thích ứng nhanh trước thay đổi của thị trường.',
    })
  })

  it('rejects submissions without the current survey version', () => {
    const payload = {
      answers: partOneAnswers(),
      participant,
      privacyConsent: 'not_applicable',
      submissionStatus: 'part1_only',
    }

    expectHttpErrorCode(() => normalizeSurveySubmission(payload, null), 'survey_version_mismatch')
    expectHttpErrorCode(() => normalizeSurveySubmission({ ...payload, surveyVersion: '2026Q3' }, null), 'survey_version_mismatch')
  })

  it('rejects 2026Q3 options that are not part of the 2026Q4 question set', () => {
    expectHttpErrorCode(
      () =>
        normalizeSurveySubmission(
          {
            answers: [...partOneAnswers().filter((answer) => answer.idx !== 17), { answer: 'Thiếu người kế nhiệm', idx: 17 }],
            participant,
            privacyConsent: 'not_applicable',
            submissionStatus: 'part1_only',
            surveyVersion,
          },
          null,
        ),
      'invalid_mcq_option',
    )
  })

  it('sends the registered "Khác." option with its text to the report service', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: [
          ...partOneAnswers().filter((answer) => answer.idx !== 18),
          { answer: 'Khác.', idx: 18, otherText: '  Đầu tư   hạ tầng dữ liệu  ' },
        ],
        participant,
        privacyConsent: 'not_applicable',
        submissionStatus: 'part1_only',
        surveyVersion,
      },
      null,
    )

    expect(submission.answers.find((answer) => answer.idx === 18)?.otherText).toBe('Đầu tư hạ tầng dữ liệu')
    expect(buildAnonymousReportPayload(submission).answers.find((answer) => answer.idx === 18)).toEqual({
      answer: 'Khác.',
      idx: 18,
      other_text: 'Đầu tư hạ tầng dữ liệu',
      question: 'Nếu chỉ được đầu tư vào một ưu tiên duy nhất để xây dựng lực lượng lao động tương lai, anh/chị sẽ chọn điều gì?',
    })
  })

  it('rejects other text outside the report service limits', () => {
    for (const otherText of ['x', 'x'.repeat(501)]) {
      expectHttpErrorCode(
        () =>
          normalizeSurveySubmission(
            {
              answers: [...partOneAnswers().filter((answer) => answer.idx !== 17), { answer: 'Khác.', idx: 17, otherText }],
              participant,
              privacyConsent: 'not_applicable',
              submissionStatus: 'part1_only',
              surveyVersion,
            },
            null,
          ),
        'invalid_payload',
      )
    }
  })

  it('scores Q1-Q16 on the report service 0-100 scale', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: partOneAnswers().map((answer) => (typeof answer.answer === 'number' ? { ...answer, answer: 3 } : answer)),
        participant,
        privacyConsent: 'not_applicable',
        submissionStatus: 'part1_only',
        surveyVersion,
      },
      null,
    )

    expect(submission.scores).toEqual({ domainScores: [], overallScore: 50, scaleScore: 0 })
  })

  it('keeps all 24 answers for part2_refused_privacy submissions', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: allAnswers(),
        participant,
        privacyConsent: 'no',
        submissionStatus: 'part2_refused_privacy',
        surveyVersion,
      },
      null,
    )

    expect(submission.answers).toHaveLength(24)
    expect(submission.part2Completed).toBe(true)
    expect(submission.privacyConsent).toBe('no')
    expect(submission.statusNote).toContain('Không đồng ý')

    const reportJob = buildReportJobRequest(submission)
    expect(reportJob.providerEndpoint).toBe('/v3/reports/anonymous')
    expect(reportJob.requestPayload.answers).toHaveLength(18)
  })

  it('normalizes full_private_report submissions with roundtable registration', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: allAnswers(),
        participant,
        privacyConsent: 'yes',
        roundtableRegistration: {
          email: 'AN@Company.com',
          fullName: 'Nguyễn Văn An',
          registered: true,
        },
        submissionStatus: 'full_private_report',
        surveyVersion,
      },
      null,
    )

    expect(submission.answers).toHaveLength(24)
    expect(submission.roundtableRegistration).toEqual({
      email: 'an@company.com',
      fullName: 'Nguyễn Văn An',
      id: null,
      position: null,
      registered: true,
    })
    expect(submission.statusNote).toContain('Đồng ý')

    const reportJob = buildReportJobRequest(submission)
    expect(reportJob.providerEndpoint).toBe('/v3/reports/personalized')
    expect(reportJob.reportType).toBe('personalized')
    expect(reportJob.requestPayload.answers).toHaveLength(24)
    expect(reportJob.requestPayload.answers.find((answer) => answer.idx === 24)).toEqual({
      answer: 'https://example.com',
      idx: 24,
      question: 'Website chính thức của công ty',
    })
    expect(reportJob.requestPayload.cohort_consent).toBe(true)
    expect(reportJob.requestPayload.answers.find((answer) => answer.idx === 23)).toEqual({
      answer: 'Từ 300 - <1000 tỉ VND',
      idx: 23,
      question: 'Quy mô doanh thu của công ty hiện nay:',
    })
  })

  it('rejects a Roundtable email that does not match the participant email', () => {
    expect(() =>
      normalizeSurveySubmission(
        {
          answers: allAnswers(),
          participant,
          privacyConsent: 'yes',
          roundtableRegistration: {
            email: 'different@company.com',
            fullName: 'Nguyễn Văn An',
            registered: true,
          },
          submissionStatus: 'full_private_report',
          surveyVersion,
        },
        null,
      ),
    ).toThrow(HttpError)
  })

  it('rejects part1_only submissions that include Part 2 answers', () => {
    expect(() =>
      normalizeSurveySubmission(
        {
          answers: allAnswers(),
          participant,
          privacyConsent: 'not_applicable',
          submissionStatus: 'part1_only',
          surveyVersion,
        },
        null,
      ),
    ).toThrow(HttpError)
  })

  it('rejects privacy consent that does not match the selected status', () => {
    expect(() =>
      normalizeSurveySubmission(
        {
          answers: allAnswers(),
          participant,
          privacyConsent: 'yes',
          submissionStatus: 'part2_refused_privacy',
          surveyVersion,
        },
        null,
      ),
    ).toThrow(HttpError)
  })

  it('rejects a missing or invalid phone number', () => {
    expect(() => normalizeSurveySubmission({
      answers: partOneAnswers(),
      participant: { ...participant, phone: '123' },
      privacyConsent: 'not_applicable',
      submissionStatus: 'part1_only',
      surveyVersion,
    }, null)).toThrow(HttpError)
  })
})

describe('normalizeRoundtableRegistration', () => {
  it('normalizes email-only status checks', () => {
    expect(normalizeRoundtableEmailCheck({ email: '  CEO@Company.com ' })).toEqual({ email: 'ceo@company.com' })
  })

  it('normalizes standalone roundtable registration payloads', () => {
    const registration = normalizeRoundtableRegistration(
      {
        clientMeta: { path: '/survey' },
        email: 'CEO@Company.com',
        fullName: '  Nguyễn   Văn An  ',
        position: ' CEO / Tổng Giám đốc ',
        surveySubmissionIdempotencyKey: 'source4:survey-key-1',
      },
      'roundtable-key-1',
    )

    expect(registration.email).toBe('ceo@company.com')
    expect(registration.fullName).toBe('Nguyễn Văn An')
    expect(registration.idempotencyKey).toBe('roundtable-key-1')
    expect(registration.position).toBe('CEO / Tổng Giám đốc')
    expect(registration.surveySubmissionIdempotencyKey).toBe('source4:survey-key-1')
    expect(registration.payloadHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('normalizeWebinarRegistration', () => {
  it('normalizes email-only status checks', () => {
    expect(normalizeWebinarEmailCheck({ email: '  WEBINAR@Company.com ' })).toEqual({ email: 'webinar@company.com' })
  })

  it('normalizes standalone webinar registration payloads', () => {
    const registration = normalizeWebinarRegistration(
      {
        clientMeta: { path: '/' },
        companyName: '  Công ty CWI  ',
        email: 'WEBINAR@Company.com',
        fullName: '  Nguyễn   Văn An  ',
        phone: '090 123 4567',
        position: ' CEO / Tổng Giám đốc ',
        speakerQuestion: '  CEO nên bắt đầu từ đâu?  ',
      },
      'webinar-key-1',
    )

    expect(registration.companyName).toBe('Công ty CWI')
    expect(registration.email).toBe('webinar@company.com')
    expect(registration.fullName).toBe('Nguyễn Văn An')
    expect(registration.idempotencyKey).toBe('webinar-key-1')
    expect(registration.phone).toBe('+84901234567')
    expect(registration.position).toBe('CEO / Tổng Giám đốc')
    expect(registration.speakerQuestion).toBe('CEO nên bắt đầu từ đâu?')
    expect(registration.surveySubmissionIdempotencyKey).toBeNull()
    expect(registration.payloadHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires company and phone for a standalone webinar registration', () => {
    expect(() => normalizeWebinarRegistration({
      email: 'webinar@company.com',
      fullName: 'Nguyễn Văn An',
      position: 'CEO',
    }, 'webinar-key-1')).toThrow(HttpError)
  })

  it('allows the post-survey Webinar flow without duplicate contact fields', () => {
    const registration = normalizeWebinarRegistration({
      email: 'webinar@company.com',
      fullName: 'Nguyễn Văn An',
      position: 'CEO',
      surveySubmissionIdempotencyKey: 'source4:survey-key-1',
    }, 'webinar-key-1')

    expect(registration.companyName).toBeNull()
    expect(registration.phone).toBeNull()
    expect(registration.speakerQuestion).toBeNull()
  })
})

describe('buildReportObjectPaths', () => {
  it('builds stable private storage paths without participant identifiers', () => {
    const paths = buildReportObjectPaths({
      reportJobId: 'job-456',
      submissionId: 'submission-123',
      timestamp: new Date('2026-08-19T00:00:00.000Z'),
    })

    expect(paths.htmlPath).toBe('reports/2026/08/submission-123/job-456/report.html')
    expect(paths.pdfPath).toBe('reports/2026/08/submission-123/job-456/report.pdf')
    expect(`${paths.htmlPath}${paths.pdfPath}`).not.toContain('@')
  })
})

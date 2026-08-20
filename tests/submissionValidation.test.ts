import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { buildAnonymousReportPayload } from '../src/modules/reports/anonymousReportPayload.js'
import { buildReportObjectPaths } from '../src/modules/reports/reportAssetStorage.js'
import { buildReportJobRequest } from '../src/modules/reports/reportPayload.js'
import { normalizeSurveySubmission } from '../src/modules/survey/submissionValidation.js'

function partOneAnswers() {
  return [
    ...Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 })),
    { answer: 'Thiếu người kế nhiệm', idx: 17 },
    { answer: 'Phát triển năng lực quản lý', idx: 18 },
  ]
}

function allAnswers() {
  return [
    ...partOneAnswers(),
    { answer: 'Ban điều hành cùng thống nhất trước khi quyết định', idx: 19 },
    { answer: 'Chuẩn hóa quy trình và cách làm', idx: 20 },
    { answer: 'Thiếu người đủ năng lực để thay thế', idx: 21 },
    { answer: 'Khả năng thực thi', idx: 22 },
    { answer: 'Từ 300 - <1,000 tỷ VND', idx: 23 },
    { answer: 'https://example.com', idx: 24 },
  ]
}

const participant = {
  email: 'AN@Company.com',
  fullName: 'Nguyễn Văn An',
  position: 'HRM',
}

describe('normalizeSurveySubmission', () => {
  it('normalizes part1_only submissions and maps the anonymous report payload', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: partOneAnswers(),
        participant,
        privacyConsent: 'not_applicable',
        submissionStatus: 'part1_only',
      },
      'survey-key-1',
    )

    expect(submission.answers).toHaveLength(18)
    expect(submission.part1Completed).toBe(true)
    expect(submission.part2Completed).toBe(false)
    expect(submission.participant.email).toBe('an@company.com')
    expect(submission.statusNote).toContain('Phần 1')

    const reportPayload = buildAnonymousReportPayload(submission)
    expect(reportPayload.participant).toEqual({
      full_name: 'Nguyễn Văn An',
      phone_number: '00000000',
      position: 'HRM',
    })
    expect(reportPayload.cohort_consent).toBe(false)
    expect(reportPayload.answers).toHaveLength(18)
  })

  it('keeps all 24 answers for part2_refused_privacy submissions', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: allAnswers(),
        participant,
        privacyConsent: 'no',
        submissionStatus: 'part2_refused_privacy',
      },
      null,
    )

    expect(submission.answers).toHaveLength(24)
    expect(submission.part2Completed).toBe(true)
    expect(submission.privacyConsent).toBe('no')
    expect(submission.statusNote).toContain('Không đồng ý')
  })

  it('normalizes full_private_report submissions with roundtable registration', () => {
    const submission = normalizeSurveySubmission(
      {
        answers: allAnswers(),
        participant,
        privacyConsent: 'yes',
        roundtableRegistration: {
          email: 'RoundTable@Company.com',
          fullName: 'Nguyễn Văn An',
          registered: true,
        },
        submissionStatus: 'full_private_report',
      },
      null,
    )

    expect(submission.answers).toHaveLength(24)
    expect(submission.roundtableRegistration).toEqual({
      email: 'roundtable@company.com',
      fullName: 'Nguyễn Văn An',
      registered: true,
    })
    expect(submission.statusNote).toContain('Đồng ý')

    const reportJob = buildReportJobRequest(submission, { participantPhonePlaceholder: '00000000' })
    expect(reportJob.providerEndpoint).toBe('/v2/reports/personalized')
    expect(reportJob.reportType).toBe('personalized')
    expect(reportJob.requestPayload.answers).toHaveLength(23)
    expect(reportJob.requestPayload.company?.website).toBe('https://example.com')
    expect(reportJob.requestPayload.cohort_consent).toBe(true)
    expect(reportJob.requestPayload.answers.find((answer) => answer.idx === 23)?.answer).toBe('Từ 300 đến dưới 1000 tỉ VND')
  })

  it('rejects part1_only submissions that include Part 2 answers', () => {
    expect(() =>
      normalizeSurveySubmission(
        {
          answers: allAnswers(),
          participant,
          privacyConsent: 'not_applicable',
          submissionStatus: 'part1_only',
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
        },
        null,
      ),
    ).toThrow(HttpError)
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
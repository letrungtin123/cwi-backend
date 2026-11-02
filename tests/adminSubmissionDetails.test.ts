import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { PgAdminRepository } from '../src/modules/admin/adminRepository.js'

const submissionRow = {
  answers_count: 0,
  company_name: 'Công ty CWI',
  email: 'user@example.com',
  full_name: 'Nguyễn Văn A',
  id: '2c78db0b-e97e-49ca-8a9a-2565077f0ffd',
  language: 'en',
  part1_completed: true,
  part2_completed: false,
  phone: '+84901234567',
  position: 'CEO',
  privacy_consent: 'not_applicable',
  report_job_id: null,
  report_last_error_message: null,
  report_pdf_storage_path: null,
  report_pdf_uploaded: true,
  report_status: null,
  report_updated_at: null,
  roundtable_registered: false,
  status_note: 'Hoàn thành Phần 1.',
  submitted_at: new Date('2026-08-27T00:00:00.000Z'),
  submission_status: 'part1_only',
  survey_version: '2026Q3',
}

function createRepository() {
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql.includes('count(*)::text AS total_items')) return { rows: [{ total_items: '1' }] }
    if (sql.includes('cwi_survey_answers')) return { rows: [] }
    if (sql.includes('cwi_roundtable_registrations')) return { rows: [] }
    return { rows: [submissionRow] }
  })

  return {
    query,
    repository: new PgAdminRepository({ query } as unknown as pg.Pool, 'test-secret'),
  }
}

describe('full submission PDF status', () => {
  it('returns the upload flag and applies the true filter to page and count queries', async () => {
    const { query, repository } = createRepository()

    const result = await repository.listSubmissionDetails({
      limit: 10,
      page: 1,
      reportStatus: null,
      reportPdfUploaded: true,
      roundtableRegistered: null,
      search: null,
      status: null,
    })

    expect(result.items[0]?.reportPdfUploaded).toBe(true)
    expect(result.items[0]?.phone).toBe('+84901234567')
    const submissionQueries = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('report_pdf_uploaded') || sql.includes('cwi_submission_report_files'))
    expect(submissionQueries).toHaveLength(2)
    expect(submissionQueries.every((sql) => sql.includes('EXISTS'))).toBe(true)
  })

  it('uses NOT EXISTS for the false filter', async () => {
    const { query, repository } = createRepository()

    await repository.listSubmissionDetails({
      limit: 10,
      page: 1,
      reportStatus: null,
      reportPdfUploaded: false,
      roundtableRegistered: null,
      search: null,
      status: null,
    })

    const submissionQueries = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('report_pdf_uploaded') || sql.includes('cwi_submission_report_files'))
    expect(submissionQueries).toHaveLength(2)
    expect(submissionQueries.every((sql) => sql.includes('NOT EXISTS'))).toBe(true)
  })

  it('applies the PDF filter to the cursor page query', async () => {
    const { query, repository } = createRepository()

    await repository.listSubmissionsPage({
      before: null,
      beforeId: null,
      limit: 10,
      reportStatus: null,
      reportPdfUploaded: false,
      roundtableRegistered: null,
      search: null,
      status: null,
    })

    const pageQuery = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes('ORDER BY s.submitted_at DESC, s.id DESC'))
    expect(pageQuery).toContain('NOT EXISTS')
    expect(pageQuery).toContain('cwi_submission_report_files')
  })

  it('filters by the latest report generation status in page and count queries', async () => {
    const { query, repository } = createRepository()

    await repository.listSubmissionDetails({
      limit: 10,
      page: 1,
      reportStatus: 'failed',
      reportPdfUploaded: null,
      roundtableRegistered: null,
      search: null,
      status: null,
    })

    const reportStatusQueries = query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('latest_report.status::text'))
    expect(reportStatusQueries).toHaveLength(2)
    expect(reportStatusQueries.every((sql) => sql.includes("= $1"))).toBe(true)
    expect(query.mock.calls.some(([, params]) => params?.[0] === 'failed')).toBe(true)
  })
})

describe('submission survey version filter', () => {
  it('filters the cursor page and returns the stored question set', async () => {
    const { query, repository } = createRepository()

    const result = await repository.listSubmissionsPage({
      before: null,
      beforeId: null,
      limit: 10,
      reportStatus: null,
      reportPdfUploaded: null,
      roundtableRegistered: null,
      search: null,
      status: null,
      surveyVersion: '2026Q3',
    })

    expect(result.items[0]?.surveyVersion).toBe('2026Q3')
    expect(result.items[0]?.language).toBe('en')
    const [pageQuery, pageParams] = query.mock.calls.find(([sql]) => sql.includes('ORDER BY s.submitted_at DESC, s.id DESC')) ?? []
    expect(pageQuery).toContain('s.language')
    expect(pageQuery).toContain('s.survey_version = $1')
    expect(pageParams?.[0]).toBe('2026Q3')
  })

  it('applies the filter to the full list page and count queries', async () => {
    const { query, repository } = createRepository()

    await repository.listSubmissionDetails({
      limit: 10,
      page: 1,
      reportStatus: null,
      reportPdfUploaded: null,
      roundtableRegistered: null,
      search: null,
      status: null,
      surveyVersion: '2026Q4',
    })

    const versionQueries = query.mock.calls.filter(([sql]) => sql.includes('s.survey_version = $1'))
    expect(versionQueries).toHaveLength(2)
    expect(versionQueries.every(([, params]) => params?.[0] === '2026Q4')).toBe(true)
  })
})

describe('submission detail language', () => {
  const answerRows = [
    { submission_id: submissionRow.id, question_idx: 1, part: 1, question_type: 'likert', question_text: 'Chúng tôi có đủ năng lực để thích ứng nhanh trước thay đổi của thị trường.', answer_value: 5, answer_text: '5', other_text: null },
    { submission_id: submissionRow.id, question_idx: 17, part: 1, question_type: 'mcq', question_text: 'Trong 12 tháng tới, rủi ro lớn nhất cản trở doanh nghiệp của anh/chị trở nên sẵn sàng cho tương lai (Future-Ready) là gì?', answer_value: 'Khác.', answer_text: 'Khác.', other_text: 'Supply chain' },
    { submission_id: submissionRow.id, question_idx: 24, part: 2, question_type: 'text', question_text: 'Website chính thức của công ty', answer_value: 'https://example.com', answer_text: 'https://example.com', other_text: null },
  ]

  function createDetailRepository(language: string) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('cwi_survey_answers')) return { rows: answerRows }
      if (sql.includes('cwi_roundtable_registrations')) return { rows: [] }
      return { rows: [{ ...submissionRow, language }] }
    })
    return new PgAdminRepository({ query } as unknown as pg.Pool, 'test-secret')
  }

  it('shows a survey taken in English in English, keeping scores and free text as stored', async () => {
    const detail = await createDetailRepository('en').getSubmission(submissionRow.id)

    expect(detail.language).toBe('en')
    expect(detail.answers.map((answer) => [answer.questionText, answer.answerText, answer.otherText])).toEqual([
      ['We have the capability to adapt quickly to market changes.', '5', null],
      ['In the next 12 months, what is the biggest risk preventing your company from becoming Future-Ready?', 'Other.', 'Supply chain'],
      ["Your company's official website", 'https://example.com', null],
    ])
    expect(detail.answers[1]?.answerValue).toBe('Khác.')
  })

  it('shows a survey taken in Vietnamese exactly as stored', async () => {
    const detail = await createDetailRepository('vi').getSubmission(submissionRow.id)

    expect(detail.answers.map((answer) => [answer.questionText, answer.answerText])).toEqual(answerRows.map((answer) => [answer.question_text, answer.answer_text]))
  })
})

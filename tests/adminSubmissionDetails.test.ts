import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { PgAdminRepository } from '../src/modules/admin/adminRepository.js'

const submissionRow = {
  answers_count: 0,
  email: 'user@example.com',
  full_name: 'Nguyễn Văn A',
  id: '2c78db0b-e97e-49ca-8a9a-2565077f0ffd',
  part1_completed: true,
  part2_completed: false,
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
}

function createRepository() {
  const query = vi.fn(async (sql: string) => {
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
      reportPdfUploaded: true,
      roundtableRegistered: null,
      search: null,
      status: null,
    })

    expect(result.items[0]?.reportPdfUploaded).toBe(true)
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
})

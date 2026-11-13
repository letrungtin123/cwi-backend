import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PgAdminRepository, type ReportStatusFilter, type SubmissionListFilters } from '../../src/modules/admin/adminRepository.js'
import { PgRoundtableRepository } from '../../src/modules/roundtable/roundtableRepository.js'
import { normalizeRoundtableRegistration } from '../../src/modules/roundtable/roundtableValidation.js'
import { normalizeSurveySubmission } from '../../src/modules/survey/submissionValidation.js'
import { SURVEY_VERSION } from '../../src/modules/survey/surveyQuestions.js'
import { PgSurveyRepository } from '../../src/modules/survey/surveyRepository.js'
import { PgWebinarRepository } from '../../src/modules/webinar/webinarRepository.js'
import { normalizeWebinarRegistration } from '../../src/modules/webinar/webinarValidation.js'
import { databaseReachable, openRollbackDb, type RollbackDb } from './rollbackDb.js'

// Runs the dashboard's SQL against the real local schema. Every write is rolled back.

const reachable = await databaseReachable()

const meta = { clientIpHash: null, idempotencyKey: null, source: 'db-test', userAgent: 'vitest' }

function baseFilters(overrides: Partial<SubmissionListFilters> = {}): SubmissionListFilters {
  return { before: null, beforeId: null, limit: 10, reportPdfUploaded: null, reportStatus: null, roundtableRegistered: null, search: null, status: null, ...overrides }
}

function surveyAnswers() {
  return [
    ...Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 })),
    { answer: 'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.', idx: 17 },
    { answer: 'Đưa AI vào quá trình ra quyết định của Ban điều hành.', idx: 18 },
    { answer: 'Các phòng ban phối hợp chậm chạp, có xu hướng đùn đẩy trách nhiệm.', idx: 19 },
    { answer: 'Chủ yếu ứng dụng để cắt giảm chi phí và thay thế các tác vụ thủ công.', idx: 20 },
    { answer: 'Cấu trúc tổ chức hiện tại quá cứng nhắc để tích hợp công nghệ mới.', idx: 21 },
    { answer: 'Có hệ thống báo cáo nhưng thường chậm trễ, chỉ phản ánh dữ liệu quá khứ.', idx: 22 },
    { answer: 'Từ 300 - <1000 tỉ VND', idx: 23 },
    { answer: 'https://example.com', idx: 24 },
  ]
}

describe.skipIf(!reachable)('admin queries on the local database (rolled back)', () => {
  let db: RollbackDb
  let admin: PgAdminRepository
  // A unique address per run, so searches find only what the test created.
  let email: string

  beforeAll(() => {
    expect(reachable).toBe(true)
  })

  beforeEach(async () => {
    db = await openRollbackDb()
    admin = new PgAdminRepository(db.pool, 'db-test-cursor-secret-0123456789abcdef')
    email = `dbtest-${randomUUID().slice(0, 8)}@example.test`
  })

  afterEach(async () => {
    await db.close()
  })

  async function createSubmission(roundtable: boolean) {
    const submission = normalizeSurveySubmission({
      answers: surveyAnswers(),
      participant: { companyName: 'Công ty Thử nghiệm', email, fullName: 'Người Thử Nghiệm', phone: '0901234567', position: 'CEO' },
      privacyConsent: 'yes',
      ...(roundtable ? { roundtableRegistration: { email, fullName: 'Người Thử Nghiệm', registered: true } } : {}),
      submissionStatus: 'full_private_report',
      surveyVersion: SURVEY_VERSION,
    }, `dbtest:${randomUUID()}`)
    return new PgSurveyRepository(db.pool).createSubmission(submission, meta, null)
  }

  it('lists, searches and opens a new survey submission', async () => {
    const created = await createSubmission(false)
    const page = await admin.listSubmissionsPage(baseFilters({ search: email }))
    expect(page.items.map((item) => item.id)).toEqual([created.id])
    expect(page.items[0]).toMatchObject({ email, language: 'vi', submissionStatus: 'full_private_report', surveyVersion: SURVEY_VERSION })

    const detail = await admin.getSubmission(created.id)
    expect(detail.answers).toHaveLength(24)
    expect(detail.answers.every((answer) => answer.questionText.length > 0)).toBe(true)

    const filtered = await admin.listSubmissionsPage(baseFilters({ search: email, status: 'part1_only' }))
    expect(filtered.items).toHaveLength(0)
  })

  it('runs every submission filter the dashboard can send', async () => {
    await createSubmission(true)
    const reportStatuses: ReportStatusFilter[] = ['not_started', 'generating', 'completed', 'failed', 'skipped']
    const variants: Array<Partial<SubmissionListFilters>> = [
      {},
      ...reportStatuses.map((reportStatus) => ({ reportStatus })),
      { emailStatus: 'failed' },
      { reportPdfUploaded: true },
      { reportPdfUploaded: false },
      { roundtableRegistered: true },
      { sourceId: 'none' },
      { sourceId: randomUUID() },
      { surveyVersion: SURVEY_VERSION },
      { status: 'full_private_report' },
      { search: 'example' },
    ]
    for (const variant of variants) {
      const page = await admin.listSubmissionsPage(baseFilters({ limit: 5, ...variant }))
      expect(page.items.length, JSON.stringify(variant)).toBeLessThanOrEqual(5)
    }

    const mine = await admin.listSubmissionsPage(baseFilters({ roundtableRegistered: true, search: email }))
    expect(mine.items).toHaveLength(1)
    expect(mine.items[0]!.roundtableRegistered).toBe(true)
  })

  it('pages through submissions newest first without repeats', async () => {
    const first = await admin.listSubmissionsPage(baseFilters({ limit: 3 }))
    if (!first.hasNextPage) return
    const [last] = first.items.slice(-1)
    const second = await admin.listSubmissionsPage(baseFilters({ before: new Date(last!.submittedAt), beforeId: last!.id, limit: 3 }))
    const firstIds = new Set(first.items.map((item) => item.id))
    expect(second.items.some((item) => firstIds.has(item.id))).toBe(false)
    expect(Date.parse(second.items[0]!.submittedAt)).toBeLessThanOrEqual(Date.parse(last!.submittedAt))
  })

  it('counts submissions per question set', async () => {
    const before = await admin.getSubmissionStats(SURVEY_VERSION)
    await createSubmission(false)
    const after = await new PgAdminRepository(db.pool, 'db-test-cursor-secret-0123456789abcdef').getSubmissionStats(SURVEY_VERSION)
    expect(after.totalSubmissions).toBe(before.totalSubmissions + 1)
    expect(after.fullPrivateReport).toBe(before.fullPrivateReport + 1)
    expect(after.surveyVersions.some((row) => row.surveyVersion === SURVEY_VERSION)).toBe(true)
  })

  it('links a survey roundtable registration and shows it in the roundtable list', async () => {
    const created = await createSubmission(true)
    const linked = await admin.listRoundtableRegistrationsPage({ before: null, beforeId: null, limit: 10, linkStatus: 'linked', search: email })
    expect(linked.items).toHaveLength(1)
    expect(linked.items[0]!.linkedSubmission?.id).toBe(created.id)

    const detail = await admin.getRoundtableRegistration(linked.items[0]!.id)
    expect(detail.email).toBe(email)
    const standalone = await admin.listRoundtableRegistrationsPage({ before: null, beforeId: null, limit: 10, linkStatus: 'standalone', search: email })
    expect(standalone.items).toHaveLength(0)
    const stats = await admin.getRoundtableRegistrationStats()
    expect(stats.totalRegistrations).toBeGreaterThanOrEqual(1)
  })

  it('stores a standalone roundtable registration for the current quarter', async () => {
    const registration = normalizeRoundtableRegistration({
      clientMeta: { path: '/' }, companyName: 'Công ty Thử nghiệm', email, fullName: 'Khách Thử Nghiệm', phone: '0901234567', position: 'CEO',
    }, `dbtest:${randomUUID()}`)
    const created = await new PgRoundtableRepository(db.pool).createRegistration(registration, meta)
    const page = await admin.listRoundtableRegistrationsPage({ before: null, beforeId: null, limit: 10, linkStatus: 'standalone', quarter: registration.quarter, search: email })
    expect(page.items.map((item) => item.id)).toEqual([created.id])
    expect(page.items[0]!.quarter).toBe(registration.quarter)
  })

  it('stores a webinar registration and reads it through the webinar queries', async () => {
    const registration = normalizeWebinarRegistration({
      clientMeta: { path: '/' }, companyName: 'Công ty Thử nghiệm', email, fullName: 'Khách Webinar', phone: '0901234567', position: 'CEO', speakerQuestion: 'CEO nên bắt đầu từ đâu?',
    }, `dbtest:${randomUUID()}`)
    const created = await new PgWebinarRepository(db.pool).createRegistration(registration, meta)

    const page = await admin.listWebinarRegistrationsPage({ before: null, beforeId: null, limit: 10, linkStatus: null, search: email })
    expect(page.items.map((item) => item.id)).toEqual([created.id])
    // The webinar list is built from the roundtable SQL; these columns prove the swap worked.
    expect(page.items[0]).toMatchObject({ quarter: null, speakerQuestion: 'CEO nên bắt đầu từ đâu?' })

    const detail = await admin.getWebinarRegistration(created.id)
    expect(detail.fullName).toBe('Khách Webinar')
    const stats = await admin.getWebinarRegistrationStats()
    expect(stats.totalRegistrations).toBeGreaterThanOrEqual(1)
  })

  it('answers 404 for an id that does not exist', async () => {
    await expect(admin.getSubmission(randomUUID())).rejects.toMatchObject({ code: 'submission_not_found', statusCode: 404 })
    await expect(admin.getWebinarRegistration(randomUUID())).rejects.toMatchObject({ code: 'webinar_registration_not_found' })
  })
})

describe('database test guard', () => {
  it('reports whether the local database was reachable', () => {
    // Shown in the summary so a skipped suite is never mistaken for a passing one.
    console.info(reachable ? 'local database reachable: suite ran' : 'local database NOT reachable: suite skipped')
    expect(typeof reachable).toBe('boolean')
  })
})

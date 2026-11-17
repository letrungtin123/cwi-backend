import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuditActor } from '../../src/modules/audit/adminAuditLog.js'
import type { AdminUser } from '../../src/modules/auth/authTypes.js'
import { PgAdminRepository } from '../../src/modules/admin/adminRepository.js'
import { buildReportJobRequest } from '../../src/modules/reports/reportPayload.js'
import { PgReportRepository } from '../../src/modules/reports/reportRepository.js'
import { normalizeSurveySubmission } from '../../src/modules/survey/submissionValidation.js'
import { PgSurveyRepository } from '../../src/modules/survey/surveyRepository.js'
import { PgSurveyQuarterRepository, type SurveyQuarter } from '../../src/modules/surveyQuarters/surveyQuarterRepository.js'
import { toPublicSurveyQuarters } from '../../src/modules/surveyQuarters/surveyQuarterRoutes.js'
import { databaseReachable, openRollbackDb, type RollbackDb } from './rollbackDb.js'

// Per-quarter report switch, card list and audit against the real local schema
// (migration 20261117_0000_add_survey_quarters.sql). Every write is rolled back.

const reachable = await databaseReachable()
const meta = { clientIpHash: null, idempotencyKey: null, source: 'db-test', userAgent: 'vitest' }

function answers(version: '2026Q3' | '2026Q4') {
  const likert = Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 }))
  return version === '2026Q3'
    ? [...likert, { answer: 'Thiếu người kế nhiệm', idx: 17 }, { answer: 'Xây dựng đội ngũ kế nhiệm', idx: 18 }]
    : [...likert, { answer: 'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.', idx: 17 }, { answer: 'Đưa AI vào quá trình ra quyết định của Ban điều hành.', idx: 18 }]
}

describe.skipIf(!reachable)('survey quarters on the local database (rolled back)', () => {
  let db: RollbackDb
  let quarters: PgSurveyQuarterRepository
  let reports: PgReportRepository
  let actor: AuditActor

  beforeEach(async () => {
    db = await openRollbackDb()
    quarters = new PgSurveyQuarterRepository(db.pool)
    reports = new PgReportRepository(db.pool)
    // Jobs left over from local development must not be claimed by these tests.
    await db.pool.query(`UPDATE public.cwi_report_jobs SET status = 'skipped' WHERE status IN ('pending', 'queued_ai', 'generating_ai', 'rendering_assets', 'html_ready', 'generating_pdf')`)
    await db.pool.query(`UPDATE public.cwi_report_generation_settings SET ai_calls_enabled = true`)
    // The audit log needs a real admin account; the local database has the developer's.
    const adminRow = await db.pool.query<{ display_name: string | null; email: string; id: string; role: string }>(
      `SELECT id, email, display_name, role FROM public.cwi_admin_users ORDER BY created_at LIMIT 1`,
    )
    const user = adminRow.rows[0]
    if (!user) throw new Error('The local database needs at least one dashboard account for this test.')
    actor = { meta: { clientIpHash: null, userAgent: 'vitest' }, user: { displayName: user.display_name, email: user.email, id: user.id, role: user.role } as AdminUser }
  })

  afterEach(async () => {
    await db.close()
  })

  async function submit(version: '2026Q3' | '2026Q4') {
    const submission = normalizeSurveySubmission({
      answers: answers(version),
      participant: { companyName: 'Công ty Thử nghiệm', email: `dbtest-${randomUUID().slice(0, 8)}@example.test`, fullName: 'Người Thử Nghiệm', phone: '0901234567', position: 'CEO' },
      privacyConsent: 'not_applicable',
      submissionStatus: 'part1_only',
      surveyVersion: version,
    }, `dbtest:${randomUUID()}`)
    return new PgSurveyRepository(db.pool).createSubmission(submission, meta, buildReportJobRequest(submission))
  }

  function quarterInput(quarter: SurveyQuarter, overrides: Partial<{ deferredResultDays: number; isVisible: boolean; reportGenerationEnabled: boolean }>) {
    return {
      deferredResultDays: quarter.deferredResultDays,
      description: quarter.description,
      isVisible: quarter.isVisible,
      reportGenerationEnabled: quarter.reportGenerationEnabled,
      sortOrder: quarter.sortOrder,
      title: quarter.title,
      ...overrides,
    }
  }

  it('has the two seeded quarters with report creation on', async () => {
    const list = await quarters.list()
    expect(list.map((quarter) => [quarter.surveyVersion, quarter.isVisible, quarter.reportGenerationEnabled, quarter.supported])).toEqual([
      ['2026Q3', true, true, true],
      ['2026Q4', true, true, true],
    ])
    expect((await quarters.getPage()).title.vi).toBe('Khảo sát theo quý')
  })

  it('stores a 2026Q3 submission with a job on the 2026-q3 route', async () => {
    const created = await submit('2026Q3')
    const row = await db.pool.query<{ provider_endpoint: string; survey_version: string }>(
      `SELECT job.provider_endpoint, submission.survey_version FROM public.cwi_report_jobs AS job JOIN public.cwi_survey_submissions AS submission ON submission.id = job.submission_id WHERE job.id = $1`,
      [created.reportJob?.id],
    )
    expect(row.rows[0]).toEqual({ provider_endpoint: '/v3/editions/2026-q3/reports/anonymous', survey_version: '2026Q3' })
  })

  it('keeps the jobs of a quarter that is turned off waiting, and claims the other quarter', async () => {
    const q3 = await submit('2026Q3')
    const q4 = await submit('2026Q4')
    const before = await quarters.get('2026Q3')
    await quarters.update('2026Q3', quarterInput(before, { deferredResultDays: 5, reportGenerationEnabled: false }), actor)

    const claimed = await reports.claimNextReadyJob('db-test-worker', 300000, 3)
    expect(claimed?.id).toBe(q4.reportJob?.id)
    await db.pool.query(`UPDATE public.cwi_report_jobs SET locked_at = NULL, locked_by = NULL, status = 'skipped' WHERE id = $1`, [claimed?.id])
    expect(await reports.claimNextReadyJob('db-test-worker', 300000, 3)).toBeNull()

    expect(await reports.getEffectiveGenerationSettings({ surveyVersion: '2026Q3' })).toMatchObject({ aiCallsEnabled: false, deferredResultDays: 5 })
    expect(await reports.getEffectiveGenerationSettings({ jobId: q3.reportJob!.id })).toMatchObject({ aiCallsEnabled: false, deferredResultDays: 5 })
    expect(await reports.getEffectiveGenerationSettings({ surveyVersion: '2026Q4' })).toMatchObject({ aiCallsEnabled: true, deferredResultDays: 7 })

    const admin = new PgAdminRepository(db.pool, 'db-test-cursor-secret-0123456789abcdef')
    expect((await admin.getSubmission(q3.id)).report).toMatchObject({ generationPaused: true })

    await quarters.update('2026Q3', quarterInput(await quarters.get('2026Q3'), { reportGenerationEnabled: true }), actor)
    expect((await reports.claimNextReadyJob('db-test-worker', 300000, 3))?.id).toBe(q3.reportJob?.id)
  })

  it('does not let reports already at cwi-ai for a turned-off quarter block the other quarter', async () => {
    const sent = [await submit('2026Q4'), await submit('2026Q4'), await submit('2026Q4')]
    await db.pool.query(
      `UPDATE public.cwi_report_jobs SET status = 'queued_ai', next_poll_at = now() + interval '1 hour' WHERE id = ANY($1::uuid[])`,
      [sent.map((created) => created.reportJob!.id)],
    )
    const q3 = await submit('2026Q3')

    // Quarter 4 on: its three reports at cwi-ai fill the limit of 3, so the new one waits.
    expect(await reports.claimNextReadyJob('db-test-worker', 300000, 3)).toBeNull()

    // Quarter 4 off: its reports stay untouched and no longer count against the limit.
    await quarters.update('2026Q4', quarterInput(await quarters.get('2026Q4'), { reportGenerationEnabled: false }), actor)
    expect((await reports.claimNextReadyJob('db-test-worker', 300000, 3))?.id).toBe(q3.reportJob?.id)
  })

  it('applies the global stop from .env to every quarter', async () => {
    expect(await reports.syncGlobalPause(true)).toBe(true)
    expect(await reports.syncGlobalPause(true)).toBe(false)
    expect(await reports.getEffectiveGenerationSettings({ surveyVersion: '2026Q4' })).toMatchObject({ aiCallsEnabled: false, deferredResultDays: 7 })
    expect((await reports.getGenerationSettings()).aiCallsEnabled).toBe(false)
    expect(await reports.syncGlobalPause(false)).toBe(true)
    expect((await reports.getGenerationSettings()).aiCallsEnabled).toBe(true)
  })

  it('hides a quarter from the landing page and writes the change to the audit log', async () => {
    const before = await quarters.get('2026Q3')
    await quarters.update('2026Q3', quarterInput(before, { isVisible: false }), actor)
    const shown = toPublicSurveyQuarters(await quarters.getPage(), await quarters.list())
    expect(shown.quarters.map((quarter) => [quarter.surveyVersion, quarter.isCurrent])).toEqual([['2026Q4', true]])

    const history = await quarters.history('2026Q3')
    expect(history[0]).toMatchObject({ action: 'survey_quarter.update', metadata: expect.objectContaining({ changes: { isVisible: { from: true, to: false } } }) })

    // Saving with nothing changed writes nothing.
    await quarters.update('2026Q3', quarterInput(await quarters.get('2026Q3'), {}), actor)
    expect(await quarters.history('2026Q3')).toHaveLength(history.length)
  })

  it('sets and clears a card image, returning the previous one', async () => {
    const image = { contentType: 'image/png', sha256: 'b'.repeat(64), storagePath: 'quarters/2026Q4/test.png' }
    // The local database may already hold an image uploaded while trying the dashboard.
    const existing = (await quarters.get('2026Q4')).image
    const first = await quarters.setImage('2026Q4', image, actor)
    expect(first.previous).toEqual(existing)
    expect(first.quarter.image).toEqual(image)
    const cleared = await quarters.setImage('2026Q4', null, actor)
    expect(cleared.previous).toEqual(image)
    expect(cleared.quarter.image).toBeNull()
  })

  it('saves the heading above the cards', async () => {
    const page = await quarters.getPage()
    const saved = await quarters.updatePage({ ...page, title: { en: 'Surveys by quarter', vi: 'Khảo sát theo từng quý' } }, actor)
    expect(saved.title).toEqual({ en: 'Surveys by quarter', vi: 'Khảo sát theo từng quý' })
  })
})

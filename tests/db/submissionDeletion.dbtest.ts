import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuditActor } from '../../src/modules/audit/adminAuditLog.js'
import type { AdminUser } from '../../src/modules/auth/authTypes.js'
import { PgAdminRepository } from '../../src/modules/admin/adminRepository.js'
import { buildReportJobRequest } from '../../src/modules/reports/reportPayload.js'
import { PgSubmissionDeletionRepository } from '../../src/modules/submissionDeletion/submissionDeletionRepository.js'
import { normalizeSurveySubmission } from '../../src/modules/survey/submissionValidation.js'
import { PgSurveyRepository } from '../../src/modules/survey/surveyRepository.js'
import { databaseReachable, openRollbackDb, type RollbackDb } from './rollbackDb.js'

// Deleting waiting submissions (super admins), against the real local schema. Every write is
// rolled back. Since the per-quarter report switches the global switch stays on and a quarter is
// paused with its own switch, so the quarter switch alone must make its waiting rows deletable.

const reachable = await databaseReachable()
const meta = { clientIpHash: null, idempotencyKey: null, source: 'db-test', userAgent: 'vitest' }

function answers(version: '2026Q3' | '2026Q4') {
  const likert = Array.from({ length: 16 }, (_unused, index) => ({ answer: (index % 5) + 1, idx: index + 1 }))
  return version === '2026Q3'
    ? [...likert, { answer: 'Thiếu người kế nhiệm', idx: 17 }, { answer: 'Xây dựng đội ngũ kế nhiệm', idx: 18 }]
    : [...likert, { answer: 'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.', idx: 17 }, { answer: 'Đưa AI vào quá trình ra quyết định của Ban điều hành.', idx: 18 }]
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    const { code, statusCode } = error as { code?: string; statusCode?: number }
    return `${statusCode} ${code}`
  }
  return 'resolved'
}

describe.skipIf(!reachable)('deleting waiting submissions on the local database (rolled back)', () => {
  let db: RollbackDb
  let deletion: PgSubmissionDeletionRepository
  let admin: PgAdminRepository
  let actor: AuditActor

  beforeEach(async () => {
    db = await openRollbackDb()
    deletion = new PgSubmissionDeletionRepository(db.pool)
    admin = new PgAdminRepository(db.pool, 'db-test-cursor-secret-0123456789abcdef')
    // The state on prod since 2026-11-17: global switch on, Quarter 3 on, Quarter 4 off.
    await db.pool.query(`UPDATE public.cwi_report_generation_settings SET ai_calls_enabled = true`)
    await db.pool.query(`UPDATE public.cwi_survey_quarters SET report_generation_enabled = (survey_version <> '2026Q4')`)
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

  async function exists(id: string) {
    const result = await db.pool.query('SELECT 1 FROM public.cwi_survey_submissions WHERE id = $1', [id])
    return result.rowCount === 1
  }

  it('deletes a waiting submission of a quarter that is turned off while the global switch is on', async () => {
    const q4 = await submit('2026Q4')
    const listed = await admin.getSubmission(q4.id)
    expect(listed.report).toMatchObject({ generationPaused: true, label: 'Chờ tạo báo cáo' })
    expect((await deletion.preview([q4.id]))[0]?.deletable).toBe(true)

    expect(await deletion.delete([q4.id], actor)).toEqual({ deleted: 1 })
    expect(await exists(q4.id)).toBe(false)
    const audit = await db.pool.query(`SELECT 1 FROM public.cwi_admin_audit_logs WHERE target_id = $1 AND action = 'survey_submission.delete'`, [q4.id])
    expect(audit.rowCount).toBe(1)
  })

  it('keeps submissions of a quarter whose report creation is on', async () => {
    const q3 = await submit('2026Q3')
    const q4 = await submit('2026Q4')
    expect((await deletion.preview([q3.id]))[0]?.deletable).toBe(false)
    // All or nothing: the Quarter 4 row is not deleted either.
    expect(await rejection(deletion.delete([q3.id, q4.id], actor))).toBe('409 submission_not_deletable')
    expect(await exists(q3.id)).toBe(true)
    expect(await exists(q4.id)).toBe(true)
  })

  it('keeps a waiting submission whose report was already sent to cwi-ai', async () => {
    const q4 = await submit('2026Q4')
    await db.pool.query(`UPDATE public.cwi_report_jobs SET status = 'queued_ai', ai_status = 'queued', ai_job_id = 'db-test-ai-job' WHERE id = $1`, [q4.reportJob!.id])
    expect((await admin.getSubmission(q4.id)).report).toMatchObject({ label: 'Chờ tạo báo cáo' })
    expect((await deletion.preview([q4.id]))[0]?.deletable).toBe(false)
    expect(await rejection(deletion.delete([q4.id], actor))).toBe('409 submission_not_deletable')
    expect(await exists(q4.id)).toBe(true)
  })

  it('still deletes when only the global switch is off', async () => {
    await db.pool.query(`UPDATE public.cwi_report_generation_settings SET ai_calls_enabled = false`)
    await db.pool.query(`UPDATE public.cwi_survey_quarters SET report_generation_enabled = true`)
    const q3 = await submit('2026Q3')
    expect(await deletion.delete([q3.id], actor)).toEqual({ deleted: 1 })
  })

  it('keeps every submission once report creation is on for its quarter again', async () => {
    const q4 = await submit('2026Q4')
    await db.pool.query(`UPDATE public.cwi_survey_quarters SET report_generation_enabled = true WHERE survey_version = '2026Q4'`)
    expect((await deletion.preview([q4.id]))[0]?.deletable).toBe(false)
    expect(await rejection(deletion.delete([q4.id], actor))).toBe('409 submission_not_deletable')
  })
})

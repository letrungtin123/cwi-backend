import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AuditActor } from '../../src/modules/audit/adminAuditLog.js'
import type { AdminUser } from '../../src/modules/auth/authTypes.js'
import { PgQuarterlyReportRepository } from '../../src/modules/quarterlyReports/quarterlyReportRepository.js'
import { toPublicQuarterlyReports } from '../../src/modules/quarterlyReports/quarterlyReportRoutes.js'
import { normalizeQuarterlyReportDownload } from '../../src/modules/quarterlyReports/quarterlyReportValidation.js'
import { PgSurveySourceRepository } from '../../src/modules/surveySources/surveySourceRepository.js'
import { databaseReachable, openRollbackDb, type RollbackDb } from './rollbackDb.js'

// Quarterly report cards (VI + EN PDF per quarter) and per-quarter source counts against the
// real local schema (migration 20261117_0100_quarterly_report_cards.sql). Every write is
// rolled back.

const reachable = await databaseReachable()
const meta = { clientIpHash: null, idempotencyKey: null, source: 'db-test', userAgent: 'vitest' }

function pdf(name: string) {
  return { fileName: name, fileSize: 1234, sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'), storageBucket: 'cwi-quarterly-report-pdfs', storagePath: `quarterly/test/${randomUUID()}.pdf` }
}

describe.skipIf(!reachable)('quarterly report cards on the local database (rolled back)', () => {
  let db: RollbackDb
  let reports: PgQuarterlyReportRepository
  let actor: AuditActor

  beforeEach(async () => {
    db = await openRollbackDb()
    reports = new PgQuarterlyReportRepository(db.pool, 'db-test-cursor-secret-0123456789abcdef')
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

  async function legacyActive() {
    const result = await db.pool.query<{ slug: string }>('SELECT slug FROM public.cwi_quarterly_reports WHERE is_active')
    return result.rows.map((row) => row.slug)
  }

  it('creates a hidden quarter without files, listed only once it is visible with a PDF', async () => {
    const created = await reports.create({ periodQuarter: 1, periodYear: 2027 }, actor)
    expect(created).toMatchObject({ files: { en: null, vi: null }, isVisible: false, slug: 'q1-2027', title: { en: 'CEO Workforce Index Report Q1 2027', vi: 'Báo cáo CEO Workforce Index Quý 1/2027' } })
    await expect(reports.create({ periodQuarter: 1, periodYear: 2027 }, actor)).rejects.toMatchObject({ code: 'quarterly_report_exists' })

    const shown = await reports.update('q1-2027', { description: created.description, isVisible: true, sortOrder: created.sortOrder, title: created.title }, actor)
    expect(shown.isVisible).toBe(true)
    // Visible but no PDF yet: not on the page, and the previous release keeps its report.
    expect(await reports.findListed('q1-2027')).toBeNull()
    const before = await legacyActive()

    const { previous, report } = await reports.setFile('q1-2027', 'en', pdf('Report Q1 2027.pdf'), actor)
    expect(previous).toBeNull()
    expect(report.files.en?.fileName).toBe('Report Q1 2027.pdf')
    expect((await reports.findListed('q1-2027'))?.slug).toBe('q1-2027')
    // Only an English PDF: the previous release cannot show it, so is_active does not move.
    expect(await legacyActive()).toEqual(before)

    await reports.setFile('q1-2027', 'vi', pdf('Bao cao Q1 2027.pdf'), actor)
    expect(await legacyActive()).toEqual(['q1-2027'])

    const listed = toPublicQuarterlyReports(await reports.getPage(), await reports.list())
    const card = listed.reports.find((item) => item.slug === 'q1-2027')
    expect(card).toMatchObject({ isCurrent: true, languages: ['vi', 'en'] })

    const replaced = await reports.setFile('q1-2027', 'en', pdf('Report Q1 2027 v2.pdf'), actor)
    expect(replaced.previous?.fileName).toBe('Report Q1 2027.pdf')
    const removed = await reports.setFile('q1-2027', 'en', null, actor)
    expect(removed.previous?.fileName).toBe('Report Q1 2027 v2.pdf')
    expect(removed.report.files.en).toBeNull()

    // Written in one test transaction, so they share a timestamp: compare without order.
    const history = await reports.history('q1-2027')
    expect(history.map((entry) => entry.action).sort()).toEqual([
      'quarterly_report.create',
      'quarterly_report.file_remove',
      'quarterly_report.file_upload',
      'quarterly_report.file_upload',
      'quarterly_report.file_upload',
      'quarterly_report.update',
    ])

    // Hiding it hands is_active back to the newest other listed quarter.
    await reports.update('q1-2027', { description: created.description, isVisible: false, sortOrder: created.sortOrder, title: created.title }, actor)
    expect(await legacyActive()).not.toContain('q1-2027')
  })

  it('records which PDF a person downloaded', async () => {
    await reports.create({ periodQuarter: 2, periodYear: 2027 }, actor)
    const { report } = await reports.setFile('q2-2027', 'vi', pdf('Bao cao.pdf'), actor)
    const lead = normalizeQuarterlyReportDownload({ email: `dbtest-${randomUUID().slice(0, 8)}@example.test`, fullName: 'Người Thử', language: 'en', phone: '0901234567', position: 'CEO', privacyConsent: true }, null)
    const first = await reports.registerDownload(report, lead, meta)
    const again = await reports.registerDownload(report, { ...lead, language: 'vi' }, meta)
    expect(again).toMatchObject({ deduplicated: true, id: first.id })

    expect(await reports.markDownloaded(report.id, first.id, 'vi')).toBe(true)
    expect(await reports.markDownloaded(report.id, first.id, 'en')).toBe(true)
    expect(await reports.markDownloaded(report.id, first.id, 'vi')).toBe(true)
    const page = await reports.listDownloadsPage({ before: null, beforeId: null, limit: 100, search: lead.email })
    expect(page.items).toEqual([expect.objectContaining({ downloadCount: 3, languages: ['vi', 'en'], reportSlug: 'q2-2027' })])
  })

  it('saves the heading above the cards', async () => {
    const page = await reports.getPage()
    const saved = await reports.updatePage({ ...page, title: { en: 'Reports by quarter', vi: 'Báo cáo từng quý' } }, actor)
    expect(saved.title).toEqual({ en: 'Reports by quarter', vi: 'Báo cáo từng quý' })
  })

  it('counts each source per survey quarter', async () => {
    const sources = new PgSurveySourceRepository(db.pool)
    const list = await sources.list(null)
    for (const source of list.items) {
      const perVersion = Object.values(source.submissionCountsByVersion).reduce((sum, count) => sum + count, 0)
      expect(perVersion).toBe(source.totalSubmissionCount)
    }
    const unattributed = Object.values(list.unattributedByVersion).reduce((sum, count) => sum + count, 0)
    expect(unattributed).toBe(list.unattributedSubmissions)
  })
})

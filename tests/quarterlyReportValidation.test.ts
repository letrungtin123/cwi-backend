import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { QuarterlyReportDownloadTokenService } from '../src/modules/quarterlyReports/quarterlyReportDownloadToken.js'
import { isListed, pickReportFile, type QuarterlyReport } from '../src/modules/quarterlyReports/quarterlyReportRepository.js'
import { toPublicQuarterlyReports } from '../src/modules/quarterlyReports/quarterlyReportRoutes.js'
import {
  defaultQuarterlyReportTitle,
  normalizeQuarterlyReportCreate,
  normalizeQuarterlyReportDownload,
  normalizeQuarterlyReportPageUpdate,
  normalizeQuarterlyReportUpdate,
  quarterlyReportSlug,
} from '../src/modules/quarterlyReports/quarterlyReportValidation.js'

describe('quarterly report validation', () => {
  it('normalizes a valid gated-download lead and Vietnamese mobile number', () => {
    const value = normalizeQuarterlyReportDownload({
      clientMeta: { app: 'cwi-fe-landing-page' },
      email: '  Hq@Example.com ',
      fullName: '  Nguyen   Van   An ',
      idempotencyKey: 'cwi-fe-landing-page-quarterly-report:test-1234',
      phone: '090 123 4567',
      position: 'CEO',
      privacyConsent: true,
    }, 'cwi-fe-landing-page-quarterly-report:test-1234')

    expect(value).toMatchObject({
      email: 'hq@example.com',
      fullName: 'Nguyen Van An',
      phone: '+84901234567',
      position: 'CEO',
    })
    expect(value.payloadHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('requires consent and rejects a mismatched idempotency key', () => {
    expect(() => normalizeQuarterlyReportDownload({
      email: 'lead@company.com',
      fullName: 'Lead',
      phone: '0901234567',
      position: 'CEO',
      privacyConsent: false,
    }, null)).toThrow(HttpError)

    expect(() => normalizeQuarterlyReportDownload({
      email: 'lead@company.com',
      fullName: 'Lead',
      idempotencyKey: 'cwi-fe-landing-page-quarterly-report:body-1234',
      phone: '0901234567',
      position: 'CEO',
      privacyConsent: true,
    }, 'cwi-fe-landing-page-quarterly-report:header-1234')).toThrow(HttpError)
  })

  it('keeps the PDF language out of the request it belongs to', () => {
    const base = { email: 'lead@company.com', fullName: 'Lead', phone: '0901234567', position: 'CEO', privacyConsent: true }
    const vi = normalizeQuarterlyReportDownload({ ...base, language: 'vi' }, null)
    const en = normalizeQuarterlyReportDownload({ ...base, language: 'en' }, null)
    expect([vi.language, en.language]).toEqual(['vi', 'en'])
    expect(vi.payloadHash).toBe(en.payloadHash)
    expect(normalizeQuarterlyReportDownload(base, null).language).toBeNull()
    expect(() => normalizeQuarterlyReportDownload({ ...base, language: 'fr' }, null)).toThrow(HttpError)
  })

  it('uses a predictable period slug and default card titles', () => {
    expect(quarterlyReportSlug(2026, 3)).toBe('q3-2026')
    expect(defaultQuarterlyReportTitle(2026, 3)).toEqual({ en: 'CEO Workforce Index Report Q3 2026', vi: 'Báo cáo CEO Workforce Index Quý 3/2026' })
    expect(normalizeQuarterlyReportCreate({ periodQuarter: 4, periodYear: 2026 })).toEqual({ periodQuarter: 4, periodYear: 2026 })
    for (const payload of [{ periodQuarter: 5, periodYear: 2026 }, { periodQuarter: '4', periodYear: 2026 }, { periodQuarter: 4, periodYear: 2019 }, { extra: 1, periodQuarter: 4, periodYear: 2026 }]) {
      expect(() => normalizeQuarterlyReportCreate(payload)).toThrow(HttpError)
    }
  })

  it('validates the card text, visibility and order', () => {
    const valid = { description: { en: 'Benchmark', vi: ' Đối chuẩn ' }, isVisible: true, sortOrder: 2, title: { en: 'Report', vi: 'Báo cáo' } }
    expect(normalizeQuarterlyReportUpdate(valid)).toEqual({ ...valid, description: { en: 'Benchmark', vi: 'Đối chuẩn' } })
    for (const payload of [
      { ...valid, title: { en: 'Report', vi: '  ' } },
      { ...valid, title: { en: 'Two' + String.fromCharCode(10) + 'lines', vi: 'Báo cáo' } },
      { ...valid, description: { en: 'x', vi: 'x'.repeat(401) } },
      { ...valid, sortOrder: 1000 },
      { ...valid, activate: true },
    ]) {
      expect(() => normalizeQuarterlyReportUpdate(payload)).toThrow(HttpError)
    }
    const heading = { description: { en: 'd', vi: 'd' }, kicker: { en: 'k', vi: 'k' }, title: { en: 't', vi: 't' } }
    expect(normalizeQuarterlyReportPageUpdate(heading)).toEqual(heading)
    expect(() => normalizeQuarterlyReportPageUpdate({ ...heading, kicker: { en: 'k', vi: 'x'.repeat(81) } })).toThrow(HttpError)
  })
})

function report(overrides: Partial<QuarterlyReport>): QuarterlyReport {
  const file = { fileName: 'q.pdf', fileSize: 1, sha256: 'a'.repeat(64), storagePath: 'quarterly/x.pdf', uploadedAt: '2026-11-17T00:00:00.000Z' }
  return {
    description: { en: 'd', vi: 'd' },
    downloadRequests: 0,
    files: { en: null, vi: file },
    id: '00000000-0000-4000-8000-000000000001',
    image: null,
    isVisible: true,
    label: { en: 'Q3 2026', vi: 'Quý 3/2026' },
    periodQuarter: 3,
    periodYear: 2026,
    slug: 'q3-2026',
    sortOrder: 1,
    title: { en: 'Report', vi: 'Báo cáo' },
    updatedAt: '2026-11-17T00:00:00.000Z',
    updatedByEmail: null,
    ...overrides,
  }
}

describe('quarterly report cards', () => {
  const file = { fileName: 'q.pdf', fileSize: 1, sha256: 'b'.repeat(64), storagePath: 'quarterly/y.pdf', uploadedAt: '2026-11-17T00:00:00.000Z' }

  it('lists visible quarters with at least one PDF and marks the newest one current', () => {
    const page = { description: { en: 'd', vi: 'd' }, kicker: { en: 'k', vi: 'k' }, title: { en: 't', vi: 't' }, updatedAt: null, updatedByEmail: null }
    const result = toPublicQuarterlyReports(page, [
      report({ slug: 'q3-2026' }),
      report({ files: { en: file, vi: null }, image: { contentType: 'image/webp', sha256: 'c'.repeat(64), storagePath: 'quarterly-reports/q4-2026/x.webp' }, periodQuarter: 4, slug: 'q4-2026' }),
      report({ isVisible: false, periodQuarter: 2, slug: 'q2-2026' }),
      report({ files: { en: null, vi: null }, periodQuarter: 1, periodYear: 2027, slug: 'q1-2027' }),
    ])
    expect(result.reports.map((item) => [item.slug, item.isCurrent, item.languages])).toEqual([['q3-2026', false, ['vi']], ['q4-2026', true, ['en']]])
    expect(result.reports[1]?.imageUrl).toBe(`/api/v1/public/quarterly-reports/q4-2026/image?v=${'c'.repeat(16)}`)
    expect(result.reports[0]).not.toHaveProperty('files')
  })

  it('opens the PDF in the language asked for, else the other one', () => {
    const both = report({ files: { en: file, vi: report({}).files.vi } })
    expect(pickReportFile(both, 'en')?.language).toBe('en')
    expect(pickReportFile(both, null)?.language).toBe('vi')
    expect(pickReportFile(report({}), 'en')?.language).toBe('vi')
    expect(pickReportFile(report({ files: { en: null, vi: null } }), 'vi')).toBeNull()
    expect(isListed(report({ files: { en: null, vi: null } }))).toBe(false)
  })
})

describe('QuarterlyReportDownloadTokenService', () => {
  const reportId = '2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd'
  const downloadId = 'cbfe55cf-2b8a-4a35-9c08-c2f5a0b67a11'

  it('scopes a download link to its exact report and download request', () => {
    const service = new QuarterlyReportDownloadTokenService('q'.repeat(32), 600)
    const issued = service.issue(reportId, downloadId)

    expect(service.verify(reportId, downloadId, issued.token)).toBe(true)
    expect(downloadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(service.verify('00000000-0000-4000-8000-000000000000', downloadId, issued.token)).toBe(false)
    expect(service.verify(reportId, '00000000-0000-4000-8000-000000000000', issued.token)).toBe(false)
  })
})

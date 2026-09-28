import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { QuarterlyReportDownloadTokenService } from '../src/modules/quarterlyReports/quarterlyReportDownloadToken.js'
import { normalizeQuarterlyReportDownload, normalizeQuarterlyReportUpload, quarterlyReportSlug } from '../src/modules/quarterlyReports/quarterlyReportValidation.js'

describe('quarterly report validation', () => {
  it('normalizes a valid gated-download lead and Vietnamese mobile number', () => {
    const value = normalizeQuarterlyReportDownload({
      clientMeta: { app: 'source4' },
      email: '  Hq@Nesso.com.vn ',
      fullName: '  Nguyen   Van   An ',
      idempotencyKey: 'source4-quarterly-report:test-1234',
      phone: '090 123 4567',
      position: 'CEO',
      privacyConsent: true,
    }, 'source4-quarterly-report:test-1234')

    expect(value).toMatchObject({
      email: 'hq@nesso.com.vn',
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
      idempotencyKey: 'source4-quarterly-report:body-1234',
      phone: '0901234567',
      position: 'CEO',
      privacyConsent: true,
    }, 'source4-quarterly-report:header-1234')).toThrow(HttpError)
  })

  it('uses a predictable period slug and defaults for an upload', () => {
    expect(quarterlyReportSlug(2026, 3)).toBe('q3-2026')
    expect(normalizeQuarterlyReportUpload({ periodQuarter: '3', periodYear: '2026', title: '' })).toEqual({
      activate: true,
      periodQuarter: 3,
      periodYear: 2026,
      subtitle: 'Năng lực lãnh đạo cho tăng trưởng',
      title: 'Báo cáo CEO Workforce Index Quý 3/2026',
    })
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

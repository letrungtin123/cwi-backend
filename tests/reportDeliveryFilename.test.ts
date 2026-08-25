import { describe, expect, it } from 'vitest'
import { contentDispositionAttachment, decodeMultipartFileName, normalizeReportFileName } from '../src/modules/reportDelivery/reportDeliveryFilename.js'

describe('report delivery file names', () => {
  it('preserves a safe original PDF name for display and attachment', () => {
    expect(normalizeReportFileName('Báo cáo khảo sát Q3 2026.pdf')).toBe('Báo cáo khảo sát Q3 2026.pdf')
  })

  it('removes path separators and provides a UTF-8 download filename', () => {
    const header = contentDispositionAttachment('../Báo cáo.pdf')
    expect(header).toContain('filename=')
    expect(header).toContain('filename*=UTF-8')
    expect(header).toContain(encodeURIComponent('_Báo cáo.pdf'))
  })

  it('repairs a Latin-1 decoded UTF-8 filename without changing valid Unicode', () => {
    expect(decodeMultipartFileName('B\u00c3\u00a1o c\u00c3\u00a1o.pdf')).toBe('B\u00e1o c\u00e1o.pdf')
    expect(decodeMultipartFileName('B\u00e1o c\u00e1o.pdf')).toBe('B\u00e1o c\u00e1o.pdf')
    expect(normalizeReportFileName('B\u00c3\u00a1o c\u00c3\u00a1o.pdf')).toBe('B\u00e1o c\u00e1o.pdf')
  })
})

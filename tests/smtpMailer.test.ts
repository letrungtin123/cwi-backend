import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReportEmail, reportEmailLogoPath } from '../src/modules/reportDelivery/emailTemplate.js'
import { buildReportPdfAttachment, Microsoft365OAuthTokenProvider } from '../src/modules/reportDelivery/smtpMailer.js'

describe('Microsoft365OAuthTokenProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('caches a valid access token until it expires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'token-one', expires_in: 3600 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new Microsoft365OAuthTokenProvider({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'https://outlook.office365.com/.default',
      tenantId: 'tenant-id',
      timeoutMs: 1000,
    })

    await expect(provider.getAccessToken()).resolves.toBe('token-one')
    await expect(provider.getAccessToken()).resolves.toBe('token-one')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(request.method).toBe('POST')
    expect(String(request.body)).toContain('grant_type=client_credentials')
    expect(String(request.body)).toContain('client_id=client-id')
    expect(String(request.body)).toContain('scope=https%3A%2F%2Foutlook.office365.com%2F.default')
  })

  it('rejects a token response without an access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new Microsoft365OAuthTokenProvider({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scope: 'https://outlook.office365.com/.default',
      tenantId: 'tenant-id',
      timeoutMs: 1000,
    })

    await expect(provider.getAccessToken()).rejects.toThrow('Microsoft 365 OAuth token request failed')
  })
})

describe('report PDF email attachment', () => {
  it('keeps the original Unicode filename and marks it as a PDF attachment', () => {
    expect(buildReportPdfAttachment({
      originalFileName: 'B\u00e1o c\u00e1o Q3 2026.pdf',
      pdfPath: '/tmp/report.pdf',
    })).toEqual({
      contentDisposition: 'attachment',
      contentType: 'application/pdf',
      filename: 'B\u00e1o c\u00e1o Q3 2026.pdf',
      path: '/tmp/report.pdf',
    })
  })

})

describe('report email template', () => {
  it('keeps the approved Vietnamese content and embeds the CWI logo', () => {
    const { html, text } = buildReportEmail()

    expect(text).toContain('Kính gửi quý Anh/Chị,')
    expect(text).toContain('Thay mặt Ban tổ chức CEO Workforce Index (CWI), tôi xin trân trọng cảm ơn quý Anh/Chị đã dành thời gian hoàn thành khảo sát trong mùa đầu tiên của CEO Workforce Index.')
    expect(text).toContain('Sự tham gia của quý Anh/Chị không chỉ mang lại những góc nhìn và thông tin thực tế, hữu dụng và những khuyến nghị hành động cụ thể cho chính công ty mình; mà còn là đóng góp đáng quý vào bộ dữ liệu đối chuẩn đầu tiên về "Hệ cộng lực" (workforce plus) cho cộng đồng doanh nghiệp tại Việt Nam. Đây là những phép đo và biện pháp để nâng cao năng lực thực thi tích hợp gồm con người, AI, tự động hóa, hệ sinh thái để đáp ứng kỳ vọng tăng trưởng cho doanh nghiệp tại Việt Nam.')
    expect(text).toContain('- Đối chuẩn với thị trường để biết doanh nghiệp đang ở đâu.\n- Nhận diện những khoảng trống và rủi ro cần lưu ý.\n- Tham khảo và lựa chọn khuyến nghị hành động phù hợp cho việc tăng trưởng kinh doanh')
    expect(text).toContain('Phạm Thị Mỹ Lệ\nT/M Ban tổ chức\nCEO WORKFORCE INDEX\nBetter workforce. Better business.')
    expect(text).toContain('Facebook: https://www.facebook.com/profile.php?id=61593195651105')
    expect(html).toContain('data:image/svg+xml;base64,')
    expect(html).not.toContain('cid:')
    expect(reportEmailLogoPath).toMatch(/assets[\\/]cwi-logo\.svg$/)
  })
})

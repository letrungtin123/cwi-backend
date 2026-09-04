import type { ReportEmailType } from './reportDeliveryTypes.js'

type ReportEmailContent = {
  subject: string
  preview: string
  greeting: string
  paragraphs: string[]
  listIntro: string
  listItems: string[]
  textListPrefix: string
  contact: string
  feedback: string
  closing: string
  signature: string[]
}

export type BuiltReportEmail = {
  html: string
  subject: string
  text: string
}

const personalizedContent: ReportEmailContent = {
  subject: 'Báo cáo kết quả khảo sát CEO Workforce Index',
  preview: 'Báo cáo kết quả khảo sát CEO Workforce Index đã sẵn sàng.',
  greeting: 'Kính gửi quý Anh/Chị,',
  paragraphs: [
    'Thay mặt Ban tổ chức CEO Workforce Index (CWI), tôi xin trân trọng cảm ơn quý Anh/Chị đã dành thời gian hoàn thành khảo sát trong mùa đầu tiên của CEO Workforce Index.',
    'Sự tham gia của quý Anh/Chị không chỉ mang lại những góc nhìn và thông tin thực tế, hữu dụng và những khuyến nghị hành động cụ thể cho chính công ty mình; mà còn là đóng góp đáng quý vào bộ dữ liệu đối chuẩn đầu tiên về "Hệ cộng lực" (workforce plus) cho cộng đồng doanh nghiệp tại Việt Nam. Đây là những phép đo và biện pháp để nâng cao năng lực thực thi tích hợp gồm con người, AI, tự động hóa, hệ sinh thái để đáp ứng kỳ vọng tăng trưởng cho doanh nghiệp tại Việt Nam.',
    'Từ những thông tin Quý Anh/Chị đã chia sẻ, CWI xin trân trọng gửi Báo cáo dành riêng cho doanh nghiệp, nhằm hỗ trợ Anh/Chị nhìn sâu hơn và có hành động ưu tiên trong 90 ngày tới về "Năng lực lãnh đạo cho tăng trưởng" - một trong bốn chủ điểm chính của "Hệ cộng lực".',
  ],
  listIntro: 'Vui lòng xem Báo cáo đính kèm trong email này, với cam kết cao về tính độc lập và bảo mật thông tin, hy vọng giúp Anh/Chị:',
  listItems: [
    'Đối chuẩn với thị trường để biết doanh nghiệp đang ở đâu.',
    'Nhận diện những khoảng trống và rủi ro cần lưu ý.',
    'Tham khảo và lựa chọn khuyến nghị hành động phù hợp cho việc tăng trưởng kinh doanh',
  ],
  textListPrefix: '- ',
  contact: 'Trường hợp có thắc mắc gì hoặc cần làm rõ thêm, xin đừng ngần ngại liên hệ với chúng tôi qua email contact@ceo-workforce-index.com',
  feedback: 'CWI cũng trân trọng mọi phản hồi và đóng góp từ Quý Anh/Chị để chúng tôi tiếp tục hoàn thiện trải nghiệm khảo sát, báo cáo và chất lượng đối chuẩn cho kỳ tiếp theo.',
  closing: 'Một lần nữa, CWI trân trọng cảm ơn sự tin tưởng và đóng góp của Quý Anh/Chị trong mùa đầu tiên của dự án góp phần kiến tạo một bộ dữ liệu đối chuẩn có giá trị cho cộng đồng lãnh đạo doanh nghiệp Việt Nam,',
  signature: ['Trân trọng,', 'Phạm Thị Mỹ Lệ', 'T/M Ban tổ chức', 'CEO WORKFORCE INDEX', 'Better workforce. Better business.'],
}

const anonymousContent: ReportEmailContent = {
  subject: 'Báo cáo kết quả khảo sát khuyết danh CEO Workforce Index',
  preview: 'Báo cáo kết quả khảo sát khuyết danh CEO Workforce Index đã sẵn sàng.',
  greeting: 'Kính gửi Quý Anh/Chị,',
  paragraphs: [
    'Thay mặt Ban Tổ chức CEO Workforce Index (CWI), tôi xin trân trọng cảm ơn Quý Anh/Chị đã dành thời gian hoàn thành khảo sát trong mùa đầu tiên của CEO Workforce Index.',
    'Sự tham gia của Quý Anh/Chị không chỉ mang lại những góc nhìn và thông tin thực tế, hữu dụng, cùng những khuyến nghị hành động cụ thể cho doanh nghiệp; mà còn là đóng góp đáng quý vào bộ dữ liệu đối chuẩn đầu tiên về “Hệ cộng lực” (Workforce Plus) cho cộng đồng doanh nghiệp tại Việt Nam. Đây là những phép đo và biện pháp nhằm nâng cao năng lực thực thi tích hợp giữa con người, AI, tự động hóa và hệ sinh thái, qua đó hỗ trợ doanh nghiệp đáp ứng các kỳ vọng tăng trưởng trong bối cảnh mới.',
    'Theo lựa chọn không chia sẻ thông tin của Quý Anh/Chị khi tham gia khảo sát, Chương trình chỉ ghi nhận và xử lý phần dữ liệu khảo sát ở chế độ khuyết danh. Nếu muốn nhận báo cáo toàn phần, Anh/Chị vui lòng làm cả hai phần khảo sát và chọn "đồng ý" cho CEO Workforce Index xử lý thông tin cá nhân phục vụ mục đích của Chương trình.',
    'Từ những thông tin Quý Anh/Chị đã chia sẻ, CWI xin trân trọng gửi Báo cáo kết quả khảo sát khuyết danh, nhằm hỗ trợ Anh/Chị có thêm góc nhìn về “Năng lực lãnh đạo cho tăng trưởng” – một trong bốn chủ điểm chính của “Hệ cộng lực”.',
  ],
  listIntro: 'Vui lòng xem Báo cáo đính kèm trong email này. Với cam kết cao về tính độc lập và bảo mật thông tin, CWI hy vọng báo cáo sẽ hỗ trợ Anh/Chị:',
  listItems: [
    'Đối chuẩn với thị trường để xác định doanh nghiệp đang ở đâu.',
    'Nhận diện những khoảng trống và rủi ro cần lưu ý.',
    'Tham khảo và lựa chọn các khuyến nghị hành động phù hợp cho mục tiêu tăng trưởng kinh doanh.',
  ],
  textListPrefix: '',
  contact: 'Trường hợp có bất kỳ thắc mắc nào hoặc cần làm rõ thêm về báo cáo, xin đừng ngần ngại liên hệ với chúng tôi qua email contact@ceo-workforce-index.com.',
  feedback: 'CWI cũng trân trọng mọi phản hồi và đóng góp từ Quý Anh/Chị để chúng tôi tiếp tục hoàn thiện trải nghiệm khảo sát, báo cáo và chất lượng dữ liệu đối chuẩn cho các kỳ tiếp theo.',
  closing: 'Một lần nữa, CWI trân trọng cảm ơn sự tin tưởng và đóng góp của Quý Anh/Chị trong mùa đầu tiên của chương trình, góp phần kiến tạo một bộ dữ liệu đối chuẩn có giá trị cho cộng đồng lãnh đạo doanh nghiệp Việt Nam.',
  signature: ['Trân trọng,', 'Phạm Thị Mỹ Lệ', 'T/M Ban Tổ chức', 'CEO WORKFORCE INDEX', 'Better workforce. Better business.'],
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function textContent(content: ReportEmailContent) {
  return [
    content.greeting,
    ...content.paragraphs,
    content.listIntro,
    content.listItems.map((item) => content.textListPrefix + item).join('\n'),
    content.contact,
    content.feedback,
    content.closing,
    content.signature.join('\n'),
    'Website: https://ceo-workforce-index.com/',
    'Facebook: https://www.facebook.com/profile.php?id=61593195651105',
  ].join('\n\n')
}

function htmlParagraph(value: string, margin = '0 0 20px') {
  return `<p style="margin:${margin};">${escapeHtml(value)}</p>`
}

function htmlContent(content: ReportEmailContent) {
  const paragraphs = content.paragraphs.map((paragraph) => htmlParagraph(paragraph)).join('')
  const list = content.listItems
    .map((item, index) => `<li style="${index === content.listItems.length - 1 ? 'padding:0;' : 'padding:0 0 8px;'}">${escapeHtml(item)}</li>`)
    .join('')
  const signature = content.signature.slice(1).map((line, index) => {
    if (index === 3) return `<span style="color:#16bdb4;">${escapeHtml(line)}</span>`
    return index === 0 || index === 2 ? `<strong>${escapeHtml(line)}</strong>` : escapeHtml(line)
  }).join('<br>')
  const signatureOpening = content.signature[0] ?? 'Trân trọng,'

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(content.subject)}</title>
  <style>
    @media screen and (max-width: 600px) {
      .email-shell { width: 100% !important; }
      .email-content { padding: 28px 20px !important; }
      .email-header { padding: 22px 20px !important; }
      .email-footer { padding: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;background:#eef3f9;color:#172b4d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(content.preview)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef3f9;">
    <tr>
      <td align="center" style="padding:30px 12px;">
        <table role="presentation" class="email-shell" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border:1px solid #dce5f0;border-radius:18px;overflow:hidden;">
          <tr>
            <td class="email-header" align="center" style="padding:24px 32px 22px;border-top:5px solid #26c8bd;border-bottom:1px solid #e5ebf3;background:#ffffff;">
              <div style="font-size:20px;line-height:1.3;font-weight:700;letter-spacing:.04em;color:#073b87;">CEO Workforce Index</div>
            </td>
          </tr>
          <tr>
            <td class="email-content" style="padding:36px 48px 34px;font-size:16px;line-height:1.65;color:#172b4d;">
              ${htmlParagraph(content.greeting)}
              ${paragraphs}
              ${htmlParagraph(content.listIntro, '0 0 12px')}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;background:#f4fbfa;border:1px solid #d3f0ec;border-radius:12px;">
                <tr><td style="padding:17px 20px 16px;">
                  <ul style="margin:0;padding:0 0 0 20px;color:#172b4d;">${list}</ul>
                </td></tr>
              </table>
              ${htmlParagraph(content.contact)}
              ${htmlParagraph(content.feedback)}
              ${htmlParagraph(content.closing, '0 0 24px')}
              ${htmlParagraph(signatureOpening, '0')}
              <p style="margin:18px 0 0;line-height:1.55;">${signature}</p>
              <p style="margin:18px 0 0;line-height:1.65;">Website: <a href="https://ceo-workforce-index.com/" style="color:#0756a8;text-decoration:underline;">https://ceo-workforce-index.com/</a><br><br>Facebook: <a href="https://www.facebook.com/profile.php?id=61593195651105" style="color:#0756a8;text-decoration:underline;">https://www.facebook.com/profile.php?id=61593195651105</a></p>
            </td>
          </tr>
          <tr>
            <td class="email-footer" align="center" style="padding:18px 32px;background:#f7f9fc;border-top:1px solid #e5ebf3;color:#718096;font-size:12px;line-height:1.5;">CEO Workforce Index</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function buildReportEmail(reportType: ReportEmailType = 'personalized'): BuiltReportEmail {
  const content = reportType === 'anonymous' ? anonymousContent : personalizedContent
  return { html: htmlContent(content), subject: content.subject, text: textContent(content) }
}

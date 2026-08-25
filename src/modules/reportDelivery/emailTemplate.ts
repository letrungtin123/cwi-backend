import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const reportEmailLogoPath = fileURLToPath(new URL('./assets/cwi-logo.svg', import.meta.url))
const reportEmailLogoDataUri = 'data:image/svg+xml;base64,' + readFileSync(reportEmailLogoPath).toString('base64')

export function buildReportEmail() {
  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Báo cáo kết quả khảo sát CEO Workforce Index</title>
  <style>
    @media screen and (max-width: 600px) {
      .email-shell { width: 100% !important; }
      .email-content { padding: 28px 20px !important; }
      .email-header { padding: 22px 20px !important; }
      .email-logo { width: 148px !important; }
      .email-footer { padding: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;background:#eef3f9;color:#172b4d;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Báo cáo kết quả khảo sát CEO Workforce Index đã sẵn sàng.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef3f9;">
    <tr>
      <td align="center" style="padding:30px 12px;">
        <table role="presentation" class="email-shell" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border:1px solid #dce5f0;border-radius:18px;overflow:hidden;">
          <tr>
            <td class="email-header" align="center" style="padding:24px 32px 22px;border-top:5px solid #26c8bd;border-bottom:1px solid #e5ebf3;background:#ffffff;">
              <img class="email-logo" src="__LOGO_SRC__" width="160" alt="CEO Workforce Index" style="display:block;width:160px;max-width:100%;height:auto;margin:0 auto;">
            </td>
          </tr>
          <tr>
            <td class="email-content" style="padding:36px 48px 34px;font-size:16px;line-height:1.65;color:#172b4d;">
              <p style="margin:0 0 20px;">Kính gửi quý Anh/Chị,</p>
              <p style="margin:0 0 20px;">Thay mặt Ban tổ chức CEO Workforce Index (CWI), tôi xin trân trọng cảm ơn quý Anh/Chị đã dành thời gian hoàn thành khảo sát trong mùa đầu tiên của CEO Workforce Index.</p>
              <p style="margin:0 0 20px;">Sự tham gia của quý Anh/Chị không chỉ mang lại những góc nhìn và thông tin thực tế, hữu dụng và những khuyến nghị hành động cụ thể cho chính công ty mình; mà còn là đóng góp đáng quý vào bộ dữ liệu đối chuẩn đầu tiên về &quot;Hệ cộng lực&quot; (workforce plus) cho cộng đồng doanh nghiệp tại Việt Nam. Đây là những phép đo và biện pháp để nâng cao năng lực thực thi tích hợp gồm con người, AI, tự động hóa, hệ sinh thái để đáp ứng kỳ vọng tăng trưởng cho doanh nghiệp tại Việt Nam.</p>
              <p style="margin:0 0 20px;">Từ những thông tin Quý Anh/Chị đã chia sẻ, CWI xin trân trọng gửi Báo cáo dành riêng cho doanh nghiệp, nhằm hỗ trợ Anh/Chị nhìn sâu hơn và có hành động ưu tiên trong 90 ngày tới về &quot;Năng lực lãnh đạo cho tăng trưởng&quot; - một trong bốn chủ điểm chính của &quot;Hệ cộng lực&quot;.</p>
              <p style="margin:0 0 12px;">Vui lòng xem Báo cáo đính kèm trong email này, với cam kết cao về tính độc lập và bảo mật thông tin, hy vọng giúp Anh/Chị:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px;background:#f4fbfa;border:1px solid #d3f0ec;border-radius:12px;">
                <tr><td style="padding:17px 20px 16px;">
                  <ul style="margin:0;padding:0 0 0 20px;color:#172b4d;">
                    <li style="padding:0 0 8px;">Đối chuẩn với thị trường để biết doanh nghiệp đang ở đâu.</li>
                    <li style="padding:0 0 8px;">Nhận diện những khoảng trống và rủi ro cần lưu ý.</li>
                    <li style="padding:0;">Tham khảo và lựa chọn khuyến nghị hành động phù hợp cho việc tăng trưởng kinh doanh</li>
                  </ul>
                </td></tr>
              </table>
              <p style="margin:0 0 20px;">Trường hợp có thắc mắc gì hoặc cần làm rõ thêm, xin đừng ngần ngại liên hệ với chúng tôi qua email <a href="mailto:contact@ceo-workforce-index.com" style="color:#0756a8;text-decoration:underline;">contact@ceo-workforce-index.com</a></p>
              <p style="margin:0 0 20px;">CWI cũng trân trọng mọi phản hồi và đóng góp từ Quý Anh/Chị để chúng tôi tiếp tục hoàn thiện trải nghiệm khảo sát, báo cáo và chất lượng đối chuẩn cho kỳ tiếp theo.</p>
              <p style="margin:0 0 24px;">Một lần nữa, CWI trân trọng cảm ơn sự tin tưởng và đóng góp của Quý Anh/Chị trong mùa đầu tiên của dự án góp phần kiến tạo một bộ dữ liệu đối chuẩn có giá trị cho cộng đồng lãnh đạo doanh nghiệp Việt Nam,</p>
              <p style="margin:0;">Trân trọng,</p>
              <p style="margin:18px 0 0;line-height:1.55;"><strong>Phạm Thị Mỹ Lệ</strong><br>T/M Ban tổ chức<br><strong>CEO WORKFORCE INDEX</strong><br><span style="color:#16bdb4;">Better workforce. Better business.</span></p>
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
</html>`.replaceAll('__LOGO_SRC__', reportEmailLogoDataUri)

  const text = `Kính gửi quý Anh/Chị,

Thay mặt Ban tổ chức CEO Workforce Index (CWI), tôi xin trân trọng cảm ơn quý Anh/Chị đã dành thời gian hoàn thành khảo sát trong mùa đầu tiên của CEO Workforce Index.

Sự tham gia của quý Anh/Chị không chỉ mang lại những góc nhìn và thông tin thực tế, hữu dụng và những khuyến nghị hành động cụ thể cho chính công ty mình; mà còn là đóng góp đáng quý vào bộ dữ liệu đối chuẩn đầu tiên về "Hệ cộng lực" (workforce plus) cho cộng đồng doanh nghiệp tại Việt Nam. Đây là những phép đo và biện pháp để nâng cao năng lực thực thi tích hợp gồm con người, AI, tự động hóa, hệ sinh thái để đáp ứng kỳ vọng tăng trưởng cho doanh nghiệp tại Việt Nam.

Từ những thông tin Quý Anh/Chị đã chia sẻ, CWI xin trân trọng gửi Báo cáo dành riêng cho doanh nghiệp, nhằm hỗ trợ Anh/Chị nhìn sâu hơn và có hành động ưu tiên trong 90 ngày tới về "Năng lực lãnh đạo cho tăng trưởng" - một trong bốn chủ điểm chính của "Hệ cộng lực".

Vui lòng xem Báo cáo đính kèm trong email này, với cam kết cao về tính độc lập và bảo mật thông tin, hy vọng giúp Anh/Chị:

- Đối chuẩn với thị trường để biết doanh nghiệp đang ở đâu.
- Nhận diện những khoảng trống và rủi ro cần lưu ý.
- Tham khảo và lựa chọn khuyến nghị hành động phù hợp cho việc tăng trưởng kinh doanh

Trường hợp có thắc mắc gì hoặc cần làm rõ thêm, xin đừng ngần ngại liên hệ với chúng tôi qua email contact@ceo-workforce-index.com

CWI cũng trân trọng mọi phản hồi và đóng góp từ Quý Anh/Chị để chúng tôi tiếp tục hoàn thiện trải nghiệm khảo sát, báo cáo và chất lượng đối chuẩn cho kỳ tiếp theo.

Một lần nữa, CWI trân trọng cảm ơn sự tin tưởng và đóng góp của Quý Anh/Chị trong mùa đầu tiên của dự án góp phần kiến tạo một bộ dữ liệu đối chuẩn có giá trị cho cộng đồng lãnh đạo doanh nghiệp Việt Nam,
Trân trọng,

Phạm Thị Mỹ Lệ
T/M Ban tổ chức
CEO WORKFORCE INDEX
Better workforce. Better business.
Website: https://ceo-workforce-index.com/

Facebook: https://www.facebook.com/profile.php?id=61593195651105`

  return { html, text }
}

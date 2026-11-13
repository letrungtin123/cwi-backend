# CWI Backend

Backend của CEO Workforce Index (CWI), viết bằng Node.js 24, TypeScript và Express 5. Backend lo các việc sau:

- nhận bài khảo sát, đăng ký CEO Roundtable và Webinar từ trang công khai;
- phát hành báo cáo quý và ghi nhận lượt tải;
- cung cấp API cho trang quản trị (dashboard);
- điều phối việc tạo báo cáo cá nhân và gửi email kèm PDF.

Cùng repo này có bộ công cụ đóng gói và triển khai cho cả ba ứng dụng: `source4` (trang công khai), `cwi-dashboard` (trang quản trị) và backend.

## Thành phần khi chạy

| Tiến trình (PM2) | File | Việc làm |
| --- | --- | --- |
| `cwi-backend` | `src/server.ts` | API HTTP, cổng 8088 (chỉ nghe nội bộ) |
| `cwi-public` | `deploy/cwi-public-router.mjs` | Phục vụ trang công khai, `/dashboard/` và chuyển tiếp `/api` về backend, cổng 8180 |
| `cwi-report-generation-worker` | `src/reportGenerationWorker.ts` | Gọi dịch vụ AI tạo báo cáo, render PDF, lưu vào Storage |
| `cwi-report-delivery-worker` | `src/reportDeliveryWorker.ts` | Gửi email kèm PDF qua SMTP, nhận việc từ RabbitMQ |
| `cwi-export-worker` | `src/exportWorker.ts` | Xuất dữ liệu Excel cho trang quản trị |

Dịch vụ phụ thuộc:

- PostgreSQL và Storage của dự án Supabase CWI.
- RabbitMQ, khi bật gửi email.
- Chrome hoặc Edge, để render PDF.
- Dịch vụ AI tạo báo cáo (cwi-ai). Dịch vụ này chạy riêng và không nằm trong repo này.

## Chạy ở máy phát triển

```powershell
npm install
Copy-Item .env.example .env   # rồi điền DATABASE_URL, các secret...
npm run dev                   # API ở HOST/PORT trong .env (dashboard mặc định gọi 127.0.0.1:8080)
```

Các worker chạy riêng khi cần:

```powershell
npm run dev:report-generation-worker
npm run dev:report-delivery-worker
npm run dev:export-worker
```

> [!WARNING]
> Worker tạo báo cáo gửi **mọi** bài khảo sát đang chờ trong database tới dịch vụ AI mà `REPORT_SERVICE_BASE_URL` trỏ tới. Ở máy phát triển, giữ `REPORT_SERVICE_ENABLED=false`, trừ khi chủ động thử luồng này và đã biết dữ liệu nào sẽ được gửi đi.

Trang công khai (`source4`, cổng 5670) và trang quản trị (`cwi-dashboard`) chạy bằng `npm run dev` trong repo của từng trang. Biến `VITE_*` trong `.env` của mỗi trang trỏ về API local.

## Kiểm tra

```powershell
npm run typecheck   # TypeScript cho src và tests
npm run lint        # oxlint
npm test            # vitest (không cần database)
npm run test:db     # chạy SQL thật trên PostgreSQL local; mọi dữ liệu ghi đều bị rollback
```

`test:db` đọc `DATABASE_URL` trong `.env`. Lệnh từ chối chạy nếu địa chỉ không phải localhost, và tự bỏ qua (báo "skipped") khi database local chưa bật. Các repository vẫn tự mở transaction của chúng; trong lúc test, các transaction đó được đổi thành savepoint nằm trong một transaction lớn, và transaction lớn luôn bị rollback khi xong.

Script đóng gói production chạy toàn bộ các kiểm tra này trên cả ba repo trước khi build (xem phần Triển khai).

## Cấu trúc mã nguồn

```text
src/
  server.ts, app.ts         Khởi động HTTP, middleware, gắn các router
  *Worker.ts                Điểm vào của từng worker
  config/env.ts             Đọc và kiểm tra biến môi trường (zod), sai cấu hình thì dừng ngay
  db/                       Pool PostgreSQL
  http/                     Lỗi HTTP, phiên quản trị, cursor phân trang, kiểm tra id
  modules/
    survey/                 Nhận bài khảo sát, bộ câu hỏi VI/EN, chấm điểm
    roundtable/, webinar/   Đăng ký sự kiện
    quarterlyReports/       Báo cáo quý công khai và lượt tải
    reports/                Tạo báo cáo qua dịch vụ AI, render PDF, link xem báo cáo
    reportDelivery/         File PDF gửi người tham gia, chiến dịch email, SMTP
    exports/                Xuất Excel
    admin/                  Danh sách và chi tiết cho dashboard
    adminUsers/, auth/      Tài khoản quản trị, đăng nhập, phân quyền
    surveySources/          "Nguồn mời": link/QR theo đối tác, đếm lượt gửi
    submissionDeletion/     Xoá lượt gửi chưa có báo cáo
    audit/                  Lịch sử thao tác quản trị
    shared/                 Hàm dùng chung (chuẩn hoá số điện thoại...)
tests/                      vitest
deploy/                     Đóng gói, cài đặt, PM2, nginx, public router
```

## API

Mọi phản hồi thành công có dạng `{ "data": ... }`. Phản hồi lỗi có dạng `{ "error": { "code", "message", "requestId" } }`:

- `code` là mã tiếng Anh, cố định; frontend rẽ nhánh theo mã này.
- `message` là câu tiếng Việt để hiển thị cho người dùng.

### Kiểm tra sống

| Method | Path | Ghi chú |
| --- | --- | --- |
| GET | `/healthz`, `/health` | Tiến trình còn sống |
| GET | `/readyz` | Kết nối được PostgreSQL |

### Công khai (`/api/v1`)

| Method | Path | Ghi chú |
| --- | --- | --- |
| POST | `/survey-submissions` | Nộp bài khảo sát (kèm mã chống gửi trùng) |
| POST | `/roundtable-registrations`, `/roundtable-registrations/check` | Đăng ký CEO Roundtable, kiểm tra email đã đăng ký |
| GET | `/roundtable-registrations/event` | Thời gian, địa điểm Roundtable của quý |
| POST | `/webinar-registrations`, `/webinar-registrations/check` | Đăng ký Webinar |
| GET | `/public/report-jobs/:id/status`, `/public/report-jobs/:id/html` | Trạng thái và nội dung báo cáo cá nhân; cần header `X-CWI-Report-Token` |
| GET | `/public/quarterly-reports/active`, `/public/quarterly-reports/:slug` | Thông tin báo cáo quý |
| GET | `/public/quarterly-reports/:slug/pdf` | Xem PDF; hỗ trợ HTTP Range |
| POST | `/public/quarterly-reports/:slug/downloads` | Ghi nhận người tải đã đồng ý điều khoản, trả link tải có chữ ký |
| GET | `/public/quarterly-reports/:slug/download?token=` | Tải file theo link có chữ ký |

### Đăng nhập (`/api/v1/auth`)

`POST /login`, `GET /me`, `POST /logout`, `POST /change-password`.

Đăng nhập kiểm tra mật khẩu qua Supabase Auth, sau đó tạo phiên riêng trong `cwi_admin_sessions`. Trình duyệt nhận cookie phiên HttpOnly cùng cặp cookie/header CSRF. Mọi request thay đổi dữ liệu phải gửi header `x-csrf-token`.

### Quản trị (`/api/v1/admin`)

| Nhóm | Endpoint |
| --- | --- |
| Bài khảo sát | `GET /survey-submissions/page`, `/stats`, `/:id`; `POST /survey-submissions/:id/retry-report`; `GET /report-jobs/:id/pdf` |
| Roundtable, Webinar | `GET /roundtable-registrations/page`, `/stats`, `/:id` (tương tự cho `/webinar-registrations`); `GET`/`PUT /roundtable-event` |
| File PDF và email | `/report-delivery/submissions/status`, `/report-delivery/submissions/:id/report-pdf` (PUT tải lên, GET tải về), `/report-delivery/submissions/:id/retry-email`, `/report-delivery/campaigns/*` |
| Tạo báo cáo | `GET`/`PUT /report-generation-settings` (công tắc tạm dừng gọi AI) |
| Báo cáo quý | `GET`/`POST /quarterly-reports/reports`, `GET /quarterly-reports/downloads/page`, `/downloads/stats` |
| Nguồn mời | `/survey-sources` (CRUD), `/survey-sources/:id/history` |
| Xuất Excel | `POST /exports`, `GET /exports/:id`, `GET /exports/:id/download` |
| Xoá lượt gửi | `POST /submission-deletions/preview`, `POST /submission-deletions` |
| Tài khoản | `/admin-users` (tạo, sửa, khoá/mở khoá, đặt lại mật khẩu) |

Danh sách dùng phân trang theo con trỏ:

- Mặc định `limit=10`, tối đa 100.
- Trang sau lấy bằng `cursor` có chữ ký mà server trả về.

Phân quyền:

| Quyền | Được làm gì |
| --- | --- |
| `viewer` | Chỉ xem danh sách và trạng thái. Không tải PDF, không xuất Excel. |
| `admin` | Mọi thao tác nội dung. |
| `superadmin` | Như `admin`, cộng quản lý tài khoản quản trị và xoá lượt gửi. |

Các thao tác với tài khoản quản trị, nguồn mời và việc xoá lượt gửi được ghi vào lịch sử thao tác (audit).

### Giới hạn upload

Server nhận file tối đa 20 MB, vì nginx đặt `client_max_body_size 20m`. Backend cho phép tới 50 MB (`REPORT_UPLOAD_MAX_BYTES`, `QUARTERLY_REPORT_UPLOAD_MAX_BYTES`), nên giới hạn của nginx là giới hạn thực tế. Dashboard chặn file lớn hơn 20 MB trước khi gửi. Muốn nâng giới hạn thì phải đổi cả hai nơi.

## Trạng thái bài khảo sát

- `part1_only`: hoàn thành Phần 1, nhận báo cáo Phần 1.
- `part2_refused_privacy`: làm cả hai phần nhưng không đồng ý điều khoản bảo mật. Câu trả lời Phần 2 vẫn được lưu; báo cáo chỉ gồm Phần 1.
- `full_private_report`: làm cả hai phần và đồng ý điều khoản, nhận báo cáo đầy đủ.

Backend lưu nội dung câu hỏi chuẩn từ `src/modules/survey/surveyQuestions.ts` và bỏ qua nội dung câu hỏi do client gửi lên. Bài làm bằng tiếng Anh được quy đổi về câu trả lời tiếng Việt trước khi lưu. Bài gửi kèm bộ câu hỏi đã cũ bị từ chối với mã `survey_version_mismatch`.

## Luồng tạo và gửi báo cáo

1. Bài khảo sát được lưu, đồng thời tạo một việc tạo báo cáo.
2. Worker tạo báo cáo gọi dịch vụ AI và chờ kết quả HTML:
   - `part1_only` và `part2_refused_privacy` dùng `/v3/reports/anonymous`;
   - `full_private_report` dùng `/v3/reports/personalized`.
3. Worker render HTML thành PDF bằng Chrome/Edge, rồi lưu cả HTML và PDF vào Storage riêng tư.
4. Khi bật `REPORT_AUTO_EMAIL_ENABLED`, việc gửi email được tạo trong cùng transaction với trạng thái "đã tạo xong".
5. Worker gửi email gửi qua SMTP. Worker này có giới hạn số email gửi song song, cơ chế giữ việc (lease), thử lại có giãn cách, và không gửi lại khi không chắc email trước đã đi hay chưa.

Trang khảo sát nhận một token ngắn hạn có chữ ký, chỉ dùng được cho đúng báo cáo đó, để theo dõi trạng thái và hiển thị HTML trong iframe sandbox.

Admin có thể tạm dừng việc gọi AI bằng công tắc trong dashboard. Khi tạm dừng, bài mới vẫn được lưu, và người tham gia được báo sẽ nhận báo cáo qua email sau.

Trên server nhỏ chỉ chạy một tiến trình tạo báo cáo.

## Dữ liệu và SQL

- SQL thay đổi cấu trúc nằm trong repo `supabase-cwi`, thư mục `supabase/manual_sql`.
- Mỗi file được chạy **thủ công** trên đúng dự án Supabase CWI, sau khi đã sao lưu.
- Ứng dụng và script triển khai không bao giờ tự chạy migration.

Tạo tài khoản quản trị đầu tiên:

1. Tạo user trong Supabase Studio > Authentication > Users.
2. Thêm `auth.users.id` của user đó vào `public.cwi_admin_users` với quyền `superadmin`, theo hướng dẫn trong file SQL `create_cwi_admin_auth`.

Các tài khoản sau đó được tạo ngay trong dashboard.

## Backup và khoá Supabase (`deploy/ops/`)

- **Backup hằng ngày.** `cwi-backup.sh` chạy lúc 02:00 giờ Việt Nam bằng `cwi-backup.service` và `cwi-backup.timer` (systemd, cài ở `/etc/systemd/system`).
  - Mỗi lần chạy tạo:
    - bản dump đầy đủ của database;
    - bản sao từng file trong Storage;
    - file env của backend.
  - Tất cả được mã hoá bằng GPG AES-256, dùng mật khẩu trong `~/.config/cwi/backup-passphrase`.
  - Server giữ 14 ngày trong `~/cwi-backups/auto`. Mỗi tuần script tự khôi phục thử bản mới nhất vào một database tạm.
  - File đã bị xoá khỏi Storage: bản sao được chuyển sang `storage-deleted/<ngày>/` và xoá hẳn sau 90 ngày. Nếu hơn 20% số file biến mất cùng lúc, script không dọn gì và ghi cảnh báo (chốt an toàn). Máy kéo backup về làm y như vậy.
- **Kéo backup về máy khác.** `cwi-backup-pull.ps1` chạy trên máy Windows bằng Task Scheduler.
  - Script kéo backup về `D:\CWI-Backups` và giữ 90 ngày.
  - Có vấn đề thì hiện thông báo Windows.
- **Đổi khoá Supabase.** `rotate-supabase-secrets.mjs` đổi khoá JWT, khoá anon/service_role và mật khẩu mọi tài khoản database. Script cũng tạo tài khoản `cwi_app` với quyền tối thiểu cho backend.
  - Các bước: `plan` → `app-role` → `backend-env --only db` → `rotate` → `backend-env` → `verify`. Có `rollback` để quay lại.
  - Kong do bên khác quản lý nên script không sửa Kong.
  - Container mới giữ đúng IP của container cũ, vì Kong nhớ IP của các dịch vụ phía sau.
  - Lưu ý: chạy lại Supabase CLI (`supabase start`) trên server sẽ đưa mọi khoá về giá trị mặc định. Không làm việc này.

## Triển khai

Production chạy bản build đóng gói sẵn, không chạy từ mã nguồn, và PM2 quản lý các tiến trình. Xem `DEPLOYMENT_ARTIFACT.md` và `deploy/README.md`.

Tóm tắt:

- `deploy/build-production-artifact.ps1` chạy typecheck, lint và test của ba repo, rồi build và đóng gói.
  - `-SkipChecks` bỏ qua bước kiểm tra. Chỉ dùng khi khẩn cấp.
- `deploy/install-production-artifact.sh` chạy thử bản mới trên cổng staging, rồi mới chuyển PM2 sang. Nếu kiểm tra hỏng, bản cũ được giữ nguyên.
- Secret nằm ngoài bản release, trong file do `CWI_ENV_FILE` chỉ tới.
- Quy trình triển khai không chạy SQL và không xoá dữ liệu.

# Triển khai production bằng artifact

## Mục tiêu

Production nhận một gói build đã được kiểm tra từ máy phát triển hoặc CI. Máy chủ chỉ giữ bản build, runtime launcher, thư viện production và file cấu hình bí mật bên ngoài release; không cần `git`, `.git`, `src`, test hoặc raw source của ba ứng dụng.

Quy trình này chỉ triển khai `source4`, `cwi-dashboard` và `cwi-backend`. Không chạy migration, không reset cơ sở dữ liệu, không xoá dữ liệu Supabase/Storage/RabbitMQ và không đọc, sửa hoặc triển khai `cwi-ai`.

## Tạo và cài release

Thực hiện ở máy phát triển, tại thư mục `cwi-backend`:

```powershell
Set-Location D:\CWI\cwi-backend
.\deploy\publish-production-artifact.ps1 `
  -RemoteHost "SERVER_HOST" `
  -RemoteUser "ubuntu" `
  -SshKeyPath "C:\path\to\ssh-key"
```

Script dùng lockfile để cài dependency, chạy build cho cả ba repository, tạo manifest commit và checksum SHA-256, sau đó gửi một artifact qua SSH. Máy chủ không chạy `git pull` và không build raw source.

Chỉ tạo gói để kiểm tra local:

```powershell
.\deploy\build-production-artifact.ps1
```

Gói được tạo trong `.artifacts/`, thư mục này đã được Git ignore. Trước khi gửi, có thể kiểm tra gói không chứa raw source:

```powershell
tar -tzf .artifacts\cwi-release-*.tar.gz | Select-String '(^|/)(src|\.git|\.env)(/|$)'
```

## Cách release bảo vệ production

Installer trên máy chủ sẽ:

1. Từ chối đường dẫn nguy hiểm trong tar và kiểm tra checksum.
2. Xác nhận đủ `dist`, launcher và metadata runtime.
3. Cài dependency production trong thư mục release mới.
4. Chạy backend và public router ở cổng staging, kiểm tra liveness, readiness, landing và dashboard.
5. Chỉ sau khi kiểm tra đạt mới chuyển PM2 sang release mới.
6. Giữ release cũ để rollback tự động nếu PM2 hoặc health check thất bại.
7. Giữ ba release artifact gần nhất và xoá artifact upload tạm sau khi cài thành công.

File môi trường production không nằm trong release. Mặc định file ở `~/.config/cwi/cwi-backend.env`, quyền `600`, và được nạp qua `CWI_ENV_FILE`/`DOTENV_CONFIG_PATH`. Không commit file này, SMTP password, Supabase key, RabbitMQ credential hoặc token AI.

## Dọn source legacy

Không bật dọn source ở lần rollout đầu tiên. Sau khi kiểm tra domain, PM2 và các luồng survey/report/email đã chạy ổn từ artifact, có thể chạy lại publish với `-PruneLegacySource`. Tùy chọn này chỉ xoá ba checkout legacy dưới `~/cwi-platform/repos/{source4,cwi-dashboard,cwi-backend}` sau khi release artifact đã active; không chạm `~/cwi-ai`.

Script cũ `deploy/update-production.sh` đã bị khóa mặc định để tránh vô tình kéo và build source trên máy chủ. Không bật `CWI_ALLOW_LEGACY_SOURCE_DEPLOY=true` trong production.

## Kiểm tra sau triển khai

```bash
pm2 status
pm2 logs cwi-backend --lines 100
curl --fail-with-body -sS http://127.0.0.1:8088/healthz
curl --fail-with-body -sS http://127.0.0.1:8088/readyz
curl --fail-with-body -sS http://127.0.0.1:8080/ > /dev/null
curl --fail-with-body -sS http://127.0.0.1:8080/dashboard/ > /dev/null
```

Nếu có lỗi, xem `pm2 status` và log PM2 trước khi retry. Không xoá release đang active hoặc dữ liệu ứng dụng thủ công.

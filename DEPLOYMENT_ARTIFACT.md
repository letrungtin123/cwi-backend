# Hướng dẫn vận hành artifact production

Repository backend là nơi điều phối bản release của `source4`, `cwi-dashboard` và `cwi-backend`.

## Cập nhật production

Sau khi ba repository đã được review và push lên `main`, chạy tại máy phát triển:

```powershell
Set-Location D:\CWI\cwi-backend
.\deploy\publish-production-artifact.ps1 `
  -RemoteHost "SERVER_HOST" `
  -RemoteUser "ubuntu" `
  -SshKeyPath "C:\path\to\ssh-key"
```

Lệnh trên build theo lockfile, đóng gói commit cụ thể của cả ba repository, gửi artifact qua SSH và chạy kiểm tra trước khi PM2 reload. Không chạy `git pull` trên production.

Nếu cần chỉ tạo gói để kiểm tra:

```powershell
.\deploy\build-production-artifact.ps1
```

Gói nằm trong `cwi-backend/.artifacts/` và không được commit.

## Nội dung được phép trên server

Mỗi release chỉ có frontend `dist`, backend `dist`, launcher, cấu hình PM2, package metadata và production `node_modules`. Không có `.git`, thư mục `src`, test, log debug hoặc `.env` trong release.

File env production nằm ngoài release tại `~/.config/cwi/cwi-backend.env`, quyền `600`, và được truyền vào runtime qua `CWI_ENV_FILE`.

## An toàn dữ liệu và rollback

Quy trình tạo release không chạy SQL, không chạy migration, không reset database và không xoá dữ liệu Supabase, Storage hoặc RabbitMQ. Release mới được kiểm tra trên cổng staging trước khi đổi PM2. Nếu liveness/readiness hoặc static smoke check thất bại, release trước được khởi động lại.

Giữ tối thiểu ba release artifact gần nhất. Chỉ dùng tùy chọn dọn source legacy sau khi đã xác nhận PM2 đang chạy từ artifact mới:

```bash
bash install-production-artifact.sh \
  --artifact /home/ubuntu/cwi-platform/incoming/cwi-release-RELEASE_ID.tar.gz \
  --prune-legacy-source
```

Quy trình này không bao gồm và không chỉnh `~/cwi-ai`.

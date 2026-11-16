# Triển khai

Production chạy bản build đóng gói sẵn của ba ứng dụng (`cwi-backend`, `cwi-fe-landing-page`, `cwi-fe-dashboard`), quản lý bằng PM2. Server không giữ mã nguồn và không build.

1. **Đóng gói** (máy phát triển, ba repo nằm cạnh nhau, sạch và đã đồng bộ `main`):

   ```powershell
   .\deploy\build-production-artifact.ps1
   ```

   Script chạy typecheck, lint, test của cả ba repo rồi mới build, và tạo `.artifacts/cwi-release-<id>.tar.gz`. `-SkipChecks` chỉ dùng khi khẩn cấp.
2. **Cài đặt** trên server: chép gói và `install-production-artifact.sh` lên, rồi chạy

   ```bash
   bash install-production-artifact.sh --artifact <file .tar.gz> --release-id <id>
   ```

   Script chạy thử bản mới trên cổng staging, chuyển PM2 sang khi kiểm tra đạt, và tự quay về bản cũ nếu lỗi. Giữ 5 bản gần nhất.

Secret nằm ngoài gói, trong file do `CWI_ENV_FILE` chỉ tới. Quy trình không chạy SQL migration và không xoá dữ liệu.

Các file khác:

- `ecosystem.config.cjs`: cấu hình PM2
- `cwi-public-router.mjs`: phục vụ landing, `/dashboard/` và chuyển tiếp `/api`
- `nginx/`: cấu hình nginx
- `rabbitmq/`: RabbitMQ cho worker gửi email
- `ops/`: backup tự động có mã hoá, đổi khoá Supabase

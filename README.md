# cwi-backend

Backend của CEO Workforce Index: API cho trang công khai (khảo sát, đăng ký CEO Roundtable/Webinar, báo cáo quý) và trang quản trị, cùng các worker tạo báo cáo, gửi email và xuất Excel.

Node.js 24, TypeScript, Express 5, PostgreSQL (Supabase), RabbitMQ.

## Chạy local

```bash
npm install
cp .env.example .env    # điền DATABASE_URL và các secret
npm run dev             # API
npm run dev:report-generation-worker
npm run dev:report-delivery-worker
npm run dev:export-worker
```

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm test
npm run test:db   # chạy trên PostgreSQL local, mọi dữ liệu ghi đều được rollback
```

## Cấu trúc

- `src/`: `server.ts`, các worker, `config/`, `db/`, `http/`, `modules/<tính năng>/`
- `tests/`: test vitest
- `deploy/`: đóng gói và cài đặt production, PM2, nginx, RabbitMQ, công cụ vận hành (`deploy/ops/`)

Triển khai: xem `deploy/README.md`.

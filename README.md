# CWI Backend

Express + TypeScript backend for receiving CEO Workforce Index survey submissions and serving the admin dashboard.

## Local Setup

```powershell
Set-Location D:\CWI\cwi-backend
npm install
Copy-Item .env.example .env
npm run dev
```

Required production secrets/config live in `.env`; do not put real secrets in source control.

## Endpoints

Health:
- `GET /health` - backwards-compatible liveness endpoint.
- `GET /healthz` - liveness endpoint.
- `GET /readyz` - read-only PostgreSQL readiness check.

Public:
- `POST /api/v1/survey-submissions`
- `POST /api/v1/roundtable-registrations`
- `GET /api/v1/public/report-jobs/:id/status` (requires the per-report `X-CWI-Report-Token` header)
- `GET /api/v1/public/report-jobs/:id/html` (requires the per-report `X-CWI-Report-Token` header)

Admin auth:
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`

Admin dashboard API:
- `GET /api/v1/admin/survey-submissions/page`
- `GET /api/v1/admin/survey-submissions/stats`
- `GET /api/v1/admin/survey-submissions/:id`
- `GET /api/v1/admin/roundtable-registrations/page`
- `GET /api/v1/admin/roundtable-registrations/stats`
- `GET /api/v1/admin/roundtable-registrations/:id`
- `GET /api/v1/admin/report-jobs/:id/pdf`

Admin list endpoints default to `limit=10` and accept a signed opaque `cursor`. The legacy `before`/`beforeId` pair remains supported during client migration. `limit` must be an integer from 1 to 100; invalid values return `400`.

`GET /api/v1/admin/survey-submissions/full` remains available for compatibility but is deprecated. Its `limit` defaults to 10 and is hard-capped at 10 because each item includes the full answer array. Values above 10 return `400` before any database query. Use the paginated list endpoint and fetch one detail record by ID instead of loading answer arrays for many users in one request.

The submission list/detail response does not expose internal score columns, source, domain scores, or client metadata. PDF responses are authenticated streams from private storage and never expose absolute storage URLs.

Dashboard login uses Supabase Auth password verification on the backend, then stores an internal admin session in `cwi_admin_sessions`. The browser receives an HttpOnly session cookie and a CSRF cookie/header pair. Admin endpoints do not expose database credentials, service-role keys, or API keys to the frontend.

## Admin Bootstrap

1. Run the manual survey schema SQL if it has not been run yet.
2. Run `D:\CWI\supabase-cwi\supabase\manual_sql\20260820_0000_create_cwi_admin_auth.sql` manually in Supabase Studio.
3. Create a dashboard user in Supabase Studio > Authentication > Users.
4. Insert that `auth.users.id` into `public.cwi_admin_users` using the bootstrap SQL comment in the manual SQL file.

## Submission Status

- `part1_only`: user completed Part 1 and submitted Part 1 report.
- `part2_refused_privacy`: user completed Part 1 + Part 2, selected "Không đồng ý" privacy consent, and requested Part 1 report. Full Part 2 answers are still stored.
- `full_private_report`: user completed Part 1 + Part 2, selected "Đồng ý" privacy consent, and submitted the full report request.

Every stored submission has a non-empty `status_note`. If the client does not provide one, the backend writes the canonical note for the selected status.

## Public Submit Payload

```json
{
  "submissionStatus": "part1_only",
  "participant": {
    "fullName": "Nguyen Van An",
    "email": "an@company.com",
    "position": "HRM"
  },
  "privacyConsent": "not_applicable",
  "answers": [
    { "idx": 1, "answer": 4 }
  ],
  "roundtableRegistration": {
    "registered": true,
    "fullName": "Nguyen Van An",
    "email": "an@company.com"
  }
}
```

The backend stores canonical question text from `src/modules/survey/surveyQuestions.ts`; client-provided question text is ignored.

## Production Deployment

Production chạy bằng artifact đã build và kiểm tra từ máy local hoặc CI; máy chủ không cần giữ Git repository hay raw source của ba ứng dụng. Xem `DEPLOYMENT_ARTIFACT.md` và `deploy/README.md` để tạo, gửi, kiểm tra, rollback và dọn release.

`deploy/build-production-artifact.ps1` chỉ đóng gói `dist`, runtime launcher, production dependencies metadata và checksum. `deploy/install-production-artifact.sh` cài release mới qua staging health check trước khi thay PM2. Secrets nằm ngoài release qua `CWI_ENV_FILE`; quy trình không chạy SQL migration và không tác động dữ liệu Supabase.

## V3 Report Pipeline

The asynchronous report pipeline is opt-in. Before enabling it in an environment, apply
`D:\CWI\supabase-cwi\supabase\manual_sql\20260903_0000_add_v3_report_email_bridge.sql` manually in the matching Supabase project. The application does not apply this SQL during startup or deployment.

Set these server-side flags only after the SQL and the CWI AI service are ready:

- `REPORT_SERVICE_ENABLED=true` enables the dedicated report-generation worker.
- `REPORT_SERVICE_BASE_URL` points to the internal CWI AI service; the worker calls only the registered V3 paths.
- `REPORT_DELIVERY_ENABLED=true` enables the RabbitMQ/SMTP delivery worker.
- `REPORT_AUTO_EMAIL_ENABLED=true` queues one automatic email after a report PDF is stored successfully.
- `REPORT_STORAGE_BUCKET` is the private bucket for generated HTML/PDF assets.

Routing follows the survey state: `part1_only` and `part2_refused_privacy` use `POST /v3/reports/anonymous`; `full_private_report` uses `POST /v3/reports/personalized`. The worker polls `GET /v3/report-jobs/{job_id}`, fetches the completed HTML from `GET /v3/reports/{report_id}`, validates and renders it with the configured Chromium/Chrome/Edge executable, uploads HTML and PDF to private Supabase Storage, then creates the email job in the same database transaction as the completed report state. The email worker sends through SMTP with bounded concurrency, leases, retry backoff, and delivery-ambiguous protection.

When report generation is enabled, the survey response also contains a short-lived, HMAC-signed access token scoped to that report job. The frontend polls the public status endpoint and fetches the HTML once `htmlAvailable=true`; it renders the returned document in a sandboxed iframe. HTML is published before PDF rendering, while the generation worker keeps its database lease until PDF and email-job creation complete, so another worker cannot process the same job concurrently. The public endpoints return no participant data, Storage URL, error detail, or report payload metadata.

The PM2 process `cwi-report-generation-worker` handles AI/PDF work separately from `cwi-report-delivery-worker`. Keep report generation at one process on a small server; scale only after measuring CWI AI, browser, database, storage, and SMTP capacity. A failed email is exposed through the admin `emailStatus=failed` filter and can be retried per submission. Automatic reports are never replaced by a manual upload after an email has been sent.

## Supabase

Manual SQL is in:

```text
D:\CWI\supabase-cwi\supabase\manual_sql
```

Review and execute migrations manually from the CWI Supabase project only.

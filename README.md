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

`deploy/update-production.sh` fetches `origin/main`, creates isolated Git worktrees, installs/builds all three applications, runs liveness/readiness and static smoke checks, then replaces the PM2 processes with the staged release. It keeps the previous release available for rollback and never runs database migrations during a code deploy.

## Supabase

Manual SQL is in:

```text
D:\CWI\supabase-cwi\supabase\manual_sql
```

Codex must not apply migrations directly. Review and execute SQL manually from the CWI Supabase project only.

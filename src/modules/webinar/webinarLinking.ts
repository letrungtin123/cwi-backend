import type pg from 'pg'

export const WEBINAR_EMAIL_LOCK_NAMESPACE = 739272

export type WebinarRow = {
  email: string
  id: string
  payload_hash: string | null
  registered_at: Date
  registered: boolean
  submission_id: string | null
}

export type SubmissionEmailRow = {
  email: string
  id: string
}

export async function lockWebinarEmail(client: pg.PoolClient, email: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [email, WEBINAR_EMAIL_LOCK_NAMESPACE])
}

export async function findWebinarByEmail(client: pg.PoolClient, email: string) {
  const result = await client.query<WebinarRow>(
    `
    SELECT id, email, payload_hash, registered, registered_at, submission_id
    FROM public.cwi_webinar_registrations
    WHERE lower(btrim(email)) = $1
      AND registered = true
    ORDER BY registered_at ASC, id ASC
    LIMIT 1
    `,
    [email],
  )

  return result.rows[0] ?? null
}

export async function findLatestSubmissionByEmail(client: pg.PoolClient, email: string) {
  const result = await client.query<SubmissionEmailRow>(
    `
    SELECT id, email
    FROM public.cwi_survey_submissions
    WHERE lower(email) = $1
    ORDER BY submitted_at DESC, id DESC
    LIMIT 1
    `,
    [email],
  )

  return result.rows[0] ?? null
}

export async function linkWebinarIfUnlinked(client: pg.PoolClient, row: WebinarRow, submissionId: string | null) {
  if (row.submission_id || !submissionId) return row

  const result = await client.query<WebinarRow>(
    `
    UPDATE public.cwi_webinar_registrations
    SET submission_id = $1,
        linked_at = COALESCE(linked_at, now()),
        updated_at = now()
    WHERE id = $2
      AND submission_id IS NULL
    RETURNING id, email, payload_hash, registered, registered_at, submission_id
    `,
    [submissionId, row.id],
  )

  return result.rows[0] ?? row
}

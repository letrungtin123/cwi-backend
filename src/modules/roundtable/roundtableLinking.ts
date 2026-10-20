import type pg from 'pg'

export const ROUNDTABLE_EMAIL_LOCK_NAMESPACE = 739271

export type RoundtableRow = {
  email: string
  id: string
  payload_hash: string | null
  quarter: string
  registered_at: Date
  registered: boolean
  submission_id: string | null
}

export type SubmissionEmailRow = {
  email: string
  id: string
}

const roundtableColumns = 'id, email, payload_hash, quarter, registered, registered_at, submission_id'

export async function lockRoundtableEmail(client: pg.PoolClient, email: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [email, ROUNDTABLE_EMAIL_LOCK_NAMESPACE])
}

// An email may register once per quarter, so every lookup is scoped to one quarter.
export async function findRoundtableByEmail(client: pg.PoolClient, email: string, quarter: string) {
  const result = await client.query<RoundtableRow>(
    `
    SELECT ${roundtableColumns}
    FROM public.cwi_roundtable_registrations
    WHERE lower(btrim(email)) = $1
      AND quarter = $2
      AND registered = true
    ORDER BY registered_at ASC, id ASC
    LIMIT 1
    `,
    [email, quarter],
  )

  return result.rows[0] ?? null
}

export async function findRoundtableById(client: pg.PoolClient, id: string) {
  const result = await client.query<RoundtableRow>(
    `
    SELECT ${roundtableColumns}
    FROM public.cwi_roundtable_registrations
    WHERE id = $1
      AND registered = true
    FOR UPDATE
    `,
    [id],
  )

  return result.rows[0] ?? null
}

export async function findLatestSubmissionByEmail(client: pg.PoolClient, email: string, quarter: string) {
  const result = await client.query<SubmissionEmailRow>(
    `
    SELECT id, email
    FROM public.cwi_survey_submissions
    WHERE lower(email) = $1
      AND survey_version = $2
    ORDER BY submitted_at DESC, id DESC
    LIMIT 1
    `,
    [email, quarter],
  )

  return result.rows[0] ?? null
}

export async function linkRoundtableIfUnlinked(client: pg.PoolClient, row: RoundtableRow, submissionId: string | null) {
  if (row.submission_id || !submissionId) return row

  const result = await client.query<RoundtableRow>(
    `
    UPDATE public.cwi_roundtable_registrations
    SET submission_id = $1,
        linked_at = COALESCE(linked_at, now()),
        updated_at = now()
    WHERE id = $2
      AND submission_id IS NULL
    RETURNING ${roundtableColumns}
    `,
    [submissionId, row.id],
  )

  return result.rows[0] ?? row
}

// Only submissions of the same quarter are marked; earlier quarters keep their flag.
export async function syncSurveyRoundtableFlags(client: pg.PoolClient, email: string, quarter: string) {
  await client.query(
    `
    UPDATE public.cwi_survey_submissions
    SET roundtable_registered = true
    WHERE lower(email) = $1
      AND survey_version = $2
    `,
    [email, quarter],
  )
}

import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import type { RequestMeta } from '../../http/requestMeta.js'
import type { NormalizedRoundtableRegistration } from './roundtableValidation.js'

export type RoundtableRegistrationCreateResult = {
  deduplicated: boolean
  id: string
  linkedSubmissionId: string | null
  registeredAt: string
}

export interface RoundtableRepository {
  createRegistration(input: NormalizedRoundtableRegistration, meta: RequestMeta): Promise<RoundtableRegistrationCreateResult>
}

type ExistingRegistrationRow = {
  id: string
  payload_hash: string | null
  registered_at: Date
  submission_id: string | null
}

type InsertedRegistrationRow = {
  id: string
  registered_at: Date
  submission_id: string | null
}

type SubmissionRow = {
  id: string
}

function dateToIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function assertSamePayload(row: ExistingRegistrationRow, input: NormalizedRoundtableRegistration) {
  if (row.payload_hash && row.payload_hash !== input.payloadHash) {
    throw new HttpError(
      409,
      'roundtable_idempotency_key_conflict',
      'Roundtable registration idempotency key was already used with a different payload.',
    )
  }
}

async function findLinkedSubmission(client: pg.PoolClient, input: NormalizedRoundtableRegistration) {
  if (!input.surveySubmissionIdempotencyKey) return null

  const result = await client.query<SubmissionRow>(
    `
    SELECT id
    FROM public.cwi_survey_submissions
    WHERE idempotency_key = $1
    LIMIT 1
    `,
    [input.surveySubmissionIdempotencyKey],
  )

  return result.rows[0]?.id ?? null
}

async function syncSubmissionRoundtableFlag(client: pg.PoolClient, submissionId: string | null) {
  if (!submissionId) return

  await client.query(
    `
    UPDATE public.cwi_survey_submissions
    SET roundtable_registered = true
    WHERE id = $1
    `,
    [submissionId],
  )
}

async function linkExistingRegistration(
  client: pg.PoolClient,
  row: ExistingRegistrationRow,
  linkedSubmissionId: string | null,
) {
  if (row.submission_id || !linkedSubmissionId) return row

  const linked = await client.query<ExistingRegistrationRow>(
    `
    UPDATE public.cwi_roundtable_registrations
    SET submission_id = $1,
        linked_at = COALESCE(linked_at, now()),
        updated_at = now()
    WHERE id = $2
      AND submission_id IS NULL
    RETURNING id, payload_hash, registered_at, submission_id
    `,
    [linkedSubmissionId, row.id],
  )

  return linked.rows[0] ?? row
}

export class PgRoundtableRepository implements RoundtableRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createRegistration(input: NormalizedRoundtableRegistration, meta: RequestMeta): Promise<RoundtableRegistrationCreateResult> {
    return withTransaction(this.pool, async (client) => {
      const linkedSubmissionId = await findLinkedSubmission(client, input)

      if (input.idempotencyKey) {
        const existing = await client.query<ExistingRegistrationRow>(
          `
          SELECT id, payload_hash, registered_at, submission_id
          FROM public.cwi_roundtable_registrations
          WHERE idempotency_key = $1
          LIMIT 1
          `,
          [input.idempotencyKey],
        )

        const row = existing.rows[0]
        if (row) {
          assertSamePayload(row, input)
          const linkedRow = await linkExistingRegistration(client, row, linkedSubmissionId)
          await syncSubmissionRoundtableFlag(client, linkedRow.submission_id)

          return {
            deduplicated: true,
            id: linkedRow.id,
            linkedSubmissionId: linkedRow.submission_id,
            registeredAt: dateToIso(linkedRow.registered_at),
          }
        }
      }

      if (input.surveySubmissionIdempotencyKey) {
        const existingBySurveyKey = await client.query<ExistingRegistrationRow>(
          `
          SELECT id, payload_hash, registered_at, submission_id
          FROM public.cwi_roundtable_registrations
          WHERE survey_submission_idempotency_key = $1
          LIMIT 1
          `,
          [input.surveySubmissionIdempotencyKey],
        )

        const row = existingBySurveyKey.rows[0]
        if (row) {
          assertSamePayload(row, input)
          const linkedRow = await linkExistingRegistration(client, row, linkedSubmissionId)
          await syncSubmissionRoundtableFlag(client, linkedRow.submission_id)

          return {
            deduplicated: true,
            id: linkedRow.id,
            linkedSubmissionId: linkedRow.submission_id,
            registeredAt: dateToIso(linkedRow.registered_at),
          }
        }
      }

      const inserted = await client.query<InsertedRegistrationRow>(
        `
        INSERT INTO public.cwi_roundtable_registrations (
          submission_id,
          registered,
          full_name,
          email,
          position,
          idempotency_key,
          payload_hash,
          survey_submission_idempotency_key,
          source,
          client_ip_hash,
          user_agent,
          client_meta,
          linked_at
        )
        VALUES (
          $1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
          CASE WHEN $1::uuid IS NULL THEN NULL ELSE now() END
        )
        RETURNING id, registered_at, submission_id
        `,
        [
          linkedSubmissionId,
          input.fullName,
          input.email,
          input.position,
          input.idempotencyKey,
          input.payloadHash,
          input.surveySubmissionIdempotencyKey,
          meta.source,
          meta.clientIpHash,
          meta.userAgent,
          JSON.stringify(input.clientMeta),
        ],
      )

      const row = inserted.rows[0]
      if (!row) {
        throw new HttpError(500, 'roundtable_insert_failed', 'Failed to create roundtable registration.')
      }

      await syncSubmissionRoundtableFlag(client, row.submission_id)

      return {
        deduplicated: false,
        id: row.id,
        linkedSubmissionId: row.submission_id,
        registeredAt: dateToIso(row.registered_at),
      }
    })
  }
}

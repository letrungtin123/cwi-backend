import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import type { RequestMeta } from '../../http/requestMeta.js'
import {
  findLatestSubmissionByEmail,
  findWebinarByEmail,
  linkWebinarIfUnlinked,
  lockWebinarEmail,
  type WebinarRow,
} from './webinarLinking.js'
import type { NormalizedWebinarRegistration } from './webinarValidation.js'

export type WebinarRegistrationCreateResult = {
  deduplicated: boolean
  id: string
  linkedSubmissionId: string | null
  registeredAt: string
}

export interface WebinarRepository {
  checkRegistration(email: string): Promise<{ registered: boolean }>
  createRegistration(input: NormalizedWebinarRegistration, meta: RequestMeta): Promise<WebinarRegistrationCreateResult>
}

type InsertedRegistrationRow = {
  id: string
  registered_at: Date
  submission_id: string | null
}

type SubmissionRow = {
  email: string
  id: string
}

function dateToIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function assertSamePayload(row: Pick<WebinarRow, 'email' | 'payload_hash'>, input: NormalizedWebinarRegistration) {
  if (row.email.trim().toLowerCase() !== input.email) {
    throw new HttpError(409, 'webinar_idempotency_key_conflict', 'Webinar registration key does not match the registration email.')
  }
  if (row.payload_hash && row.payload_hash !== input.payloadHash) {
    throw new HttpError(
      409,
      'webinar_idempotency_key_conflict',
      'Webinar registration idempotency key was already used with a different payload.',
    )
  }
}

async function findSubmissionForInput(client: pg.PoolClient, input: NormalizedWebinarRegistration) {
  if (input.surveySubmissionIdempotencyKey) {
    const result = await client.query<SubmissionRow>(
      `
      SELECT id, email
      FROM public.cwi_survey_submissions
      WHERE idempotency_key = $1
      LIMIT 1
      `,
      [input.surveySubmissionIdempotencyKey],
    )

    const row = result.rows[0]
    if (row && row.email.trim().toLowerCase() !== input.email) {
      throw new HttpError(409, 'webinar_survey_email_mismatch', 'Webinar email must match the survey email.')
    }
    return row?.id ?? null
  }

  const latest = await findLatestSubmissionByEmail(client, input.email)
  return latest?.id ?? null
}

async function findByIdempotencyKey(client: pg.PoolClient, key: string) {
  const result = await client.query<WebinarRow>(
    `
    SELECT id, email, payload_hash, registered, registered_at, submission_id
    FROM public.cwi_webinar_registrations
    WHERE idempotency_key = $1
      AND registered = true
    LIMIT 1
    `,
    [key],
  )

  return result.rows[0] ?? null
}

async function findBySurveyKey(client: pg.PoolClient, key: string) {
  const result = await client.query<WebinarRow>(
    `
    SELECT id, email, payload_hash, registered, registered_at, submission_id
    FROM public.cwi_webinar_registrations
    WHERE survey_submission_idempotency_key = $1
      AND registered = true
    LIMIT 1
    `,
    [key],
  )

  return result.rows[0] ?? null
}

async function completeExistingRegistration(client: pg.PoolClient, row: WebinarRow, linkedSubmissionId: string | null) {
  return linkWebinarIfUnlinked(client, row, linkedSubmissionId)
}

export class PgWebinarRepository implements WebinarRepository {
  constructor(private readonly pool: pg.Pool) {}

  async checkRegistration(email: string) {
    const result = await this.pool.query<{ registered: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM public.cwi_webinar_registrations
        WHERE lower(btrim(email)) = $1
          AND registered = true
      ) AS registered
      `,
      [email],
    )

    return { registered: Boolean(result.rows[0]?.registered) }
  }

  async createRegistration(input: NormalizedWebinarRegistration, meta: RequestMeta): Promise<WebinarRegistrationCreateResult> {
    return withTransaction(this.pool, async (client) => {
      if (input.idempotencyKey) {
        const existing = await findByIdempotencyKey(client, input.idempotencyKey)
        if (existing) {
          assertSamePayload(existing, input)
          await lockWebinarEmail(client, input.email)
          const linkedSubmissionId = await findSubmissionForInput(client, input)
          const linkedRow = await completeExistingRegistration(client, existing, linkedSubmissionId)
          return {
            deduplicated: true,
            id: linkedRow.id,
            linkedSubmissionId: linkedRow.submission_id,
            registeredAt: dateToIso(linkedRow.registered_at),
          }
        }
      }

      await lockWebinarEmail(client, input.email)

      if (input.idempotencyKey) {
        const existing = await findByIdempotencyKey(client, input.idempotencyKey)
        if (existing) {
          assertSamePayload(existing, input)
          const linkedSubmissionId = await findSubmissionForInput(client, input)
          const linkedRow = await completeExistingRegistration(client, existing, linkedSubmissionId)
          return {
            deduplicated: true,
            id: linkedRow.id,
            linkedSubmissionId: linkedRow.submission_id,
            registeredAt: dateToIso(linkedRow.registered_at),
          }
        }
      }

      const linkedSubmissionId = await findSubmissionForInput(client, input)
      const existingBySurveyKey = input.surveySubmissionIdempotencyKey
        ? await findBySurveyKey(client, input.surveySubmissionIdempotencyKey)
        : null

      if (existingBySurveyKey) {
        assertSamePayload(existingBySurveyKey, input)
        const linkedRow = await completeExistingRegistration(client, existingBySurveyKey, linkedSubmissionId)
        return {
          deduplicated: true,
          id: linkedRow.id,
          linkedSubmissionId: linkedRow.submission_id,
          registeredAt: dateToIso(linkedRow.registered_at),
        }
      }

      const existingByEmail = await findWebinarByEmail(client, input.email)
      if (existingByEmail) {
        const linkedRow = await completeExistingRegistration(client, existingByEmail, linkedSubmissionId)
        return {
          deduplicated: true,
          id: linkedRow.id,
          linkedSubmissionId: linkedRow.submission_id,
          registeredAt: dateToIso(linkedRow.registered_at),
        }
      }

      const inserted = await client.query<InsertedRegistrationRow>(
        `
        INSERT INTO public.cwi_webinar_registrations (
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
        throw new HttpError(500, 'webinar_insert_failed', 'Failed to create webinar registration.')
      }

      return {
        deduplicated: false,
        id: row.id,
        linkedSubmissionId: row.submission_id,
        registeredAt: dateToIso(row.registered_at),
      }
    })
  }
}

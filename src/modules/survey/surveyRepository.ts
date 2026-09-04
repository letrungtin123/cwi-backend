import type pg from 'pg'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import type { RequestMeta } from '../../http/requestMeta.js'
import {
  findRoundtableById,
  findRoundtableByEmail,
  linkRoundtableIfUnlinked,
  lockRoundtableEmail,
  syncSurveyRoundtableFlags,
} from '../roundtable/roundtableLinking.js'
import type { ReportJobCreateInput } from '../reports/reportPayload.js'
import type { NormalizedAnswer, NormalizedSurveySubmission } from './submissionValidation.js'

export type SubmissionCreateResult = {
  deduplicated: boolean
  id: string
  reportAccess?: {
    accessToken: string
    accessTokenExpiresAt: string
    jobId: string
    status: string
  }
  reportJob: {
    id: string
    status: string
  } | null
  submittedAt: string
}

export interface SurveyRepository {
  createSubmission(input: NormalizedSurveySubmission, meta: RequestMeta, reportJob?: ReportJobCreateInput | null): Promise<SubmissionCreateResult>
}

type ExistingSubmissionRow = {
  id: string
  payload_hash: string
  submitted_at: Date
}

type ReportJobRow = {
  id: string
  status: string
}

type InsertedSubmissionRow = {
  id: string
  submitted_at: Date
}

function dateToIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function buildAnswerInsert(answers: readonly NormalizedAnswer[], submissionId: string) {
  const params: unknown[] = []
  const values: string[] = []

  for (const answer of answers) {
    const start = params.length + 1
    values.push(
      `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}::jsonb, $${start + 6}, $${start + 7})`,
    )
    params.push(
      submissionId,
      answer.idx,
      answer.part,
      answer.questionType,
      answer.questionText,
      JSON.stringify(answer.answerValue),
      answer.answerText,
      answer.otherText,
    )
  }

  return { params, values }
}

export class PgSurveyRepository implements SurveyRepository {
  constructor(private readonly pool: pg.Pool) {}

  async createSubmission(input: NormalizedSurveySubmission, meta: RequestMeta, reportJob: ReportJobCreateInput | null = null): Promise<SubmissionCreateResult> {
    return withTransaction(this.pool, async (client) => {
      if (input.idempotencyKey) {
        const existing = await client.query<ExistingSubmissionRow>(
          `
          SELECT id, payload_hash, submitted_at
          FROM public.cwi_survey_submissions
          WHERE idempotency_key = $1
          LIMIT 1
          `,
          [input.idempotencyKey],
        )

        const row = existing.rows[0]
        if (row) {
          if (row.payload_hash !== input.payloadHash) {
            throw new HttpError(
              409,
              'idempotency_key_conflict',
              'Idempotency key was already used with a different payload.',
            )
          }

          const reportJobResult = await client.query<ReportJobRow>(
            `
            SELECT id, status
            FROM public.cwi_report_jobs
            WHERE submission_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            `,
            [row.id],
          )

          return {
            deduplicated: true,
            id: row.id,
            reportJob: reportJobResult.rows[0] ?? null,
            submittedAt: dateToIso(row.submitted_at),
          }
        }
      }

      // Survey submissions may repeat, but Roundtable registration is canonical by email.
      await lockRoundtableEmail(client, input.participant.email)

      const inserted = await client.query<InsertedSubmissionRow>(
        `
        INSERT INTO public.cwi_survey_submissions (
          submission_status,
          status_note,
          full_name,
          email,
          position,
          privacy_consent,
          part1_completed,
          part2_completed,
          answers_count,
          roundtable_registered,
          overall_score,
          scale_score,
          domain_scores,
          idempotency_key,
          payload_hash,
          source,
          client_ip_hash,
          user_agent,
          client_meta
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19::jsonb
        )
        RETURNING id, submitted_at
        `,
        [
          input.submissionStatus,
          input.statusNote,
          input.participant.fullName,
          input.participant.email,
          input.participant.position,
          input.privacyConsent,
          input.part1Completed,
          input.part2Completed,
          input.answers.length,
          Boolean(input.roundtableRegistration),
          input.scores.overallScore,
          input.scores.scaleScore,
          JSON.stringify(input.scores.domainScores),
          input.idempotencyKey,
          input.payloadHash,
          meta.source,
          meta.clientIpHash,
          meta.userAgent,
          JSON.stringify(input.clientMeta),
        ],
      )

      const submission = inserted.rows[0]
      if (!submission) {
        throw new HttpError(500, 'submission_insert_failed', 'Failed to create survey submission.')
      }

      const answerInsert = buildAnswerInsert(input.answers, submission.id)
      await client.query(
        `
        INSERT INTO public.cwi_survey_answers (
          submission_id,
          question_idx,
          part,
          question_type,
          question_text,
          answer_value,
          answer_text,
          other_text
        )
        VALUES ${answerInsert.values.join(', ')}
        `,
        answerInsert.params,
      )

      const explicitRoundtable = input.roundtableRegistration?.id
        ? await findRoundtableById(client, input.roundtableRegistration.id)
        : null

      if (input.roundtableRegistration?.id) {
        if (!explicitRoundtable || explicitRoundtable.email.trim().toLowerCase() !== input.participant.email) {
          throw new HttpError(409, 'roundtable_survey_email_mismatch', 'Roundtable registration must match the survey email.')
        }
      }

      const existingRoundtable = explicitRoundtable ?? await findRoundtableByEmail(client, input.participant.email)
      if (existingRoundtable) {
        await linkRoundtableIfUnlinked(client, existingRoundtable, submission.id)
        await syncSurveyRoundtableFlags(client, input.participant.email)
      } else if (input.roundtableRegistration) {
        await client.query(
          `
          INSERT INTO public.cwi_roundtable_registrations (
            submission_id,
            registered,
            full_name,
            email,
            position,
            source,
            client_ip_hash,
            user_agent,
            client_meta,
            linked_at
          )
          VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
          `,
          [
            submission.id,
            input.roundtableRegistration.fullName,
            input.participant.email,
            input.roundtableRegistration.position,
            meta.source,
            meta.clientIpHash,
            meta.userAgent,
            JSON.stringify(input.clientMeta),
          ],
        )
        await syncSurveyRoundtableFlags(client, input.participant.email)
      }

      if (reportJob) {
        const reportJobInserted = await client.query<ReportJobRow>(
          `
          INSERT INTO public.cwi_report_jobs (
            submission_id,
            report_type,
            provider_endpoint,
            status,
            request_payload,
            next_poll_at
          )
          VALUES ($1, $2, $3, 'pending', $4::jsonb, now())
          RETURNING id, status
          `,
          [submission.id, reportJob.reportType, reportJob.providerEndpoint, JSON.stringify(reportJob.requestPayload)],
        )

        return {
          deduplicated: false,
          id: submission.id,
          reportJob: reportJobInserted.rows[0] ?? null,
          submittedAt: dateToIso(submission.submitted_at),
        }
      }

      return {
        deduplicated: false,
        id: submission.id,
        reportJob: null,
        submittedAt: dateToIso(submission.submitted_at),
      }
    })
  }
}

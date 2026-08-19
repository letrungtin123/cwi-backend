import type pg from 'pg'
import { HttpError } from '../../http/errors.js'

export type SubmissionListItem = {
  answersCount: number
  email: string
  fullName: string
  id: string
  overallScore: number
  part1Completed: boolean
  part2Completed: boolean
  position: string
  privacyConsent: string
  roundtableRegistered: boolean
  scaleScore: number
  statusNote: string
  submittedAt: string
  submissionStatus: string
}

export type SubmissionDetail = SubmissionListItem & {
  answers: Array<{
    answerText: string
    answerValue: unknown
    idx: number
    otherText: string | null
    part: number
    questionText: string
    questionType: string
  }>
  clientMeta: Record<string, unknown>
  domainScores: unknown
  overallScore: number
  roundtableRegistration: {
    email: string
    fullName: string
    registeredAt: string
  } | null
  scaleScore: number
  source: string
}

type SubmissionRow = {
  answers_count: number
  client_meta: Record<string, unknown>
  domain_scores: unknown
  email: string
  full_name: string
  id: string
  overall_score: number
  part1_completed: boolean
  part2_completed: boolean
  position: string
  privacy_consent: string
  roundtable_registered: boolean
  scale_score: number
  source: string
  status_note: string
  submitted_at: Date
  submission_status: string
}

type AnswerRow = {
  answer_text: string
  answer_value: unknown
  other_text: string | null
  part: number
  question_idx: number
  question_text: string
  question_type: string
}

type RoundtableRow = {
  email: string
  full_name: string
  registered_at: Date
}

export type SubmissionListFilters = {
  before: Date | null
  limit: number
  roundtableRegistered: boolean | null
  search: string | null
  status: string | null
}

export type SubmissionStats = {
  averageOverallScore: number
  averageScaleScore: number
  fullPrivateReport: number
  part1Only: number
  part2RefusedPrivacy: number
  roundtableRegistered: number
  totalSubmissions: number
}

type StatsRow = {
  average_overall_score: string | null
  average_scale_score: string | null
  full_private_report: string
  part1_only: string
  part2_refused_privacy: string
  roundtable_registered: string
  total_submissions: string
}

function toIso(value: Date) {
  return value.toISOString()
}

function mapListItem(row: SubmissionRow): SubmissionListItem {
  return {
    answersCount: row.answers_count,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    overallScore: row.overall_score,
    part1Completed: row.part1_completed,
    part2Completed: row.part2_completed,
    position: row.position,
    privacyConsent: row.privacy_consent,
    roundtableRegistered: row.roundtable_registered,
    scaleScore: row.scale_score,
    statusNote: row.status_note,
    submittedAt: toIso(row.submitted_at),
    submissionStatus: row.submission_status,
  }
}

function toNumber(value: string | null) {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export class PgAdminRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listSubmissions(filters: SubmissionListFilters): Promise<SubmissionListItem[]> {
    const params: unknown[] = [filters.before]
    const where = ['($1::timestamptz IS NULL OR submitted_at < $1::timestamptz)']

    if (filters.status) {
      params.push(filters.status)
      where.push(`submission_status = $${params.length}`)
    }

    if (filters.roundtableRegistered !== null) {
      params.push(filters.roundtableRegistered)
      where.push(`roundtable_registered = $${params.length}`)
    }

    if (filters.search) {
      params.push(`%${filters.search}%`)
      where.push(`(full_name ILIKE $${params.length} OR email ILIKE $${params.length} OR position ILIKE $${params.length})`)
    }

    params.push(filters.limit)
    const result = await this.pool.query<SubmissionRow>(
      `
      SELECT
        id,
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
        source,
        client_meta,
        submitted_at
      FROM public.cwi_survey_submissions
      WHERE ${where.join(' AND ')}
      ORDER BY submitted_at DESC, id DESC
      LIMIT $${params.length}
      `,
      params,
    )

    return result.rows.map(mapListItem)
  }

  async getSubmissionStats(): Promise<SubmissionStats> {
    const result = await this.pool.query<StatsRow>(
      `
      SELECT
        count(*)::text AS total_submissions,
        count(*) FILTER (WHERE submission_status = 'part1_only')::text AS part1_only,
        count(*) FILTER (WHERE submission_status = 'part2_refused_privacy')::text AS part2_refused_privacy,
        count(*) FILTER (WHERE submission_status = 'full_private_report')::text AS full_private_report,
        count(*) FILTER (WHERE roundtable_registered = true)::text AS roundtable_registered,
        round(avg(overall_score), 1)::text AS average_overall_score,
        round(avg(scale_score), 1)::text AS average_scale_score
      FROM public.cwi_survey_submissions
      `,
    )

    const row = result.rows[0]
    return {
      averageOverallScore: toNumber(row?.average_overall_score ?? null),
      averageScaleScore: toNumber(row?.average_scale_score ?? null),
      fullPrivateReport: toNumber(row?.full_private_report ?? null),
      part1Only: toNumber(row?.part1_only ?? null),
      part2RefusedPrivacy: toNumber(row?.part2_refused_privacy ?? null),
      roundtableRegistered: toNumber(row?.roundtable_registered ?? null),
      totalSubmissions: toNumber(row?.total_submissions ?? null),
    }
  }

  async getSubmission(id: string): Promise<SubmissionDetail> {
    const [submissionResult, answersResult, roundtableResult] = await Promise.all([
      this.pool.query<SubmissionRow>(
        `
        SELECT
          id,
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
          source,
          client_meta,
          submitted_at
        FROM public.cwi_survey_submissions
        WHERE id = $1
        LIMIT 1
        `,
        [id],
      ),
      this.pool.query<AnswerRow>(
        `
        SELECT question_idx, part, question_type, question_text, answer_value, answer_text, other_text
        FROM public.cwi_survey_answers
        WHERE submission_id = $1
        ORDER BY question_idx ASC
        `,
        [id],
      ),
      this.pool.query<RoundtableRow>(
        `
        SELECT full_name, email, registered_at
        FROM public.cwi_roundtable_registrations
        WHERE submission_id = $1
        LIMIT 1
        `,
        [id],
      ),
    ])

    const row = submissionResult.rows[0]
    if (!row) {
      throw new HttpError(404, 'submission_not_found', 'Survey submission was not found.')
    }

    return {
      ...mapListItem(row),
      answers: answersResult.rows.map((answer) => ({
        answerText: answer.answer_text,
        answerValue: answer.answer_value,
        idx: answer.question_idx,
        otherText: answer.other_text,
        part: answer.part,
        questionText: answer.question_text,
        questionType: answer.question_type,
      })),
      clientMeta: row.client_meta,
      domainScores: row.domain_scores,
      overallScore: row.overall_score,
      roundtableRegistration: roundtableResult.rows[0]
        ? {
            email: roundtableResult.rows[0].email,
            fullName: roundtableResult.rows[0].full_name,
            registeredAt: toIso(roundtableResult.rows[0].registered_at),
          }
        : null,
      scaleScore: row.scale_score,
      source: row.source,
    }
  }
}
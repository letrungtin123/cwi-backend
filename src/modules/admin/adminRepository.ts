import type pg from 'pg'
import { HttpError } from '../../http/errors.js'

export type ReportSummary = {
  errorMessage: string | null
  jobId: string | null
  label: string
  pdfAvailable: boolean
  pdfDownloadUrl: string | null
  status: 'not_started' | 'generating' | 'completed' | 'failed' | 'skipped'
  updatedAt: string | null
}

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
  report: ReportSummary
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
    id: string
    position: string | null
    registeredAt: string
  } | null
  scaleScore: number
  source: string
}
export type SubmissionFullItem = Pick<
  SubmissionListItem,
  | 'answersCount'
  | 'email'
  | 'fullName'
  | 'id'
  | 'part1Completed'
  | 'part2Completed'
  | 'roundtableRegistered'
  | 'statusNote'
  | 'submittedAt'
> & {
  answers: SubmissionDetail['answers']
  roundtableRegistration: SubmissionDetail['roundtableRegistration']
}

export type SubmissionDetailListFilters = {
  limit: number
  page: number
  roundtableRegistered: boolean | null
  search: string | null
  status: string | null
}

export type SubmissionDetailListResult = {
  items: SubmissionFullItem[]
  totalItems: number
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
  report_job_id: string | null
  report_last_error_message: string | null
  report_pdf_storage_path: string | null
  report_status: string | null
  report_updated_at: Date | null
  roundtable_registered: boolean
  scale_score: number
  source: string
  status_note: string
  submitted_at: Date
  submission_status: string
}

type AnswerRow = {
  submission_id: string
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
  id: string
  position: string | null
  registered_at: Date
  submission_id: string
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

export type RoundtableLinkStatus = 'linked' | 'standalone'

export type RoundtableSubmissionSummary = {
  answersCount: number
  email: string
  fullName: string
  id: string
  position: string
  privacyConsent: string
  report: ReportSummary
  statusNote: string
  submittedAt: string
  submissionStatus: string
}

export type RoundtableRegistrationListItem = {
  email: string
  fullName: string
  id: string
  linkedSubmission: RoundtableSubmissionSummary | null
  position: string | null
  registeredAt: string
  source: string
}

export type RoundtableRegistrationDetail = RoundtableRegistrationListItem & {
  clientMeta: Record<string, unknown>
  surveySubmissionIdempotencyKey: string | null
  userAgent: string | null
}

export type RoundtableRegistrationFilters = {
  before: Date | null
  limit: number
  linkStatus: RoundtableLinkStatus | null
  search: string | null
}

export type RoundtableRegistrationStats = {
  linkedSubmissions: number
  standaloneRegistrations: number
  todayRegistrations: number
  totalRegistrations: number
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

type RoundtableRegistrationRow = {
  client_meta: Record<string, unknown>
  email: string
  full_name: string
  id: string
  position: string | null
  registered_at: Date
  report_job_id: string | null
  report_last_error_message: string | null
  report_pdf_storage_path: string | null
  report_status: string | null
  report_updated_at: Date | null
  source: string
  submission_answers_count: number | null
  submission_email: string | null
  submission_full_name: string | null
  submission_id: string | null
  submission_position: string | null
  submission_privacy_consent: string | null
  submission_status: string | null
  submission_status_note: string | null
  submission_submitted_at: Date | null
  survey_submission_idempotency_key: string | null
  user_agent: string | null
}

type RoundtableStatsRow = {
  linked_submissions: string
  standalone_registrations: string
  today_registrations: string
  total_registrations: string
}

const submissionSelect = `
  SELECT
    s.id,
    s.submission_status,
    s.status_note,
    s.full_name,
    s.email,
    s.position,
    s.privacy_consent,
    s.part1_completed,
    s.part2_completed,
    s.answers_count,
    s.roundtable_registered,
    s.overall_score,
    s.scale_score,
    s.domain_scores,
    s.source,
    s.client_meta,
    s.submitted_at,
    report.id AS report_job_id,
    report.status AS report_status,
    report.updated_at AS report_updated_at,
    report.pdf_storage_path AS report_pdf_storage_path,
    COALESCE(report.last_error_message, report.error_message) AS report_last_error_message
  FROM public.cwi_survey_submissions AS s
  LEFT JOIN LATERAL (
    SELECT id, status, updated_at, pdf_storage_path, last_error_message, error_message
    FROM public.cwi_report_jobs
    WHERE submission_id = s.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) AS report ON true
`

const roundtableSelect = `
  SELECT
    r.id,
    r.full_name,
    r.email,
    r.position,
    r.registered_at,
    r.source,
    r.client_meta,
    r.user_agent,
    r.survey_submission_idempotency_key,
    s.id AS submission_id,
    s.full_name AS submission_full_name,
    s.email AS submission_email,
    s.position AS submission_position,
    s.submission_status,
    s.status_note AS submission_status_note,
    s.privacy_consent AS submission_privacy_consent,
    s.answers_count AS submission_answers_count,
    s.submitted_at AS submission_submitted_at,
    report.id AS report_job_id,
    report.status AS report_status,
    report.updated_at AS report_updated_at,
    report.pdf_storage_path AS report_pdf_storage_path,
    COALESCE(report.last_error_message, report.error_message) AS report_last_error_message
  FROM public.cwi_roundtable_registrations AS r
  LEFT JOIN public.cwi_survey_submissions AS s ON s.id = r.submission_id
  LEFT JOIN LATERAL (
    SELECT id, status, updated_at, pdf_storage_path, last_error_message, error_message
    FROM public.cwi_report_jobs
    WHERE submission_id = s.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) AS report ON true
`

function toIso(value: Date) {
  return value.toISOString()
}

function mapReportSummary(row: SubmissionRow): ReportSummary {
  if (!row.report_job_id) {
    return {
      errorMessage: null,
      jobId: null,
      label: 'Chưa tạo báo cáo',
      pdfAvailable: false,
      pdfDownloadUrl: null,
      status: 'not_started',
      updatedAt: null,
    }
  }

  if (row.report_status === 'completed') {
    const pdfAvailable = Boolean(row.report_pdf_storage_path)
    return {
      errorMessage: null,
      jobId: row.report_job_id,
      label: pdfAvailable ? 'Đã tạo báo cáo' : 'Đã tạo, thiếu PDF',
      pdfAvailable,
      pdfDownloadUrl: pdfAvailable ? `/api/v1/admin/report-jobs/${row.report_job_id}/pdf` : null,
      status: 'completed',
      updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
    }
  }

  if (row.report_status === 'failed') {
    return {
      errorMessage: row.report_last_error_message,
      jobId: row.report_job_id,
      label: 'Tạo báo cáo lỗi',
      pdfAvailable: false,
      pdfDownloadUrl: null,
      status: 'failed',
      updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
    }
  }

  if (row.report_status === 'skipped') {
    return {
      errorMessage: row.report_last_error_message,
      jobId: row.report_job_id,
      label: 'Không tạo báo cáo',
      pdfAvailable: false,
      pdfDownloadUrl: null,
      status: 'skipped',
      updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
    }
  }

  return {
    errorMessage: row.report_last_error_message,
    jobId: row.report_job_id,
    label: 'Đang tạo báo cáo',
    pdfAvailable: false,
    pdfDownloadUrl: null,
    status: 'generating',
    updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
  }
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
    report: mapReportSummary(row),
    roundtableRegistered: row.roundtable_registered,
    scaleScore: row.scale_score,
    statusNote: row.status_note,
    submittedAt: toIso(row.submitted_at),
    submissionStatus: row.submission_status,
  }
}

function mapRoundtableReportSummary(row: RoundtableRegistrationRow): ReportSummary {
  if (!row.report_job_id) {
    return {
      errorMessage: null,
      jobId: null,
      label: 'Chưa tạo báo cáo',
      pdfAvailable: false,
      pdfDownloadUrl: null,
      status: 'not_started',
      updatedAt: null,
    }
  }

  if (row.report_status === 'completed') {
    const pdfAvailable = Boolean(row.report_pdf_storage_path)
    return {
      errorMessage: null,
      jobId: row.report_job_id,
      label: pdfAvailable ? 'Đã tạo báo cáo' : 'Đã tạo, thiếu PDF',
      pdfAvailable,
      pdfDownloadUrl: pdfAvailable ? `/api/v1/admin/report-jobs/${row.report_job_id}/pdf` : null,
      status: 'completed',
      updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
    }
  }

  if (row.report_status === 'failed') {
    return {
      errorMessage: row.report_last_error_message,
      jobId: row.report_job_id,
      label: 'Tạo báo cáo lỗi',
      pdfAvailable: false,
      pdfDownloadUrl: null,
      status: 'failed',
      updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
    }
  }

  if (row.report_status === 'skipped') {
    return {
      errorMessage: row.report_last_error_message,
      jobId: row.report_job_id,
      label: 'Không tạo báo cáo',
      pdfAvailable: false,
      pdfDownloadUrl: null,
      status: 'skipped',
      updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
    }
  }

  return {
    errorMessage: row.report_last_error_message,
    jobId: row.report_job_id,
    label: 'Đang tạo báo cáo',
    pdfAvailable: false,
    pdfDownloadUrl: null,
    status: 'generating',
    updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
  }
}

function mapRoundtableLinkedSubmission(row: RoundtableRegistrationRow): RoundtableSubmissionSummary | null {
  if (!row.submission_id || !row.submission_submitted_at) return null

  return {
    answersCount: row.submission_answers_count ?? 0,
    email: row.submission_email ?? '',
    fullName: row.submission_full_name ?? '',
    id: row.submission_id,
    position: row.submission_position ?? '',
    privacyConsent: row.submission_privacy_consent ?? '',
    report: mapRoundtableReportSummary(row),
    statusNote: row.submission_status_note ?? '',
    submittedAt: toIso(row.submission_submitted_at),
    submissionStatus: row.submission_status ?? '',
  }
}

function mapRoundtableRegistration(row: RoundtableRegistrationRow): RoundtableRegistrationListItem {
  return {
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    linkedSubmission: mapRoundtableLinkedSubmission(row),
    position: row.position,
    registeredAt: toIso(row.registered_at),
    source: row.source,
  }
}

function mapRoundtableRegistrationDetail(row: RoundtableRegistrationRow): RoundtableRegistrationDetail {
  return {
    ...mapRoundtableRegistration(row),
    clientMeta: row.client_meta,
    surveySubmissionIdempotencyKey: row.survey_submission_idempotency_key,
    userAgent: row.user_agent,
  }
}

function toNumber(value: string | null) {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export class PgAdminRepository {
  constructor(private readonly pool: pg.Pool) {}

  async listRoundtableRegistrations(filters: RoundtableRegistrationFilters): Promise<RoundtableRegistrationListItem[]> {
    const params: unknown[] = [filters.before]
    const where = ['($1::timestamptz IS NULL OR r.registered_at < $1::timestamptz)']

    if (filters.linkStatus === 'linked') {
      where.push('r.submission_id IS NOT NULL')
    } else if (filters.linkStatus === 'standalone') {
      where.push('r.submission_id IS NULL')
    }

    if (filters.search) {
      params.push(`%${filters.search}%`)
      where.push(
        `(r.full_name ILIKE $${params.length}
          OR r.email ILIKE $${params.length}
          OR r.position ILIKE $${params.length}
          OR s.full_name ILIKE $${params.length}
          OR s.email ILIKE $${params.length}
          OR s.position ILIKE $${params.length})`,
      )
    }

    params.push(filters.limit)
    const result = await this.pool.query<RoundtableRegistrationRow>(
      `
      ${roundtableSelect}
      WHERE ${where.join(' AND ')}
      ORDER BY r.registered_at DESC, r.id DESC
      LIMIT $${params.length}
      `,
      params,
    )

    return result.rows.map(mapRoundtableRegistration)
  }

  async getRoundtableRegistrationStats(): Promise<RoundtableRegistrationStats> {
    const result = await this.pool.query<RoundtableStatsRow>(
      `
      SELECT
        count(*)::text AS total_registrations,
        count(*) FILTER (WHERE submission_id IS NOT NULL)::text AS linked_submissions,
        count(*) FILTER (WHERE submission_id IS NULL)::text AS standalone_registrations,
        count(*) FILTER (WHERE registered_at >= date_trunc('day', now()))::text AS today_registrations
      FROM public.cwi_roundtable_registrations
      `,
    )

    const row = result.rows[0]
    return {
      linkedSubmissions: toNumber(row?.linked_submissions ?? null),
      standaloneRegistrations: toNumber(row?.standalone_registrations ?? null),
      todayRegistrations: toNumber(row?.today_registrations ?? null),
      totalRegistrations: toNumber(row?.total_registrations ?? null),
    }
  }

  async getRoundtableRegistration(id: string): Promise<RoundtableRegistrationDetail> {
    const result = await this.pool.query<RoundtableRegistrationRow>(
      `
      ${roundtableSelect}
      WHERE r.id = $1
      LIMIT 1
      `,
      [id],
    )

    const row = result.rows[0]
    if (!row) {
      throw new HttpError(404, 'roundtable_registration_not_found', 'Roundtable registration was not found.')
    }

    return mapRoundtableRegistrationDetail(row)
  }

  async listSubmissions(filters: SubmissionListFilters): Promise<SubmissionListItem[]> {
    const params: unknown[] = [filters.before]
    const where = ['($1::timestamptz IS NULL OR s.submitted_at < $1::timestamptz)']

    if (filters.status) {
      params.push(filters.status)
      where.push(`s.submission_status = $${params.length}`)
    }

    if (filters.roundtableRegistered !== null) {
      params.push(filters.roundtableRegistered)
      where.push(`s.roundtable_registered = $${params.length}`)
    }

    if (filters.search) {
      params.push(`%${filters.search}%`)
      where.push(`(s.full_name ILIKE $${params.length} OR s.email ILIKE $${params.length} OR s.position ILIKE $${params.length})`)
    }

    params.push(filters.limit)
    const result = await this.pool.query<SubmissionRow>(
      `
      ${submissionSelect}
      WHERE ${where.join(' AND ')}
      ORDER BY s.submitted_at DESC, s.id DESC
      LIMIT $${params.length}
      `,
      params,
    )

    return result.rows.map(mapListItem)
  }

  async listSubmissionDetails(filters: SubmissionDetailListFilters): Promise<SubmissionDetailListResult> {
    const pageParams: unknown[] = []
    const pageWhere: string[] = []

    if (filters.status) {
      pageParams.push(filters.status)
      pageWhere.push('s.submission_status = $' + pageParams.length)
    }

    if (filters.roundtableRegistered !== null) {
      pageParams.push(filters.roundtableRegistered)
      pageWhere.push('s.roundtable_registered = $' + pageParams.length)
    }

    if (filters.search) {
      pageParams.push('%' + filters.search + '%')
      pageWhere.push('(s.full_name ILIKE $' + pageParams.length + ' OR s.email ILIKE $' + pageParams.length + ' OR s.position ILIKE $' + pageParams.length + ')')
    }

    const pageWhereSql = pageWhere.length ? pageWhere.join(' AND ') : 'TRUE'
    const offset = (filters.page - 1) * filters.limit
    pageParams.push(filters.limit)
    const limitParam = pageParams.length
    pageParams.push(offset)
    const offsetParam = pageParams.length

    const countParams: unknown[] = []
    const countWhere: string[] = []

    if (filters.status) {
      countParams.push(filters.status)
      countWhere.push('s.submission_status = $' + countParams.length)
    }

    if (filters.roundtableRegistered !== null) {
      countParams.push(filters.roundtableRegistered)
      countWhere.push('s.roundtable_registered = $' + countParams.length)
    }

    if (filters.search) {
      countParams.push('%' + filters.search + '%')
      countWhere.push('(s.full_name ILIKE $' + countParams.length + ' OR s.email ILIKE $' + countParams.length + ' OR s.position ILIKE $' + countParams.length + ')')
    }

    const countWhereSql = countWhere.length ? countWhere.join(' AND ') : 'TRUE'
    const [pageResult, countResult] = await Promise.all([
      this.pool.query<SubmissionRow>(
        submissionSelect +
          '\nWHERE ' +
          pageWhereSql +
          '\nORDER BY s.submitted_at DESC, s.id DESC\nLIMIT $' +
          limitParam +
          '\nOFFSET $' +
          offsetParam,
        pageParams,
      ),
      this.pool.query<{ total_items: string }>(
        'SELECT count(*)::text AS total_items FROM public.cwi_survey_submissions AS s WHERE ' + countWhereSql,
        countParams,
      ),
    ])

    const rows = pageResult.rows
    const totalItems = toNumber(countResult.rows[0]?.total_items ?? null)
    if (!rows.length) return { items: [], totalItems }

    const submissionIds = rows.map((row) => row.id)
    const [answersResult, roundtableResult] = await Promise.all([
      this.pool.query<AnswerRow>(
        'SELECT submission_id, question_idx, part, question_type, question_text, answer_value, answer_text, other_text ' +
          'FROM public.cwi_survey_answers ' +
          'WHERE submission_id = ANY($1::uuid[]) ORDER BY submission_id, question_idx ASC',
        [submissionIds],
      ),
      this.pool.query<RoundtableRow>(
        'SELECT id, submission_id, full_name, email, position, registered_at ' +
          'FROM public.cwi_roundtable_registrations ' +
          'WHERE submission_id = ANY($1::uuid[])',
        [submissionIds],
      ),
    ])

    const answersBySubmission = new Map<string, AnswerRow[]>()
    for (const answer of answersResult.rows) {
      const answers = answersBySubmission.get(answer.submission_id) ?? []
      answers.push(answer)
      answersBySubmission.set(answer.submission_id, answers)
    }

    const roundtableBySubmission = new Map(roundtableResult.rows.map((row) => [row.submission_id, row]))

    return {
      items: rows.map((row) => {
        const listItem = mapListItem(row)
        const listItemForFullResponse: Pick<
          SubmissionListItem,
          | 'answersCount'
          | 'email'
          | 'fullName'
          | 'id'
          | 'part1Completed'
          | 'part2Completed'
          | 'roundtableRegistered'
          | 'statusNote'
          | 'submittedAt'
        > = {
          answersCount: listItem.answersCount,
          email: listItem.email,
          fullName: listItem.fullName,
          id: listItem.id,
          part1Completed: listItem.part1Completed,
          part2Completed: listItem.part2Completed,
          roundtableRegistered: listItem.roundtableRegistered,
          statusNote: listItem.statusNote,
          submittedAt: listItem.submittedAt,
        }
        const roundtable = roundtableBySubmission.get(row.id)

        return {
          ...listItemForFullResponse,
          answers: (answersBySubmission.get(row.id) ?? []).map((answer) => ({
            answerText: answer.answer_text,
            answerValue: answer.answer_value,
            idx: answer.question_idx,
            otherText: answer.other_text,
            part: answer.part,
            questionText: answer.question_text,
            questionType: answer.question_type,
          })),
          roundtableRegistration: roundtable
            ? {
                email: roundtable.email,
                fullName: roundtable.full_name,
                id: roundtable.id,
                position: roundtable.position,
                registeredAt: toIso(roundtable.registered_at),
              }
            : null,
        }
      }),
      totalItems,
    }
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
        ${submissionSelect}
        WHERE s.id = $1
        LIMIT 1
        `,
        [id],
      ),
      this.pool.query<AnswerRow>(
        `
        SELECT submission_id, question_idx, part, question_type, question_text, answer_value, answer_text, other_text
        FROM public.cwi_survey_answers
        WHERE submission_id = $1
        ORDER BY question_idx ASC
        `,
        [id],
      ),
      this.pool.query<RoundtableRow>(
        `
        SELECT id, submission_id, full_name, email, position, registered_at
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
            id: roundtableResult.rows[0].id,
            position: roundtableResult.rows[0].position,
            registeredAt: toIso(roundtableResult.rows[0].registered_at),
          }
        : null,
      scaleScore: row.scale_score,
      source: row.source,
    }
  }
}
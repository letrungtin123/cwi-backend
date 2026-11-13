import type pg from 'pg'
import { encodeCursor } from '../../http/cursor.js'
import { HttpError } from '../../http/errors.js'
import { surveyTextEn } from '../survey/surveyQuestionsEn.js'

import type { SubmissionListItem, SubmissionDetail, SubmissionListFilters, CursorPage, SubmissionStats, RoundtableRegistrationListItem, RoundtableRegistrationDetail, RoundtableRegistrationFilters, RoundtableRegistrationStats, WebinarRegistrationListItem, WebinarRegistrationDetail, WebinarRegistrationFilters, WebinarRegistrationStats } from './adminTypes.js'
import { submissionSelect, roundtableSelect, webinarSelect, toIso, mapListItem, mapRoundtableRegistration, mapRoundtableRegistrationDetail, toNumber, appendLatestReportStatusFilter, appendFailedEmailFilter, appendSourceFilter } from './adminQueries.js'
import type { SubmissionRow, AnswerRow, RoundtableRow, StatsRow, RoundtableRegistrationRow, RoundtableStatsRow } from './adminQueries.js'

export * from './adminTypes.js'
export { appendFailedEmailFilter, appendLatestReportStatusFilter } from './adminQueries.js'

type TimedCache<T> = {
  expiresAt: number
  value: T
}

const statsCacheTtlMs = 10_000

export class PgAdminRepository {
  private readonly roundtableStatsCache = new Map<string, TimedCache<RoundtableRegistrationStats>>()
  private webinarStatsCache: TimedCache<WebinarRegistrationStats> | null = null
  private readonly submissionStatsCache = new Map<string, TimedCache<SubmissionStats>>()

  constructor(
    private readonly pool: pg.Pool,
    private readonly cursorSecret: string,
  ) {}

  private nextCursor(timestamp: Date, id: string) {
    return encodeCursor(this.cursorSecret, { id, timestamp })
  }

  async listRoundtableRegistrationsPage(filters: RoundtableRegistrationFilters): Promise<CursorPage<RoundtableRegistrationListItem>> {
    const params: unknown[] = []
    const where: string[] = []

    if (filters.before) {
      params.push(filters.before)
      const beforeParam = params.length

      if (filters.beforeId) {
        params.push(filters.beforeId)
        const beforeIdParam = params.length
        where.push('(r.registered_at, r.id) < ($' + beforeParam + '::timestamptz, $' + beforeIdParam + '::uuid)')
      } else {
        where.push('r.registered_at < $' + beforeParam + '::timestamptz')
      }
    }

    if (filters.linkStatus === 'linked') {
      where.push('r.submission_id IS NOT NULL')
    } else if (filters.linkStatus === 'standalone') {
      where.push('r.submission_id IS NULL')
    }

    if (filters.quarter) {
      params.push(filters.quarter)
      where.push('r.quarter = $' + params.length)
    }

    if (filters.search) {
      params.push('%' + filters.search + '%')
      where.push(
        '(r.full_name ILIKE $' + params.length +
          ' OR r.email ILIKE $' + params.length +
          ' OR r.position ILIKE $' + params.length +
          ' OR r.phone ILIKE $' + params.length +
          ' OR r.company_name ILIKE $' + params.length +
          ' OR s.full_name ILIKE $' + params.length +
          ' OR s.email ILIKE $' + params.length +
          ' OR s.position ILIKE $' + params.length +
          ' OR s.phone ILIKE $' + params.length + ')',
      )
    }

    params.push(filters.limit + 1)
    const query = [
      roundtableSelect,
      where.length ? 'WHERE ' + where.join(' AND ') : '',
      'ORDER BY r.registered_at DESC, r.id DESC',
      'LIMIT $' + params.length,
    ].join('\n')
    const result = await this.pool.query<RoundtableRegistrationRow>(query, params)
    const hasNextPage = result.rows.length > filters.limit
    const rows = result.rows.slice(0, filters.limit)
    const lastRow = rows.at(-1)

    return {
      hasNextPage,
      items: rows.map(mapRoundtableRegistration),
      nextCursor: hasNextPage && lastRow ? this.nextCursor(lastRow.registered_at, lastRow.id) : null,
    }
  }

  async getRoundtableRegistrationStats(quarter: string | null = null): Promise<RoundtableRegistrationStats> {
    const cacheKey = quarter ?? 'all'
    const cached = this.roundtableStatsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const [result, quartersResult] = await Promise.all([
      this.pool.query<RoundtableStatsRow>(
        `
        SELECT
          count(*)::text AS total_registrations,
          count(*) FILTER (WHERE submission_id IS NOT NULL)::text AS linked_submissions,
          count(*) FILTER (WHERE submission_id IS NULL)::text AS standalone_registrations,
          count(*) FILTER (WHERE registered_at >= date_trunc('day', now()))::text AS today_registrations
        FROM public.cwi_roundtable_registrations
        WHERE $1::text IS NULL OR quarter = $1
        `,
        [quarter],
      ),
      this.pool.query<{ quarter: string; total_registrations: string }>(
        `
        SELECT quarter, count(*)::text AS total_registrations
        FROM public.cwi_roundtable_registrations
        GROUP BY quarter
        ORDER BY quarter DESC
        `,
      ),
    ])

    const row = result.rows[0]
    const value = {
      linkedSubmissions: toNumber(row?.linked_submissions ?? null),
      quarters: quartersResult.rows.map((item) => ({ quarter: item.quarter, totalRegistrations: toNumber(item.total_registrations) })),
      standaloneRegistrations: toNumber(row?.standalone_registrations ?? null),
      todayRegistrations: toNumber(row?.today_registrations ?? null),
      totalRegistrations: toNumber(row?.total_registrations ?? null),
    }
    this.roundtableStatsCache.set(cacheKey, { expiresAt: Date.now() + statsCacheTtlMs, value })
    return value
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
      throw new HttpError(404, 'roundtable_registration_not_found', 'Không tìm thấy đăng ký CEO Roundtable.')
    }

    return mapRoundtableRegistrationDetail(row)
  }

  async listWebinarRegistrationsPage(filters: WebinarRegistrationFilters): Promise<CursorPage<WebinarRegistrationListItem>> {
    const params: unknown[] = []
    const where: string[] = []

    if (filters.before) {
      params.push(filters.before)
      const beforeParam = params.length

      if (filters.beforeId) {
        params.push(filters.beforeId)
        const beforeIdParam = params.length
        where.push('(r.registered_at, r.id) < ($' + beforeParam + '::timestamptz, $' + beforeIdParam + '::uuid)')
      } else {
        where.push('r.registered_at < $' + beforeParam + '::timestamptz')
      }
    }

    if (filters.linkStatus === 'linked') {
      where.push('r.submission_id IS NOT NULL')
    } else if (filters.linkStatus === 'standalone') {
      where.push('r.submission_id IS NULL')
    }

    if (filters.search) {
      params.push('%' + filters.search + '%')
      where.push(
        '(r.full_name ILIKE $' + params.length +
          ' OR r.email ILIKE $' + params.length +
          ' OR r.position ILIKE $' + params.length +
          ' OR s.full_name ILIKE $' + params.length +
          ' OR s.email ILIKE $' + params.length +
          ' OR s.position ILIKE $' + params.length +
          ' OR s.phone ILIKE $' + params.length + ')',
      )
    }

    params.push(filters.limit + 1)
    const query = [
      webinarSelect,
      where.length ? 'WHERE ' + where.join(' AND ') : '',
      'ORDER BY r.registered_at DESC, r.id DESC',
      'LIMIT $' + params.length,
    ].join('\n')
    const result = await this.pool.query<RoundtableRegistrationRow>(query, params)
    const hasNextPage = result.rows.length > filters.limit
    const rows = result.rows.slice(0, filters.limit)
    const lastRow = rows.at(-1)

    return {
      hasNextPage,
      items: rows.map(mapRoundtableRegistration),
      nextCursor: hasNextPage && lastRow ? this.nextCursor(lastRow.registered_at, lastRow.id) : null,
    }
  }

  async getWebinarRegistrationStats(): Promise<WebinarRegistrationStats> {
    if (this.webinarStatsCache && this.webinarStatsCache.expiresAt > Date.now()) return this.webinarStatsCache.value

    const result = await this.pool.query<RoundtableStatsRow>(
      `
      SELECT
        count(*)::text AS total_registrations,
        count(*) FILTER (WHERE submission_id IS NOT NULL)::text AS linked_submissions,
        count(*) FILTER (WHERE submission_id IS NULL)::text AS standalone_registrations,
        count(*) FILTER (WHERE registered_at >= date_trunc('day', now()))::text AS today_registrations
      FROM public.cwi_webinar_registrations
      `,
    )

    const row = result.rows[0]
    const value = {
      linkedSubmissions: toNumber(row?.linked_submissions ?? null),
      standaloneRegistrations: toNumber(row?.standalone_registrations ?? null),
      todayRegistrations: toNumber(row?.today_registrations ?? null),
      totalRegistrations: toNumber(row?.total_registrations ?? null),
    }
    this.webinarStatsCache = { expiresAt: Date.now() + statsCacheTtlMs, value }
    return value
  }

  async getWebinarRegistration(id: string): Promise<WebinarRegistrationDetail> {
    const result = await this.pool.query<RoundtableRegistrationRow>(
      `
      ${webinarSelect}
      WHERE r.id = $1
      LIMIT 1
      `,
      [id],
    )

    const row = result.rows[0]
    if (!row) {
      throw new HttpError(404, 'webinar_registration_not_found', 'Không tìm thấy đăng ký Webinar.')
    }

    return mapRoundtableRegistrationDetail(row)
  }

  async listSubmissionsPage(filters: SubmissionListFilters): Promise<CursorPage<SubmissionListItem>> {
    const params: unknown[] = []
    const where: string[] = []

    if (filters.before) {
      params.push(filters.before)
      const beforeParam = params.length

      if (filters.beforeId) {
        params.push(filters.beforeId)
        const beforeIdParam = params.length
        where.push('(s.submitted_at, s.id) < ($' + beforeParam + '::timestamptz, $' + beforeIdParam + '::uuid)')
      } else {
        where.push('s.submitted_at < $' + beforeParam + '::timestamptz')
      }
    }

    if (filters.status) {
      params.push(filters.status)
      where.push('s.submission_status = $' + params.length)
    }

    if (filters.surveyVersion) {
      params.push(filters.surveyVersion)
      where.push('s.survey_version = $' + params.length)
    }

    appendLatestReportStatusFilter(where, params, filters.reportStatus)
    appendSourceFilter(where, params, filters.sourceId)

    if (filters.roundtableRegistered !== null) {
      params.push(filters.roundtableRegistered)
      where.push('s.roundtable_registered = $' + params.length)
    }

    if (filters.reportPdfUploaded !== null) {
      where.push(
        filters.reportPdfUploaded
          ? `EXISTS (
               SELECT 1
               FROM public.cwi_submission_report_files AS uploaded_report
               WHERE uploaded_report.submission_id = s.id
             )`
          : `NOT EXISTS (
               SELECT 1
               FROM public.cwi_submission_report_files AS uploaded_report
               WHERE uploaded_report.submission_id = s.id
             )`,
      )
    }

    if (filters.emailStatus === 'failed') appendFailedEmailFilter(where)

    if (filters.search) {
      params.push('%' + filters.search + '%')
      where.push(
        '(s.full_name ILIKE $' + params.length +
          ' OR s.email ILIKE $' + params.length +
          ' OR s.position ILIKE $' + params.length +
          ' OR s.phone ILIKE $' + params.length + ')',
      )
    }

    params.push(filters.limit + 1)
    const query = [
      submissionSelect,
      where.length ? 'WHERE ' + where.join(' AND ') : '',
      'ORDER BY s.submitted_at DESC, s.id DESC',
      'LIMIT $' + params.length,
    ].join('\n')
    const result = await this.pool.query<SubmissionRow>(query, params)
    const hasNextPage = result.rows.length > filters.limit
    const rows = result.rows.slice(0, filters.limit)
    const lastRow = rows.at(-1)

    return {
      hasNextPage,
      items: rows.map(mapListItem),
      nextCursor: hasNextPage && lastRow ? this.nextCursor(lastRow.submitted_at, lastRow.id) : null,
    }
  }

  async getSubmissionStats(surveyVersion: string | null = null): Promise<SubmissionStats> {
    const cacheKey = surveyVersion ?? 'all'
    const cached = this.submissionStatsCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const [result, versionsResult] = await Promise.all([
      this.pool.query<StatsRow>(
        `
        SELECT
          count(*)::text AS total_submissions,
          count(*) FILTER (WHERE submission_status = 'part1_only')::text AS part1_only,
          count(*) FILTER (WHERE submission_status = 'part2_refused_privacy')::text AS part2_refused_privacy,
          count(*) FILTER (WHERE submission_status = 'full_private_report')::text AS full_private_report,
          count(*) FILTER (WHERE roundtable_registered = true)::text AS roundtable_registered
        FROM public.cwi_survey_submissions
        WHERE $1::text IS NULL OR survey_version = $1
        `,
        [surveyVersion],
      ),
      this.pool.query<{ survey_version: string; total_submissions: string }>(
        `
        SELECT survey_version, count(*)::text AS total_submissions
        FROM public.cwi_survey_submissions
        GROUP BY survey_version
        ORDER BY survey_version DESC
        `,
      ),
    ])

    const row = result.rows[0]
    const value = {
      fullPrivateReport: toNumber(row?.full_private_report ?? null),
      part1Only: toNumber(row?.part1_only ?? null),
      part2RefusedPrivacy: toNumber(row?.part2_refused_privacy ?? null),
      roundtableRegistered: toNumber(row?.roundtable_registered ?? null),
      surveyVersions: versionsResult.rows.map((version) => ({
        surveyVersion: version.survey_version,
        totalSubmissions: toNumber(version.total_submissions),
      })),
      totalSubmissions: toNumber(row?.total_submissions ?? null),
    }
    this.submissionStatsCache.set(cacheKey, { expiresAt: Date.now() + statsCacheTtlMs, value })
    return value
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
      throw new HttpError(404, 'submission_not_found', 'Không tìm thấy lượt gửi khảo sát.')
    }

    // A survey taken in English is shown in English, as the respondent saw it. Answers are stored
    // in Vietnamese, so question and option text is looked up; scores and free text stay as stored.
    const english = row.language === 'en'
    return {
      ...mapListItem(row),
      answers: answersResult.rows.map((answer) => ({
        answerText: english && answer.question_type === 'mcq' ? surveyTextEn(answer.answer_text) : answer.answer_text,
        answerValue: answer.answer_value,
        idx: answer.question_idx,
        otherText: answer.other_text,
        part: answer.part,
        questionText: english ? surveyTextEn(answer.question_text) : answer.question_text,
        questionType: answer.question_type,
      })),
      roundtableRegistration: roundtableResult.rows[0]
        ? {
            email: roundtableResult.rows[0].email,
            fullName: roundtableResult.rows[0].full_name,
            id: roundtableResult.rows[0].id,
            position: roundtableResult.rows[0].position,
            registeredAt: toIso(roundtableResult.rows[0].registered_at),
          }
        : null,
    }
  }
}

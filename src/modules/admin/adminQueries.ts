import { submissionDeletableSql } from '../submissionDeletion/submissionDeletionRepository.js'

import type { ReportSummary, ReportStatusFilter, SubmissionSource, SubmissionSourceFilter, SubmissionListItem, RoundtableSubmissionSummary, RoundtableRegistrationListItem, RoundtableRegistrationDetail } from './adminTypes.js'

// SQL, row mapping and shared filters behind PgAdminRepository (adminRepository.ts).
export type SubmissionRow = {
  answers_count: number
  company_name: string | null
  deletable: boolean
  email: string
  full_name: string
  id: string
  language: string
  part1_completed: boolean
  part2_completed: boolean
  phone: string | null
  position: string
  privacy_consent: string
  report_generation_paused: boolean | null
  report_job_id: string | null
  report_last_error_message: string | null
  report_pdf_uploaded: boolean
  report_pdf_storage_path: string | null
  report_status: string | null
  report_updated_at: Date | null
  roundtable_registered: boolean
  status_note: string
  submitted_at: Date
  submission_status: string
  survey_source_code: string | null
  survey_source_id: string | null
  survey_source_is_active: boolean | null
  survey_source_name: string | null
  survey_version: string
}

export type AnswerRow = {
  submission_id: string
  answer_text: string
  answer_value: unknown
  other_text: string | null
  part: number
  question_idx: number
  question_text: string
  question_type: string
}

export type RoundtableRow = {
  email: string
  full_name: string
  id: string
  position: string | null
  registered_at: Date
  submission_id: string
}

export type StatsRow = {
  full_private_report: string
  part1_only: string
  part2_refused_privacy: string
  roundtable_registered: string
  total_submissions: string
}

export type RoundtableRegistrationRow = {
  client_meta: Record<string, unknown>
  company_name: string | null
  email: string
  full_name: string
  id: string
  position: string | null
  phone: string | null
  quarter: string | null
  registered_at: Date
  speaker_question: string | null
  report_generation_paused: boolean | null
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

export type RoundtableStatsRow = {
  linked_submissions: string
  standalone_registrations: string
  today_registrations: string
  total_registrations: string
}

export const submissionSelect = `
  SELECT
    s.id,
    s.submission_status,
    s.status_note,
    s.full_name,
    s.email,
    s.phone,
    s.company_name,
    s.position,
    s.privacy_consent,
    s.part1_completed,
    s.part2_completed,
    s.answers_count,
    s.roundtable_registered,
    s.submitted_at,
    s.survey_version,
    s.language,
    s.survey_source_id,
    survey_source.code AS survey_source_code,
    survey_source.name AS survey_source_name,
    survey_source.is_active AS survey_source_is_active,
    EXISTS (
      SELECT 1
      FROM public.cwi_submission_report_files AS uploaded_report
      WHERE uploaded_report.submission_id = s.id
    ) AS report_pdf_uploaded,
    report.id AS report_job_id,
    report.status AS report_status,
    report.updated_at AS report_updated_at,
    report.pdf_storage_path AS report_pdf_storage_path,
    COALESCE(report.last_error_message, report.error_message) AS report_last_error_message,
    COALESCE((SELECT NOT settings.ai_calls_enabled FROM public.cwi_report_generation_settings AS settings WHERE settings.id), false) AS report_generation_paused,
    ${submissionDeletableSql('s')} AS deletable
  FROM public.cwi_survey_submissions AS s
  LEFT JOIN public.cwi_survey_sources AS survey_source ON survey_source.id = s.survey_source_id
  LEFT JOIN LATERAL (
    SELECT id, status, updated_at, pdf_storage_path, last_error_message, error_message
    FROM public.cwi_report_jobs
    WHERE submission_id = s.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ) AS report ON true
`

export const roundtableSelect = `
  SELECT
    r.id,
    r.full_name,
    r.company_name,
    r.email,
    r.phone,
    NULL::text AS speaker_question,
    r.quarter,
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
    COALESCE(report.last_error_message, report.error_message) AS report_last_error_message,
    COALESCE((SELECT NOT settings.ai_calls_enabled FROM public.cwi_report_generation_settings AS settings WHERE settings.id), false) AS report_generation_paused
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

// Webinar registrations share the roundtable list query except for these three spots. Fail at
// start-up if the roundtable SQL changes so that one of them no longer applies, instead of
// silently querying the wrong table or columns.
function replaceOrThrow(sql: string, search: string, replacement: string) {
  if (!sql.includes(search)) throw new Error(`webinarSelect: "${search}" not found in roundtableSelect`)
  return sql.replace(search, replacement)
}

export const webinarSelect = [
  ['NULL::text AS speaker_question', 'r.speaker_question'],
  ['r.quarter,', 'NULL::text AS quarter,'],
  ['public.cwi_roundtable_registrations', 'public.cwi_webinar_registrations'],
].reduce((sql, [search, replacement]) => replaceOrThrow(sql, search!, replacement!), roundtableSelect)

export function toIso(value: Date) {
  return value.toISOString()
}

// A report job that has not finished yet. While report creation is paused in the
// dashboard nothing is being created, so it reads "waiting" instead of "creating".
export function unfinishedReportSummary(row: Pick<SubmissionRow, 'report_generation_paused' | 'report_job_id' | 'report_last_error_message' | 'report_updated_at'>): ReportSummary {
  const generationPaused = row.report_generation_paused === true
  return {
    errorMessage: row.report_last_error_message,
    generationPaused,
    jobId: row.report_job_id,
    label: generationPaused ? 'Chờ tạo báo cáo' : 'Đang tạo báo cáo',
    pdfAvailable: false,
    pdfDownloadUrl: null,
    status: 'generating',
    updatedAt: row.report_updated_at ? toIso(row.report_updated_at) : null,
  }
}

export function mapReportSummary(row: SubmissionRow): ReportSummary {
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

  if (row.report_status === 'completed' || row.report_status === 'sent') {
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

  return unfinishedReportSummary(row)
}

export function mapSubmissionSource(row: SubmissionRow): SubmissionSource | null {
  if (!row.survey_source_id || !row.survey_source_code || !row.survey_source_name) return null
  return {
    code: row.survey_source_code,
    id: row.survey_source_id,
    isActive: row.survey_source_is_active === true,
    name: row.survey_source_name,
  }
}

export function mapListItem(row: SubmissionRow): SubmissionListItem {
  return {
    answersCount: row.answers_count,
    companyName: row.company_name,
    deletable: row.deletable === true,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    language: row.language === 'en' ? 'en' : 'vi',
    part1Completed: row.part1_completed,
    part2Completed: row.part2_completed,
    position: row.position,
    privacyConsent: row.privacy_consent,
    report: mapReportSummary(row),
    roundtableRegistered: row.roundtable_registered,
    phone: row.phone,
    source: mapSubmissionSource(row),
    statusNote: row.status_note,
    submittedAt: toIso(row.submitted_at),
    submissionStatus: row.submission_status,
    surveyVersion: row.survey_version,
  }
}

export function mapRoundtableReportSummary(row: RoundtableRegistrationRow): ReportSummary {
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

  if (row.report_status === 'completed' || row.report_status === 'sent') {
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

  return unfinishedReportSummary(row)
}

export function mapRoundtableLinkedSubmission(row: RoundtableRegistrationRow): RoundtableSubmissionSummary | null {
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

export function mapRoundtableRegistration(row: RoundtableRegistrationRow): RoundtableRegistrationListItem {
  return {
    companyName: row.company_name,
    email: row.email,
    fullName: row.full_name,
    id: row.id,
    linkedSubmission: mapRoundtableLinkedSubmission(row),
    phone: row.phone,
    position: row.position,
    quarter: row.quarter,
    registeredAt: toIso(row.registered_at),
    source: row.source,
    speakerQuestion: row.speaker_question,
  }
}

export function mapRoundtableRegistrationDetail(row: RoundtableRegistrationRow): RoundtableRegistrationDetail {
  return {
    ...mapRoundtableRegistration(row),
    clientMeta: row.client_meta,
    surveySubmissionIdempotencyKey: row.survey_submission_idempotency_key,
    userAgent: row.user_agent,
  }
}

export function toNumber(value: string | null) {
  if (value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Shared with the Excel export so an export contains exactly the rows the table shows.
export function appendLatestReportStatusFilter(where: string[], params: unknown[], reportStatus: ReportStatusFilter | null) {
  if (reportStatus === null) return

  params.push(reportStatus)
  where.push(`COALESCE((
    SELECT CASE
      WHEN latest_report.status::text IN ('completed', 'sent') THEN 'completed'
      WHEN latest_report.status::text IN ('failed', 'skipped') THEN latest_report.status::text
      ELSE 'generating'
    END
    FROM public.cwi_report_jobs AS latest_report
    WHERE latest_report.submission_id = s.id
    ORDER BY latest_report.created_at DESC, latest_report.id DESC
    LIMIT 1
  ), 'not_started') = $${params.length}`)
}

// Submissions with at least one result e-mail that failed. Shared with the Excel export.
export function appendFailedEmailFilter(where: string[]) {
  where.push(`EXISTS (
    SELECT 1
    FROM public.cwi_report_email_jobs AS email_job
    WHERE email_job.submission_id = s.id
      AND email_job.status = 'failed'
  )`)
}

export function appendSourceFilter(where: string[], params: unknown[], sourceId: SubmissionSourceFilter | null | undefined) {
  if (!sourceId) return
  if (sourceId === 'none') {
    where.push('s.survey_source_id IS NULL')
    return
  }
  params.push(sourceId)
  where.push('s.survey_source_id = $' + params.length + '::uuid')
}

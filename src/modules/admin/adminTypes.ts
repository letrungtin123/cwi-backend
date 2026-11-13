import type { SurveyLanguage } from '../survey/surveyQuestions.js'

// Types returned by the admin API (submissions, Roundtable/Webinar registrations, statistics).
export type ReportSummary = {
  errorMessage: string | null
  /** True while report creation is paused in the dashboard and this report is still waiting. */
  generationPaused?: boolean
  jobId: string | null
  label: string
  pdfAvailable: boolean
  pdfDownloadUrl: string | null
  status: 'not_started' | 'generating' | 'completed' | 'failed' | 'skipped'
  updatedAt: string | null
}

export type ReportStatusFilter = 'not_started' | 'generating' | 'completed' | 'failed' | 'skipped'

// Invitation source whose survey link the respondent used; null when they came without one.
export type SubmissionSource = {
  code: string
  id: string
  isActive: boolean
  name: string
}

// A source id, or 'none' for submissions that came without a source link.
export type SubmissionSourceFilter = string | 'none'

export type SubmissionListItem = {
  answersCount: number
  companyName: string | null
  // A super admin may delete it: its report is still "Chờ tạo báo cáo" (no PDF).
  deletable: boolean
  email: string
  fullName: string
  id: string
  // Language the survey was taken in.
  language: SurveyLanguage
  part1Completed: boolean
  part2Completed: boolean
  position: string
  privacyConsent: string
  report: ReportSummary
  roundtableRegistered: boolean
  phone: string | null
  source: SubmissionSource | null
  statusNote: string
  submittedAt: string
  submissionStatus: string
  surveyVersion: string
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
  roundtableRegistration: {
    email: string
    fullName: string
    id: string
    position: string | null
    registeredAt: string
  } | null
}

export type SubmissionListFilters = {
  before: Date | null
  beforeId: string | null
  emailStatus?: 'failed' | null
  limit: number
  reportStatus: ReportStatusFilter | null
  reportPdfUploaded: boolean | null
  roundtableRegistered: boolean | null
  search: string | null
  sourceId?: SubmissionSourceFilter | null
  status: string | null
  surveyVersion?: string | null
}

export type CursorPage<T> = {
  hasNextPage: boolean
  items: T[]
  nextCursor: string | null
}

export type SubmissionStats = {
  fullPrivateReport: number
  part1Only: number
  part2RefusedPrivacy: number
  roundtableRegistered: number
  // Every question set that has submissions, newest first, independent of the
  // selected surveyVersion so the dashboard can always offer all quarters.
  surveyVersions: Array<{ surveyVersion: string; totalSubmissions: number }>
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
  companyName: string | null
  email: string
  fullName: string
  id: string
  linkedSubmission: RoundtableSubmissionSummary | null
  phone: string | null
  position: string | null
  // Roundtable quarter; null for Webinar registrations.
  quarter: string | null
  registeredAt: string
  source: string
  speakerQuestion: string | null
}

export type RoundtableRegistrationDetail = RoundtableRegistrationListItem & {
  clientMeta: Record<string, unknown>
  surveySubmissionIdempotencyKey: string | null
  userAgent: string | null
}

export type RoundtableRegistrationFilters = {
  before: Date | null
  beforeId: string | null
  limit: number
  linkStatus: RoundtableLinkStatus | null
  // Applied to Roundtable only; Webinar registrations have no quarter.
  quarter?: string | null
  search: string | null
}

export type RoundtableRegistrationStats = {
  linkedSubmissions: number
  // Roundtable only: every quarter with registrations, newest first.
  quarters?: Array<{ quarter: string; totalRegistrations: number }>
  standaloneRegistrations: number
  todayRegistrations: number
  totalRegistrations: number
}

export type WebinarLinkStatus = RoundtableLinkStatus
export type WebinarSubmissionSummary = RoundtableSubmissionSummary
export type WebinarRegistrationListItem = RoundtableRegistrationListItem
export type WebinarRegistrationDetail = RoundtableRegistrationDetail
export type WebinarRegistrationFilters = RoundtableRegistrationFilters
export type WebinarRegistrationStats = RoundtableRegistrationStats

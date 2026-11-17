import type { NormalizedAnswer, NormalizedSurveySubmission } from '../survey/submissionValidation.js'
import { getSurveyEdition, type SurveyEdition } from '../survey/surveyEditions.js'

export type AiReportType = 'anonymous' | 'personalized'

export type AiReportAnswer = {
  answer: number | string
  idx: number
  other_text?: string
  question: string
}

export type AiReportPayload = {
  answers: AiReportAnswer[]
  cohort_consent: boolean
  delivery_contact: {
    email: string
    full_name: string
  }
  participant: {
    position: string
  }
}

export type ReportJobCreateInput = {
  providerEndpoint: string
  reportType: AiReportType
  requestPayload: AiReportPayload
}

// Report jobs keep the payload they were created with, so a retried 2026Q3 job
// is resent with 2026Q3 content. Only its legacy question 17 label needs fixing.
export function normalizeStoredReportPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { answers?: unknown }).answers)) return payload

  const source = payload as { answers: unknown[] }
  return {
    ...payload,
    answers: source.answers.map((answer) => {
      if (!answer || typeof answer !== 'object') return answer
      const item = answer as { answer?: unknown; idx?: unknown }
      if (item.idx !== 17 || item.answer !== 'CEO và HR chưa thống nhất') return answer
      return { ...answer, answer: 'CEO và Nhân sự chưa thống nhất' }
    }),
  }
}

// Survey question and option text is the CWI AI V3 registry text of the submission's
// edition, so answers are forwarded verbatim, apart from the few texts the edition
// translates (2026Q3 question 6). An "other" choice sends the edition's "other"
// option plus the respondent's text.
function toAiAnswer(edition: SurveyEdition, answer: NormalizedAnswer): AiReportAnswer {
  const question = edition.aiQuestionText.get(answer.idx) ?? answer.questionText
  if (answer.otherText) {
    return { answer: edition.aiOtherOption, idx: answer.idx, other_text: answer.otherText, question }
  }

  return { answer: answer.answerForReport, idx: answer.idx, question }
}

function buildBasePayload(submission: NormalizedSurveySubmission): Omit<AiReportPayload, 'answers'> {
  return {
    cohort_consent: submission.privacyConsent === 'yes',
    delivery_contact: {
      email: submission.participant.email,
      full_name: submission.participant.fullName,
    },
    participant: {
      position: submission.participant.position,
    },
  }
}

// The report is created through the edition route (/v3/editions/2026-q3/...), never
// the unversioned /v3/reports/* one: that one follows whichever quarter cwi-ai has
// activated, so it would reject an earlier quarter's answers.
export function buildReportJobRequest(submission: NormalizedSurveySubmission): ReportJobCreateInput {
  const edition = getSurveyEdition(submission.surveyVersion)
  if (!edition) throw new Error(`No survey edition ${submission.surveyVersion}`)
  const reportType: AiReportType = submission.submissionStatus === 'full_private_report' ? 'personalized' : 'anonymous'
  const endpoint = `/v3/editions/${edition.aiEditionId}/reports/${reportType}`
  // The anonymous report accepts exactly the 18 Part 1 answers.
  const answers = reportType === 'personalized' ? submission.answers : submission.answers.filter((answer) => answer.part === 1)
  const requestPayload: AiReportPayload = {
    ...buildBasePayload(submission),
    answers: answers.map((answer) => toAiAnswer(edition, answer)),
  }

  return {
    providerEndpoint: endpoint,
    reportType,
    requestPayload,
  }
}

// Keep the existing module contract available for callers that only need the
// anonymous V3 payload. Report generation itself uses the richer request
// object above so endpoint selection remains explicit.
export function buildAnonymousReportPayload(submission: NormalizedSurveySubmission): AiReportPayload {
  return buildReportJobRequest(submission).requestPayload
}

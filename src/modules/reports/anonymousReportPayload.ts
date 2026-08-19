import type { NormalizedSurveySubmission } from '../survey/submissionValidation.js'

export type AnonymousReportPayload = {
  answers: Array<{
    answer: number | string
    idx: number
    question: string
  }>
  participant: {
    email: string
    full_name: string
    position: string
  }
}

export function buildAnonymousReportPayload(submission: NormalizedSurveySubmission): AnonymousReportPayload {
  return {
    answers: submission.answers
      .filter((answer) => answer.part === 1)
      .map((answer) => ({
        answer: answer.answerForReport,
        idx: answer.idx,
        question: answer.questionText,
      })),
    participant: {
      email: submission.participant.email,
      full_name: submission.participant.fullName,
      position: submission.participant.position,
    },
  }
}

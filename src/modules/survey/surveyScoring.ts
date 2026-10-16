import type { NormalizedAnswer } from './submissionValidation.js'

export type DomainScore = {
  name: string
  value: number
}

export type SurveyScores = {
  domainScores: DomainScore[]
  overallScore: number
  scaleScore: number
}

// Unweighted mean of Q1-Q16 on the CWI AI 0-100 scale (1 -> 0, 5 -> 100).
// The weighted edition indexes are computed by CWI AI and live in its report;
// the 2026Q4 edition has no local domain or scale grouping, so those stay empty.
export function getSurveyScores(answers: readonly NormalizedAnswer[]): SurveyScores {
  const values = answers
    .filter((answer) => answer.questionType === 'likert' && answer.idx <= 16)
    .map((answer) => answer.answerForReport)
    .filter((value): value is number => typeof value === 'number' && value >= 1 && value <= 5)

  const overallScore = values.length
    ? Math.round((values.reduce((sum, value) => sum + (value - 1), 0) / values.length) * 25)
    : 0

  return {
    domainScores: [],
    overallScore,
    scaleScore: 0,
  }
}

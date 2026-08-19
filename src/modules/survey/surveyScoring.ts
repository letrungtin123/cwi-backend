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

const surveyDomains = [
  { name: 'Thực thi chiến lược', questionNumbers: [2, 7, 15] },
  { name: 'Năng lực quản lý', questionNumbers: [3, 4, 8, 16] },
  { name: 'Kế nhiệm & nhân tài', questionNumbers: [5, 9, 10, 11, 12] },
  { name: 'Thích nghi & Hệ cộng lực', questionNumbers: [1, 6, 13] },
  { name: 'CEO–Nhân sự Alignment', questionNumbers: [14] },
] as const

function scoreFor(questionNumbers: readonly number[], answers: Map<number, number>) {
  const values = questionNumbers
    .map((number) => answers.get(number))
    .filter((value): value is number => typeof value === 'number' && value >= 1 && value <= 5)

  if (!values.length) return 0

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 20)
}

export function getSurveyScores(answers: readonly NormalizedAnswer[]): SurveyScores {
  const likertAnswers = new Map<number, number>()

  for (const answer of answers) {
    if (answer.questionType === 'likert' && typeof answer.answerForReport === 'number') {
      likertAnswers.set(answer.idx, answer.answerForReport)
    }
  }

  const domainScores = surveyDomains.map((domain) => ({
    name: domain.name,
    value: scoreFor(domain.questionNumbers, likertAnswers),
  }))

  const overallValues = Array.from({ length: 16 }, (_unused, index) => likertAnswers.get(index + 1)).filter(
    (value): value is number => typeof value === 'number' && value >= 1 && value <= 5,
  )

  const overallScore = overallValues.length
    ? Math.round((overallValues.reduce((sum, value) => sum + value, 0) / overallValues.length) * 20)
    : 0

  return {
    domainScores,
    overallScore,
    scaleScore: scoreFor([1, 4, 6, 15, 16], likertAnswers),
  }
}

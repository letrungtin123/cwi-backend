import { describe, expect, it } from 'vitest'
import type { SurveyQuestion } from '../src/modules/survey/surveyQuestions.js'
import { SURVEY_EDITIONS } from '../src/modules/survey/surveyEditions.js'
import { SURVEY_TEXT_EN } from '../src/modules/survey/surveyQuestionsEn.js'

describe('English question set text', () => {
  it('has an English text for every question, option and instruction of every edition, and nothing else', () => {
    const vietnamese = new Set(
      SURVEY_EDITIONS.flatMap((edition) =>
        (edition.questions as readonly SurveyQuestion[]).flatMap((question) => [
          question.question,
          ...(question.options ?? []),
          ...(question.instruction ? [question.instruction] : []),
        ]),
      ),
    )

    expect([...vietnamese].filter((text) => !SURVEY_TEXT_EN[text])).toEqual([])
    expect(Object.keys(SURVEY_TEXT_EN).filter((text) => !vietnamese.has(text))).toEqual([])
    expect(Object.entries(SURVEY_TEXT_EN).filter(([vi, en]) => vi === en)).toEqual([])
  })
})

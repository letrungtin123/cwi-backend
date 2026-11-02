import { describe, expect, it } from 'vitest'
import { SURVEY_QUESTIONS, type SurveyQuestion } from '../src/modules/survey/surveyQuestions.js'
import { SURVEY_TEXT_EN } from '../src/modules/survey/surveyQuestionsEn.js'

describe('English question set text', () => {
  it('has an English text for every question and option of the current question set, and nothing else', () => {
    const vietnamese = new Set((SURVEY_QUESTIONS as readonly SurveyQuestion[]).flatMap((question) => [question.question, ...(question.options ?? [])]))

    expect([...vietnamese].filter((text) => !SURVEY_TEXT_EN[text])).toEqual([])
    expect(Object.keys(SURVEY_TEXT_EN).filter((text) => !vietnamese.has(text))).toEqual([])
    expect(Object.entries(SURVEY_TEXT_EN).filter(([vi, en]) => vi === en)).toEqual([])
  })
})

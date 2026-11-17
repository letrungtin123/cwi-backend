import { OTHER_OPTION as OTHER_OPTION_2026Q4, SURVEY_QUESTIONS as SURVEY_QUESTIONS_2026Q4, type SurveyQuestion } from './surveyQuestions.js'
import {
  AI_OTHER_OPTION_2026Q3,
  AI_QUESTION_TEXT_2026Q3,
  OTHER_OPTION_2026Q3,
  SURVEY_QUESTIONS_2026Q3,
} from './surveyQuestions2026Q3.js'

// Survey editions ("quý khảo sát") the code has a question set for. The landing page
// shows a card per edition (text and image come from cwi_survey_quarters, edited in
// the dashboard); a submission is validated against the edition it names and its
// report is created through that edition's cwi-ai route, so a quarter keeps working
// after cwi-ai activates a newer one.
//
// Adding a quarter: add its question set here (oldest first), its English text in
// surveyQuestionsEn.ts, a row in cwi_survey_quarters, and the same set on the landing page.
export type SurveyEdition = {
  // cwi-ai edition id: /v3/editions/{aiEditionId}/reports/...
  aiEditionId: string
  // Answer sent to cwi-ai for an "other" choice, together with other_text.
  aiOtherOption: string
  // Question text cwi-ai expects where it differs from the text the survey shows.
  aiQuestionText: ReadonlyMap<number, string>
  allQuestionIdxs: readonly number[]
  // The "other" option as the survey shows and stores it.
  otherOption: string
  partOneQuestionIdxs: readonly number[]
  questionByIdx: ReadonlyMap<number, SurveyQuestion>
  questions: readonly SurveyQuestion[]
  // Theme of the quarter, used in the report emails.
  theme: { en: string; vi: string }
  // Stored in cwi_survey_submissions.survey_version, e.g. 2026Q4.
  version: string
}

function defineEdition(input: Omit<SurveyEdition, 'aiEditionId' | 'allQuestionIdxs' | 'partOneQuestionIdxs' | 'questionByIdx'>): SurveyEdition {
  const match = /^([0-9]{4})Q([1-4])$/.exec(input.version)
  if (!match) throw new Error(`Invalid survey version ${input.version}`)
  return {
    ...input,
    aiEditionId: `${match[1]}-q${match[2]}`,
    allQuestionIdxs: input.questions.map((question) => question.idx),
    partOneQuestionIdxs: input.questions.filter((question) => question.part === 1).map((question) => question.idx),
    questionByIdx: new Map(input.questions.map((question) => [question.idx, question])),
  }
}

// Oldest first; the last one is the current quarter.
export const SURVEY_EDITIONS: readonly SurveyEdition[] = [
  defineEdition({
    aiOtherOption: AI_OTHER_OPTION_2026Q3,
    aiQuestionText: AI_QUESTION_TEXT_2026Q3,
    otherOption: OTHER_OPTION_2026Q3,
    questions: SURVEY_QUESTIONS_2026Q3,
    theme: { en: 'Leadership Capacity to Scale', vi: 'Năng lực lãnh đạo cho tăng trưởng' },
    version: '2026Q3',
  }),
  defineEdition({
    aiOtherOption: OTHER_OPTION_2026Q4,
    aiQuestionText: new Map(),
    otherOption: OTHER_OPTION_2026Q4,
    questions: SURVEY_QUESTIONS_2026Q4,
    theme: { en: 'Workforce Plus for Future Readiness', vi: 'Hệ cộng lực sẵn sàng cho tương lai' },
    version: '2026Q4',
  }),
]

const editionsByVersion = new Map(SURVEY_EDITIONS.map((edition) => [edition.version, edition]))

export const SURVEY_VERSIONS = SURVEY_EDITIONS.map((edition) => edition.version)

// The newest quarter: CEO Roundtable registrations and the highlighted card use it.
export const LATEST_SURVEY_VERSION = SURVEY_EDITIONS[SURVEY_EDITIONS.length - 1]!.version

export function getSurveyEdition(version: string | null | undefined): SurveyEdition | null {
  return version ? editionsByVersion.get(version) ?? null : null
}

// "Quý 3/2026" / "Q3 2026".
export function surveyQuarterLabel(version: string, language: 'en' | 'vi' = 'vi') {
  const match = /^([0-9]{4})Q([1-4])$/.exec(version)
  if (!match) return version
  return language === 'en' ? `Q${match[2]} ${match[1]}` : `Quý ${match[2]}/${match[1]}`
}

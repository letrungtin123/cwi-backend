import { SURVEY_VERSION } from '../survey/surveyQuestions.js'

// The Roundtable that is open for registration belongs to the quarter of the
// survey edition that is currently running, so a survey submission and the
// Roundtable registration made from it always share the same quarter.
export const CURRENT_ROUNDTABLE_QUARTER = SURVEY_VERSION

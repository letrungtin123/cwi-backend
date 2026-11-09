// A source code is the `src` value in a source's survey link (/survey?entry=qr&src=<code>).
// Lowercase letters, digits and inner hyphens, 1-48 characters. Same rule as the
// CHECK constraint on public.cwi_survey_sources.code.
export const SURVEY_SOURCE_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/

// Reads the code sent with a survey submission. Anything that is not a valid code
// becomes null: a wrong or stale link must never stop the survey from being saved.
export function readSubmittedSurveySourceCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toLowerCase()
  return SURVEY_SOURCE_CODE_PATTERN.test(code) ? code : null
}

// Checks every survey edition's question set against cwi-ai, without creating anything:
// for each quarter it sends one answer set per option position to the stateless
// /v3/editions/{id}/scores/{anonymous|personalized} endpoints (they never store anything).
// A 422 means a question or option no longer matches cwi-ai's registry for that quarter.
//
//   npm run check:ai-editions                    (REPORT_SERVICE_BASE_URL from .env)
//   REPORT_SERVICE_BASE_URL=http://127.0.0.1:18000 npm run check:ai-editions
//
// The production cwi-ai is reached through a tunnel: ssh -N -L 18000:127.0.0.1:8000 <server>.
import dotenv from 'dotenv'
import { buildReportJobRequest } from '../src/modules/reports/reportPayload.js'
import { normalizeSurveySubmission } from '../src/modules/survey/submissionValidation.js'
import { SURVEY_EDITIONS, type SurveyEdition } from '../src/modules/survey/surveyEditions.js'

dotenv.config({ path: process.env.CWI_ENV_FILE || '.env' })
const baseUrl = (process.env.REPORT_SERVICE_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')
const participant = { companyName: 'Kiểm tra', email: 'check@example.com', fullName: 'Kiểm tra', phone: '0901234567', position: 'CEO' }

// Answer set number k picks option k of every multiple-choice question (wrapping round),
// so together the sets use every option at least once.
function answerSet(edition: SurveyEdition, k: number) {
  return edition.questions.map((question) => {
    if (question.type === 'likert') return { answer: (k % 5) + 1, idx: question.idx }
    if (question.type === 'text') return { answer: 'https://example.com', idx: question.idx }
    const options = question.options ?? []
    const option = options[k % options.length]!
    return option === edition.otherOption ? { answer: option, idx: question.idx, otherText: 'Kiểm tra' } : { answer: option, idx: question.idx }
  })
}

async function score(path: string, answers: unknown) {
  const response = await fetch(baseUrl + path, { body: JSON.stringify({ answers }), headers: { 'content-type': 'application/json' }, method: 'POST' })
  const body = (await response.json().catch(() => null)) as { detail?: unknown; edition?: string } | null
  return { body, status: response.status }
}

let failures = 0
for (const edition of SURVEY_EDITIONS) {
  const sets = Math.max(...edition.questions.map((question) => question.options?.length ?? 1))
  for (let k = 0; k < sets; k += 1) {
    const submission = normalizeSurveySubmission(
      { answers: answerSet(edition, k), participant, privacyConsent: 'yes', submissionStatus: 'full_private_report', surveyVersion: edition.version },
      null,
    )
    const personalized = buildReportJobRequest(submission).requestPayload.answers
    const anonymous = personalized.filter((answer) => answer.idx <= 18)
    for (const [kind, answers] of [['anonymous', anonymous], ['personalized', personalized]] as const) {
      const result = await score(`/v3/editions/${edition.aiEditionId}/scores/${kind}`, answers)
      const ok = result.status === 200
      if (!ok) failures += 1
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${edition.version} ${kind} set ${k + 1}/${sets}: ${result.status}${ok ? ` (edition ${result.body?.edition})` : ` ${JSON.stringify(result.body?.detail ?? result.body)}`}`)
    }
  }
}

if (failures) {
  console.error(`${failures} check(s) failed: the survey text no longer matches cwi-ai.`)
  process.exit(1)
}
console.log('Every edition matches cwi-ai.')

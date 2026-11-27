import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '../../http/errors.js'
import {
  FOLLOW_UP_ANSWER_MAX,
  FOLLOW_UP_ANSWER_MIN,
  SURVEY_LANGUAGES,
  type SurveyLanguage,
  type SurveyQuestion,
  type SurveyQuestionType,
} from './surveyQuestions.js'
import { getSurveyEdition, SURVEY_VERSIONS, type SurveyEdition } from './surveyEditions.js'
import {
  PRIVACY_CONSENTS,
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_RULES,
  type PrivacyConsent,
  type SubmissionStatus,
} from './submissionStatus.js'
import { getSurveyScores, type SurveyScores } from './surveyScoring.js'
import { readSubmittedSurveySourceCode } from '../surveySources/surveySourceCode.js'
import { normalizePhoneNumber } from '../shared/phone.js'

export type Participant = {
  companyName: string | null
  email: string
  fullName: string
  phone: string
  position: string
}

export type RoundtableRegistration = {
  email: string
  fullName: string
  id: string | null
  position: string | null
  registered: true
}

export type NormalizedAnswer = {
  answerForReport: number | string
  answerText: string
  answerValue: unknown
  // Follow-up question asked under a scale answer of 1 or 5, with the respondent's answer.
  // Left out (not null) when there is none, so payloadHash stays what it was before
  // follow-ups existed and a retry across the release is still recognised.
  followUp?: SurveyFollowUpAnswer
  idx: number
  otherText: string | null
  part: 1 | 2
  questionText: string
  questionType: SurveyQuestionType
}

export type SurveyFollowUpAnswer = {
  answer: string
  question: string
}

export type NormalizedSurveySubmission = {
  answers: NormalizedAnswer[]
  clientMeta: Record<string, unknown>
  idempotencyKey: string | null
  language: SurveyLanguage
  part1Completed: boolean
  part2Completed: boolean
  participant: Participant
  payloadHash: string
  privacyConsent: PrivacyConsent
  roundtableRegistration: RoundtableRegistration | null
  scores: SurveyScores
  // Invitation source code from the survey link, or null. Not part of payloadHash, so
  // a retry is never refused because another source link was opened in between.
  sourceCode: string | null
  statusNote: string
  submissionStatus: SubmissionStatus
  surveyVersion: string
}

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)

const rawAnswerSchema = z
  .object({
    answer: z.union([z.number().int(), z.string().trim().min(1).max(2048)]),
    // Answer to the follow-up question of a scale answer of 1 or 5; length is checked later
    // so the respondent gets a clear message.
    followUpAnswer: z.string().max(4000).optional(),
    idx: z.coerce.number().int().min(1).max(24),
    // CWI AI V3 accepts other_text of 2-500 characters; reject earlier so the
    // stored submission never produces a report job that is bound to fail.
    otherText: z.string().trim().min(2).max(500).optional(),
    question: z.string().trim().max(2000).optional(),
  })
  .strict()

const rawSubmissionSchema = z
  .object({
    answers: z.array(rawAnswerSchema).min(18).max(24),
    clientMeta: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
    // Optional so a page opened before the language switch existed can still submit.
    language: z.enum(SURVEY_LANGUAGES).optional(),
    participant: z
      .object({
        // Required by the landing form; optional here so a page opened before
        // the field existed can still submit during a release.
        companyName: z.string().trim().min(1).max(200).optional(),
        email: z.string().trim().email().max(254),
        fullName: z.string().trim().min(2).max(160),
        phone: z.string().trim().min(1).max(32),
        position: z.string().trim().min(2).max(150),
      })
      .strict(),
    privacyConsent: z.enum(PRIVACY_CONSENTS),
    // Any value is accepted here and invalid codes are dropped later, so a bad link
    // never makes the submission fail.
    sourceCode: z.unknown().optional(),
    roundtableRegistration: z
      .object({
        email: z.string().trim().email().max(254).optional(),
        fullName: z.string().trim().min(1).max(160).optional(),
        id: z.string().uuid().optional(),
        position: z.string().trim().min(1).max(160).optional(),
        registered: z.boolean(),
      })
      .strict()
      .optional(),
    statusNote: z.string().trim().min(1).max(1000).optional(),
    submissionStatus: z.enum(SUBMISSION_STATUSES),
    surveyVersion: z.string().trim().max(16).optional(),
  })
  .strict()

type RawAnswer = z.infer<typeof rawAnswerSchema>
type RawSubmission = z.infer<typeof rawSubmissionSchema>

function validationError(code: string, message: string, details?: Record<string, unknown>): never {
  throw new HttpError(422, code, message, details)
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizePhone(value: string) {
  const normalized = normalizePhoneNumber(value)
  if (normalized) return normalized

  validationError('invalid_phone', 'Số điện thoại không hợp lệ.', {
    acceptedFormats: ['0901234567', '+84901234567'],
  })
}

function normalizeFollowUp(edition: SurveyEdition, question: SurveyQuestion, value: number, raw: RawAnswer): SurveyFollowUpAnswer | null {
  if (raw.followUpAnswer === undefined) return null

  if (!edition.followUp || question.type !== 'likert' || (value !== 1 && value !== 5)) {
    validationError('unexpected_follow_up', `Question ${question.idx} has no follow-up question.`, { idx: question.idx })
  }

  const answer = normalizeText(raw.followUpAnswer)
  if (answer.length < FOLLOW_UP_ANSWER_MIN) {
    validationError('follow_up_answer_too_short', `Câu hỏi phụ của câu ${question.idx} cần ít nhất ${FOLLOW_UP_ANSWER_MIN} ký tự.`, {
      idx: question.idx,
      min: FOLLOW_UP_ANSWER_MIN,
    })
  }
  if (answer.length > FOLLOW_UP_ANSWER_MAX) {
    validationError('follow_up_answer_too_long', `Câu hỏi phụ của câu ${question.idx} tối đa ${FOLLOW_UP_ANSWER_MAX} ký tự.`, {
      idx: question.idx,
      max: FOLLOW_UP_ANSWER_MAX,
    })
  }

  return { answer, question: edition.followUp.question }
}

function normalizeLikertAnswer(edition: SurveyEdition, question: SurveyQuestion, raw: RawAnswer): NormalizedAnswer {
  const value = typeof raw.answer === 'number' ? raw.answer : Number(raw.answer)

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    validationError('invalid_likert_answer', `Question ${question.idx} requires a Likert answer from 1 to 5.`, {
      idx: question.idx,
    })
  }

  const followUp = normalizeFollowUp(edition, question, value, raw)
  return {
    answerForReport: value,
    answerText: String(value),
    answerValue: value,
    ...(followUp ? { followUp } : {}),
    idx: question.idx,
    otherText: null,
    part: question.part,
    questionText: question.question,
    questionType: question.type,
  }
}

function normalizeMcqAnswer(question: SurveyQuestion, raw: RawAnswer, otherOption: string): NormalizedAnswer {
  if (typeof raw.answer !== 'string') {
    validationError('invalid_mcq_answer', `Question ${question.idx} requires a text option.`, {
      idx: question.idx,
    })
  }

  const selectedOption = normalizeText(raw.answer)
  const options = question.options ?? []

  if (!options.includes(selectedOption)) {
    validationError('invalid_mcq_option', `Question ${question.idx} received an option that is not allowed.`, {
      idx: question.idx,
      selectedOption,
    })
  }

  if (selectedOption === otherOption) {
    const otherText = raw.otherText ? normalizeText(raw.otherText) : ''
    if (!otherText) {
      validationError('missing_other_text', `Question ${question.idx} requires otherText for "${otherOption}".`, {
        idx: question.idx,
      })
    }

    return {
      answerForReport: otherText,
      answerText: otherText,
      answerValue: { otherText, selectedOption },
      idx: question.idx,
      otherText,
      part: question.part,
      questionText: question.question,
      questionType: question.type,
    }
  }

  return {
    answerForReport: selectedOption,
    answerText: selectedOption,
    answerValue: selectedOption,
    idx: question.idx,
    otherText: null,
    part: question.part,
    questionText: question.question,
    questionType: question.type,
  }
}

function normalizeUrlAnswer(question: SurveyQuestion, raw: RawAnswer): NormalizedAnswer {
  if (typeof raw.answer !== 'string') {
    validationError('invalid_text_answer', `Question ${question.idx} requires a text answer.`, {
      idx: question.idx,
    })
  }

  const value = raw.answer.trim()

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported URL protocol')
    }
  } catch {
    validationError('invalid_company_website', `Question ${question.idx} requires a valid http or https URL.`, {
      idx: question.idx,
    })
  }

  return {
    answerForReport: value,
    answerText: value,
    answerValue: value,
    idx: question.idx,
    otherText: null,
    part: question.part,
    questionText: question.question,
    questionType: question.type,
  }
}

function normalizeAnswer(edition: SurveyEdition, raw: RawAnswer) {
  const question = edition.questionByIdx.get(raw.idx)
  if (!question) {
    validationError('unknown_question', `Unknown question index ${raw.idx}.`, { idx: raw.idx })
  }

  if (question.type === 'likert') return normalizeLikertAnswer(edition, question, raw)
  if (raw.followUpAnswer !== undefined) {
    validationError('unexpected_follow_up', `Question ${question.idx} has no follow-up question.`, { idx: question.idx })
  }
  if (question.type === 'mcq') return normalizeMcqAnswer(question, raw, edition.otherOption)
  return normalizeUrlAnswer(question, raw)
}

// The survey asks the follow-up under the first FOLLOW_UP_MAX scale answers of 1 or 5 and
// requires it, but a page opened before follow-ups existed sends none, so only the
// upper limit is enforced here.
function assertFollowUpCount(edition: SurveyEdition, answers: readonly NormalizedAnswer[]) {
  const count = answers.filter((answer) => answer.followUp).length
  const max = edition.followUp?.max ?? 0
  if (count > max) {
    validationError('too_many_follow_ups', `Chỉ được trả lời tối đa ${max} câu hỏi phụ.`, { count, max })
  }
}

function normalizeRoundtable(raw: RawSubmission['roundtableRegistration']): RoundtableRegistration | null {
  if (!raw?.registered) return null

  if (!raw.email || !raw.fullName) {
    validationError('invalid_roundtable_registration', 'Đăng ký CEO Roundtable cần họ tên và email.', {
      roundtableRegistration: raw,
    })
  }

  return {
    email: normalizeEmail(raw.email),
    fullName: normalizeText(raw.fullName),
    id: raw.id ?? null,
    position: raw.position ? normalizeText(raw.position) : null,
    registered: true,
  }
}

function assertAnswerSet(edition: SurveyEdition, status: SubmissionStatus, answersByIdx: Map<number, NormalizedAnswer>) {
  const rule = SUBMISSION_STATUS_RULES[status]
  const required = rule.requiredPart === 'part1' ? edition.partOneQuestionIdxs : edition.allQuestionIdxs
  const allowed = new Set<number>(required)
  const missing = required.filter((idx) => !answersByIdx.has(idx))
  const extra = Array.from(answersByIdx.keys()).filter((idx) => !allowed.has(idx))

  if (missing.length) {
    validationError('missing_required_answers', 'Bài khảo sát còn thiếu câu trả lời bắt buộc.', {
      missing,
      submissionStatus: status,
    })
  }

  if (extra.length) {
    validationError('unexpected_answers', 'Bài khảo sát có câu trả lời không phù hợp với trạng thái gửi.', {
      extra,
      submissionStatus: status,
    })
  }
}

function hashPayload(value: Omit<NormalizedSurveySubmission, 'payloadHash' | 'sourceCode'>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeSurveySubmission(payload: unknown, headerIdempotencyKey: string | null): NormalizedSurveySubmission {
  const parsed = rawSubmissionSchema.safeParse(payload)

  if (!parsed.success) {
    validationError('invalid_payload', 'Dữ liệu bài khảo sát không hợp lệ.', {
      issues: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
    })
  }

  const raw = parsed.data

  // The respondent picks the quarter on the landing page; answers are checked against
  // that quarter's question set. A page that sends no version, or one the code no
  // longer has, is rejected instead of storing answers under the wrong questions.
  // A quarter hidden in the dashboard is still accepted, so a survey started before it
  // was hidden is not lost.
  const edition = getSurveyEdition(raw.surveyVersion)
  if (!edition) {
    validationError('survey_version_mismatch', 'Bộ câu hỏi khảo sát đã được cập nhật. Vui lòng tải lại trang và gửi lại.', {
      expectedSurveyVersions: SURVEY_VERSIONS,
      receivedSurveyVersion: raw.surveyVersion ?? null,
    })
  }

  const idempotencyKey = raw.idempotencyKey ?? headerIdempotencyKey

  if (raw.idempotencyKey && headerIdempotencyKey && raw.idempotencyKey !== headerIdempotencyKey) {
    validationError('idempotency_key_mismatch', 'Mã chống gửi trùng trong nội dung và header không khớp.')
  }

  if (idempotencyKey) {
    const idempotencyKeyResult = idempotencyKeySchema.safeParse(idempotencyKey)
    if (!idempotencyKeyResult.success) {
      validationError('invalid_idempotency_key', 'Mã chống gửi trùng không hợp lệ.')
    }
  }

  const rule = SUBMISSION_STATUS_RULES[raw.submissionStatus]
  if (raw.privacyConsent !== rule.expectedPrivacyConsent) {
    validationError('invalid_privacy_consent', 'Lựa chọn đồng ý bảo mật không khớp với trạng thái gửi.', {
      expectedPrivacyConsent: rule.expectedPrivacyConsent,
      receivedPrivacyConsent: raw.privacyConsent,
      submissionStatus: raw.submissionStatus,
    })
  }

  const answersByIdx = new Map<number, NormalizedAnswer>()

  for (const answer of raw.answers) {
    if (answersByIdx.has(answer.idx)) {
      validationError('duplicate_answer', `Question ${answer.idx} was answered more than once.`, {
        idx: answer.idx,
      })
    }

    answersByIdx.set(answer.idx, normalizeAnswer(edition, answer))
  }

  assertAnswerSet(edition, raw.submissionStatus, answersByIdx)

  const orderedAnswers = (rule.requiredPart === 'part1' ? edition.partOneQuestionIdxs : edition.allQuestionIdxs).map((idx) => {
    const answer = answersByIdx.get(idx)
    if (!answer) {
      validationError('missing_required_answers', `Missing answer ${idx}.`, { idx })
    }
    return answer
  })
  assertFollowUpCount(edition, orderedAnswers)

  const scores = getSurveyScores(orderedAnswers)
  const normalizedRoundtableRegistration = normalizeRoundtable(raw.roundtableRegistration)
  const participantEmail = normalizeEmail(raw.participant.email)
  if (normalizedRoundtableRegistration && normalizedRoundtableRegistration.email !== participantEmail) {
    validationError('roundtable_email_mismatch', 'Email đăng ký CEO Roundtable phải trùng với email người làm khảo sát.')
  }

  const normalizedWithoutHash: Omit<NormalizedSurveySubmission, 'payloadHash' | 'sourceCode'> = {
    answers: orderedAnswers,
    clientMeta: raw.clientMeta ?? {},
    idempotencyKey: idempotencyKey ?? null,
    language: raw.language ?? 'vi',
    part1Completed: true,
    part2Completed: rule.requiredPart === 'all',
    participant: {
      companyName: raw.participant.companyName ? normalizeText(raw.participant.companyName) : null,
      email: participantEmail,
      fullName: normalizeText(raw.participant.fullName),
      phone: normalizePhone(raw.participant.phone),
      position: normalizeText(raw.participant.position),
    },
    privacyConsent: raw.privacyConsent,
    roundtableRegistration: normalizedRoundtableRegistration,
    scores,
    statusNote: raw.statusNote ? normalizeText(raw.statusNote) : rule.defaultNote,
    submissionStatus: raw.submissionStatus,
    surveyVersion: edition.version,
  }

  return {
    ...normalizedWithoutHash,
    payloadHash: hashPayload(normalizedWithoutHash),
    sourceCode: readSubmittedSurveySourceCode(raw.sourceCode),
  }
}

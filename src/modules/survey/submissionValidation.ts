import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '../../http/errors.js'
import {
  ALL_QUESTION_IDXS,
  OTHER_OPTION,
  PART_ONE_QUESTION_IDXS,
  SURVEY_QUESTION_BY_IDX,
  type SurveyQuestion,
  type SurveyQuestionType,
} from './surveyQuestions.js'
import {
  PRIVACY_CONSENTS,
  SUBMISSION_STATUSES,
  SUBMISSION_STATUS_RULES,
  type PrivacyConsent,
  type SubmissionStatus,
} from './submissionStatus.js'
import { getSurveyScores, type SurveyScores } from './surveyScoring.js'

export type Participant = {
  email: string
  fullName: string
  position: string
}

export type RoundtableRegistration = {
  email: string
  fullName: string
  registered: true
}

export type NormalizedAnswer = {
  answerForReport: number | string
  answerText: string
  answerValue: unknown
  idx: number
  otherText: string | null
  part: 1 | 2
  questionText: string
  questionType: SurveyQuestionType
}

export type NormalizedSurveySubmission = {
  answers: NormalizedAnswer[]
  clientMeta: Record<string, unknown>
  idempotencyKey: string | null
  part1Completed: boolean
  part2Completed: boolean
  participant: Participant
  payloadHash: string
  privacyConsent: PrivacyConsent
  roundtableRegistration: RoundtableRegistration | null
  scores: SurveyScores
  statusNote: string
  submissionStatus: SubmissionStatus
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
    idx: z.coerce.number().int().min(1).max(24),
    otherText: z.string().trim().min(1).max(1000).optional(),
    question: z.string().trim().max(2000).optional(),
  })
  .strict()

const rawSubmissionSchema = z
  .object({
    answers: z.array(rawAnswerSchema).min(18).max(24),
    clientMeta: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
    participant: z
      .object({
        email: z.string().trim().email().max(254),
        fullName: z.string().trim().min(1).max(160),
        position: z.string().trim().min(1).max(160),
      })
      .strict(),
    privacyConsent: z.enum(PRIVACY_CONSENTS),
    roundtableRegistration: z
      .object({
        email: z.string().trim().email().max(254).optional(),
        fullName: z.string().trim().min(1).max(160).optional(),
        registered: z.boolean(),
      })
      .strict()
      .optional(),
    statusNote: z.string().trim().min(1).max(1000).optional(),
    submissionStatus: z.enum(SUBMISSION_STATUSES),
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

function normalizeLikertAnswer(question: SurveyQuestion, raw: RawAnswer): NormalizedAnswer {
  const value = typeof raw.answer === 'number' ? raw.answer : Number(raw.answer)

  if (!Number.isInteger(value) || value < 1 || value > 5) {
    validationError('invalid_likert_answer', `Question ${question.idx} requires a Likert answer from 1 to 5.`, {
      idx: question.idx,
    })
  }

  return {
    answerForReport: value,
    answerText: String(value),
    answerValue: value,
    idx: question.idx,
    otherText: null,
    part: question.part,
    questionText: question.question,
    questionType: question.type,
  }
}

function normalizeMcqAnswer(question: SurveyQuestion, raw: RawAnswer): NormalizedAnswer {
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

  if (selectedOption === OTHER_OPTION) {
    const otherText = raw.otherText ? normalizeText(raw.otherText) : ''
    if (!otherText) {
      validationError('missing_other_text', `Question ${question.idx} requires otherText for "${OTHER_OPTION}".`, {
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

function normalizeAnswer(raw: RawAnswer) {
  const question = SURVEY_QUESTION_BY_IDX.get(raw.idx)
  if (!question) {
    validationError('unknown_question', `Unknown question index ${raw.idx}.`, { idx: raw.idx })
  }

  if (question.type === 'likert') return normalizeLikertAnswer(question, raw)
  if (question.type === 'mcq') return normalizeMcqAnswer(question, raw)
  return normalizeUrlAnswer(question, raw)
}

function normalizeRoundtable(raw: RawSubmission['roundtableRegistration']): RoundtableRegistration | null {
  if (!raw?.registered) return null

  if (!raw.email || !raw.fullName) {
    validationError('invalid_roundtable_registration', 'Roundtable registration requires fullName and email.', {
      roundtableRegistration: raw,
    })
  }

  return {
    email: normalizeEmail(raw.email),
    fullName: normalizeText(raw.fullName),
    registered: true,
  }
}

function assertAnswerSet(status: SubmissionStatus, answersByIdx: Map<number, NormalizedAnswer>) {
  const rule = SUBMISSION_STATUS_RULES[status]
  const required = rule.requiredPart === 'part1' ? PART_ONE_QUESTION_IDXS : ALL_QUESTION_IDXS
  const allowed = new Set<number>(required)
  const missing = required.filter((idx) => !answersByIdx.has(idx))
  const extra = Array.from(answersByIdx.keys()).filter((idx) => !allowed.has(idx))

  if (missing.length) {
    validationError('missing_required_answers', 'Submission is missing required answers.', {
      missing,
      submissionStatus: status,
    })
  }

  if (extra.length) {
    validationError('unexpected_answers', 'Submission contains answers that are not allowed for this status.', {
      extra,
      submissionStatus: status,
    })
  }
}

function hashPayload(value: Omit<NormalizedSurveySubmission, 'payloadHash'>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeSurveySubmission(payload: unknown, headerIdempotencyKey: string | null): NormalizedSurveySubmission {
  const parsed = rawSubmissionSchema.safeParse(payload)

  if (!parsed.success) {
    validationError('invalid_payload', 'Survey submission payload is invalid.', {
      issues: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
    })
  }

  const raw = parsed.data
  const idempotencyKey = raw.idempotencyKey ?? headerIdempotencyKey

  if (raw.idempotencyKey && headerIdempotencyKey && raw.idempotencyKey !== headerIdempotencyKey) {
    validationError('idempotency_key_mismatch', 'Body and header idempotency keys do not match.')
  }

  if (idempotencyKey) {
    const idempotencyKeyResult = idempotencyKeySchema.safeParse(idempotencyKey)
    if (!idempotencyKeyResult.success) {
      validationError('invalid_idempotency_key', 'Idempotency key is invalid.')
    }
  }

  const rule = SUBMISSION_STATUS_RULES[raw.submissionStatus]
  if (raw.privacyConsent !== rule.expectedPrivacyConsent) {
    validationError('invalid_privacy_consent', 'privacyConsent does not match submissionStatus.', {
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

    answersByIdx.set(answer.idx, normalizeAnswer(answer))
  }

  assertAnswerSet(raw.submissionStatus, answersByIdx)

  const orderedAnswers = (rule.requiredPart === 'part1' ? PART_ONE_QUESTION_IDXS : ALL_QUESTION_IDXS).map((idx) => {
    const answer = answersByIdx.get(idx)
    if (!answer) {
      validationError('missing_required_answers', `Missing answer ${idx}.`, { idx })
    }
    return answer
  })

  const scores = getSurveyScores(orderedAnswers)
  const normalizedWithoutHash: Omit<NormalizedSurveySubmission, 'payloadHash'> = {
    answers: orderedAnswers,
    clientMeta: raw.clientMeta ?? {},
    idempotencyKey: idempotencyKey ?? null,
    part1Completed: true,
    part2Completed: rule.requiredPart === 'all',
    participant: {
      email: normalizeEmail(raw.participant.email),
      fullName: normalizeText(raw.participant.fullName),
      position: normalizeText(raw.participant.position),
    },
    privacyConsent: raw.privacyConsent,
    roundtableRegistration: normalizeRoundtable(raw.roundtableRegistration),
    scores,
    statusNote: raw.statusNote ? normalizeText(raw.statusNote) : rule.defaultNote,
    submissionStatus: raw.submissionStatus,
  }

  return {
    ...normalizedWithoutHash,
    payloadHash: hashPayload(normalizedWithoutHash),
  }
}


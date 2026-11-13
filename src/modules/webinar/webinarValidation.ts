import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '../../http/errors.js'
import { normalizePhoneNumber } from '../shared/phone.js'

export type NormalizedWebinarRegistration = {
  clientMeta: Record<string, unknown>
  companyName: string | null
  email: string
  fullName: string
  idempotencyKey: string | null
  payloadHash: string
  phone: string | null
  position: string | null
  speakerQuestion: string | null
  surveySubmissionIdempotencyKey: string | null
}

export type NormalizedWebinarEmailCheck = {
  email: string
}

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)


const rawWebinarRegistrationSchema = z
  .object({
    clientMeta: z.record(z.string(), z.unknown()).optional(),
    companyName: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(254),
    fullName: z.string().trim().min(1).max(160),
    idempotencyKey: idempotencyKeySchema.optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    position: z.string().trim().min(1).max(160).optional(),
    speakerQuestion: z.string().trim().min(1).max(1000).optional(),
    surveySubmissionIdempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()

const rawWebinarEmailCheckSchema = z
  .object({
    email: z.string().trim().email().max(254),
  })
  .strict()

function validationError(code: string, message: string, details?: Record<string, unknown>): never {
  throw new HttpError(422, code, message, details)
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizePhone(value: string | undefined) {
  if (!value) return null

  const normalized = normalizePhoneNumber(value)
  if (normalized) return normalized
  validationError('invalid_webinar_phone', 'Số điện thoại không hợp lệ.')
}

function hashPayload(value: Omit<NormalizedWebinarRegistration, 'payloadHash'>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeWebinarRegistration(payload: unknown, headerIdempotencyKey: string | null): NormalizedWebinarRegistration {
  const parsed = rawWebinarRegistrationSchema.safeParse(payload)

  if (!parsed.success) {
    validationError('invalid_webinar_payload', 'Thông tin đăng ký Webinar không hợp lệ.', {
      issues: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
    })
  }

  const raw = parsed.data
  const idempotencyKey = raw.idempotencyKey ?? headerIdempotencyKey

  if (!raw.surveySubmissionIdempotencyKey && (!raw.companyName || !raw.phone)) {
    validationError('missing_webinar_contact_details', 'Số điện thoại và Tên công ty là bắt buộc khi đăng ký Webinar.')
  }

  if (raw.idempotencyKey && headerIdempotencyKey && raw.idempotencyKey !== headerIdempotencyKey) {
    validationError('idempotency_key_mismatch', 'Mã chống gửi trùng trong nội dung và header không khớp.')
  }

  if (idempotencyKey) {
    const idempotencyKeyResult = idempotencyKeySchema.safeParse(idempotencyKey)
    if (!idempotencyKeyResult.success) {
      validationError('invalid_idempotency_key', 'Mã chống gửi trùng không hợp lệ.')
    }
  }

  const normalizedWithoutHash: Omit<NormalizedWebinarRegistration, 'payloadHash'> = {
    clientMeta: raw.clientMeta ?? {},
    companyName: raw.companyName ? normalizeText(raw.companyName) : null,
    email: normalizeEmail(raw.email),
    fullName: normalizeText(raw.fullName),
    idempotencyKey: idempotencyKey ?? null,
    phone: normalizePhone(raw.phone),
    position: raw.position ? normalizeText(raw.position) : null,
    speakerQuestion: raw.speakerQuestion ? normalizeText(raw.speakerQuestion) : null,
    surveySubmissionIdempotencyKey: raw.surveySubmissionIdempotencyKey ?? null,
  }

  return {
    ...normalizedWithoutHash,
    payloadHash: hashPayload(normalizedWithoutHash),
  }
}

export function normalizeWebinarEmailCheck(payload: unknown): NormalizedWebinarEmailCheck {
  const parsed = rawWebinarEmailCheckSchema.safeParse(payload)

  if (!parsed.success) {
    validationError('invalid_webinar_email_check', 'Email đăng ký Webinar không hợp lệ.')
  }

  return { email: normalizeEmail(parsed.data.email) }
}

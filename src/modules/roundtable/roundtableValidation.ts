import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '../../http/errors.js'

export type NormalizedRoundtableRegistration = {
  clientMeta: Record<string, unknown>
  email: string
  fullName: string
  idempotencyKey: string | null
  payloadHash: string
  position: string | null
  surveySubmissionIdempotencyKey: string | null
}

export type NormalizedRoundtableEmailCheck = {
  email: string
}

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)

const rawRoundtableRegistrationSchema = z
  .object({
    clientMeta: z.record(z.string(), z.unknown()).optional(),
    email: z.string().trim().email().max(254),
    fullName: z.string().trim().min(1).max(160),
    idempotencyKey: idempotencyKeySchema.optional(),
    position: z.string().trim().min(1).max(160).optional(),
    surveySubmissionIdempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()

const rawRoundtableEmailCheckSchema = z
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

function hashPayload(value: Omit<NormalizedRoundtableRegistration, 'payloadHash'>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeRoundtableRegistration(payload: unknown, headerIdempotencyKey: string | null): NormalizedRoundtableRegistration {
  const parsed = rawRoundtableRegistrationSchema.safeParse(payload)

  if (!parsed.success) {
    validationError('invalid_roundtable_payload', 'Roundtable registration payload is invalid.', {
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

  const normalizedWithoutHash: Omit<NormalizedRoundtableRegistration, 'payloadHash'> = {
    clientMeta: raw.clientMeta ?? {},
    email: normalizeEmail(raw.email),
    fullName: normalizeText(raw.fullName),
    idempotencyKey: idempotencyKey ?? null,
    position: raw.position ? normalizeText(raw.position) : null,
    surveySubmissionIdempotencyKey: raw.surveySubmissionIdempotencyKey ?? null,
  }

  return {
    ...normalizedWithoutHash,
    payloadHash: hashPayload(normalizedWithoutHash),
  }
}

export function normalizeRoundtableEmailCheck(payload: unknown): NormalizedRoundtableEmailCheck {
  const parsed = rawRoundtableEmailCheckSchema.safeParse(payload)

  if (!parsed.success) {
    validationError('invalid_roundtable_email_check', 'Roundtable email is invalid.')
  }

  return { email: normalizeEmail(parsed.data.email) }
}

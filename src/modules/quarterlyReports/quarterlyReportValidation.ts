import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '../../http/errors.js'

const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const phonePattern = /^(?:0\d{9,10}|\+[1-9]\d{7,14})$/

export type QuarterlyReportUploadInput = {
  activate: boolean
  periodQuarter: number
  periodYear: number
  subtitle: string
  title: string
}

export type QuarterlyReportDownloadInput = {
  clientMeta: Record<string, unknown>
  email: string
  fullName: string
  idempotencyKey: string | null
  payloadHash: string
  phone: string
  position: string
}

const uploadSchema = z.object({
  activate: z.enum(['true', 'false']).optional(),
  periodQuarter: z.coerce.number().int().min(1).max(4),
  periodYear: z.coerce.number().int().min(2020).max(2100),
  subtitle: z.string().trim().max(240).optional(),
  // The dashboard sends an empty value when the admin keeps the generated title.
  title: z.string().trim().max(180).optional(),
}).strict()

const downloadSchema = z.object({
  clientMeta: z.record(z.string(), z.unknown()).optional(),
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(1).max(160),
  idempotencyKey: idempotencyKeySchema.optional(),
  phone: z.string().trim().min(8).max(32),
  position: z.string().trim().min(1).max(160),
  privacyConsent: z.literal(true),
}).strict()

function invalid(code: string, message: string, details?: Record<string, unknown>): never {
  throw new HttpError(422, code, message, details)
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizePhone(value: string) {
  const compact = value.replace(/[\s().-]/g, '')
  if (/^0\d{9,10}$/.test(compact)) return `+84${compact.slice(1)}`
  if (phonePattern.test(compact)) return compact
  invalid('invalid_quarterly_report_phone', 'Số điện thoại không hợp lệ.')
}

export function quarterlyReportSlug(periodYear: number, periodQuarter: number) {
  return `q${periodQuarter}-${periodYear}`
}

export function normalizeQuarterlyReportUpload(fields: Record<string, string>): QuarterlyReportUploadInput {
  const parsed = uploadSchema.safeParse(fields)
  if (!parsed.success) {
    invalid('invalid_quarterly_report_upload', 'Thông tin báo cáo quý không hợp lệ.', {
      issues: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  const title = normalizeText(parsed.data.title || `Báo cáo CEO Workforce Index Quý ${parsed.data.periodQuarter}/${parsed.data.periodYear}`)
  return {
    activate: parsed.data.activate !== 'false',
    periodQuarter: parsed.data.periodQuarter,
    periodYear: parsed.data.periodYear,
    subtitle: normalizeText(parsed.data.subtitle || 'Năng lực lãnh đạo cho tăng trưởng'),
    title,
  }
}

export function normalizeQuarterlyReportDownload(payload: unknown, headerIdempotencyKey: string | null): QuarterlyReportDownloadInput {
  const parsed = downloadSchema.safeParse(payload)
  if (!parsed.success) {
    invalid('invalid_quarterly_report_download', 'Thông tin tải báo cáo không hợp lệ.', {
      issues: parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path })),
    })
  }

  const idempotencyKey = parsed.data.idempotencyKey ?? headerIdempotencyKey
  if (parsed.data.idempotencyKey && headerIdempotencyKey && parsed.data.idempotencyKey !== headerIdempotencyKey) {
    invalid('quarterly_report_idempotency_key_mismatch', 'Idempotency key không khớp.')
  }
  if (idempotencyKey && !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    invalid('invalid_quarterly_report_idempotency_key', 'Idempotency key không hợp lệ.')
  }

  const normalized = {
    clientMeta: parsed.data.clientMeta ?? {},
    email: parsed.data.email.trim().toLowerCase(),
    fullName: normalizeText(parsed.data.fullName),
    idempotencyKey: idempotencyKey ?? null,
    phone: normalizePhone(parsed.data.phone),
    position: normalizeText(parsed.data.position),
  }
  return {
    ...normalized,
    payloadHash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
  }
}

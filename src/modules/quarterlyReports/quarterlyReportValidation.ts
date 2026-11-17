import { createHash } from 'node:crypto'
import { z } from 'zod'
import { HttpError } from '../../http/errors.js'
import { normalizePhoneNumber } from '../shared/phone.js'

const idempotencyKeySchema = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/)

// Each quarter has a Vietnamese and an English PDF.
export const REPORT_LANGUAGES = ['vi', 'en'] as const
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number]

export type Bilingual = { en: string; vi: string }

export type QuarterlyReportCreateInput = {
  periodQuarter: number
  periodYear: number
}

export type QuarterlyReportUpdateInput = {
  description: Bilingual
  isVisible: boolean
  sortOrder: number
  title: Bilingual
}

export type QuarterlyReportPageUpdateInput = {
  description: Bilingual
  kicker: Bilingual
  title: Bilingual
}

export type QuarterlyReportDownloadInput = {
  clientMeta: Record<string, unknown>
  email: string
  fullName: string
  idempotencyKey: string | null
  // The PDF the person is reading; it does not change who the request belongs to.
  language: ReportLanguage | null
  payloadHash: string
  phone: string
  position: string
}

const singleLine = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/[\r\n]/.test(value))
const paragraph = (max: number) => z.string().trim().max(max)
const bilingual = <T extends z.ZodTypeAny>(schema: T) => z.object({ en: schema, vi: schema }).strict()

const createSchema = z.object({
  periodQuarter: z.number().int().min(1).max(4),
  periodYear: z.number().int().min(2020).max(2100),
}).strict()

const updateSchema = z.object({
  description: bilingual(paragraph(400)),
  isVisible: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  title: bilingual(singleLine(180)),
}).strict()

const pageUpdateSchema = z.object({
  description: bilingual(paragraph(400)),
  kicker: bilingual(singleLine(80)),
  title: bilingual(singleLine(120)),
}).strict()

const downloadSchema = z.object({
  clientMeta: z.record(z.string(), z.unknown()).optional(),
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(1).max(160),
  idempotencyKey: idempotencyKeySchema.optional(),
  language: z.enum(REPORT_LANGUAGES).optional(),
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
  const normalized = normalizePhoneNumber(value)
  if (normalized) return normalized
  invalid('invalid_quarterly_report_phone', 'Số điện thoại không hợp lệ.')
}

export function quarterlyReportSlug(periodYear: number, periodQuarter: number) {
  return `q${periodQuarter}-${periodYear}`
}

export function quarterlyReportLabel(periodYear: number, periodQuarter: number): Bilingual {
  return { en: `Q${periodQuarter} ${periodYear}`, vi: `Quý ${periodQuarter}/${periodYear}` }
}

// Card text a new quarter starts with; the admin edits it afterwards.
export function defaultQuarterlyReportTitle(periodYear: number, periodQuarter: number): Bilingual {
  return {
    en: `CEO Workforce Index Report Q${periodQuarter} ${periodYear}`,
    vi: `Báo cáo CEO Workforce Index Quý ${periodQuarter}/${periodYear}`,
  }
}

export function parseReportLanguage(value: unknown): ReportLanguage | null {
  return value === 'vi' || value === 'en' ? value : null
}

export function normalizeQuarterlyReportCreate(payload: unknown): QuarterlyReportCreateInput {
  const parsed = createSchema.safeParse(payload)
  if (!parsed.success) invalid('invalid_quarterly_report', 'Chọn năm từ 2020 đến 2100 và quý từ 1 đến 4.')
  return parsed.data
}

export function normalizeQuarterlyReportUpdate(payload: unknown): QuarterlyReportUpdateInput {
  const parsed = updateSchema.safeParse(payload)
  if (!parsed.success) invalid('invalid_quarterly_report', 'Tiêu đề cần từ 1 đến 180 ký tự trên một dòng, mô tả tối đa 400 ký tự và thứ tự từ 0 đến 999.')
  return parsed.data
}

export function normalizeQuarterlyReportPageUpdate(payload: unknown): QuarterlyReportPageUpdateInput {
  const parsed = pageUpdateSchema.safeParse(payload)
  if (!parsed.success) invalid('invalid_quarterly_report_page', 'Dòng nhỏ tối đa 80 ký tự, tiêu đề từ 1 đến 120 ký tự và mô tả tối đa 400 ký tự.')
  return parsed.data
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
    language: parsed.data.language ?? null,
    payloadHash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
  }
}

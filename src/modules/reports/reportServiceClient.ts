import { z } from 'zod'

const reportAcceptedSchema = z.object({
  job_id: z.string().min(1),
  snapshot: z.unknown().optional(),
  status: z.literal('queued').optional(),
  status_url: z.string().min(1),
  survey_token: z.string().min(1).optional(),
})

const reportJobStatusSchema = z.object({
  completed_at: z.string().nullable().optional(),
  created_at: z.string(),
  error_code: z.string().nullable().optional(),
  job_id: z.string().min(1),
  report_id: z.string().nullable().optional(),
  report_url: z.string().nullable().optional(),
  retryable: z.boolean().nullable().optional(),
  status: z.enum(['queued', 'generating', 'rendering_assets', 'completed', 'failed']),
})

const completedReportSchema = z.object({
  assets: z.array(z.unknown()).optional(),
  citations: z.array(z.unknown()).optional(),
  generated_at: z.string(),
  lifecycle: z.unknown().optional(),
  next_action: z.unknown().nullable().optional(),
  report: z.object({
    content: z.string().optional(),
    format: z.string().optional(),
    html: z.string().min(1),
  }),
  report_id: z.string().min(1),
  report_type: z.enum(['anonymous', 'personalized']),
  scores: z.unknown().optional(),
  warnings: z.array(z.string()).optional(),
})

export type ReportAccepted = z.infer<typeof reportAcceptedSchema>
export type ReportJobStatus = z.infer<typeof reportJobStatusSchema>
export type CompletedReport = z.infer<typeof completedReportSchema>

export class ReportServiceError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number | null

  constructor(message: string, options: { code: string; retryable: boolean; status?: number | null }) {
    super(message)
    this.name = 'ReportServiceError'
    this.code = options.code
    this.retryable = options.retryable
    this.status = options.status ?? null
  }
}

export type ReportServiceClientConfig = {
  baseUrl: string
  timeoutMs: number
}

function joinUrl(baseUrl: string, path: string) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return new URL(path.replace(/^\/+/, ''), base).toString()
}

async function parseResponseBody(response: Response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function errorMessageFromBody(body: unknown) {
  if (!body || typeof body !== 'object') return null
  const detail = 'detail' in body ? body.detail : undefined
  if (typeof detail === 'string') return detail
  const error = 'error' in body ? body.error : undefined
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return null
}

export class ReportServiceClient {
  constructor(private readonly config: ReportServiceClientConfig) {}

  async submitReport(path: string, payload: unknown): Promise<ReportAccepted> {
    const data = await this.request(path, {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    return reportAcceptedSchema.parse(data)
  }

  async getJob(jobId: string): Promise<ReportJobStatus> {
    const data = await this.request(`/v2/report-jobs/${encodeURIComponent(jobId)}`)
    return reportJobStatusSchema.parse(data)
  }

  async getReport(reportId: string): Promise<CompletedReport> {
    const data = await this.request(`/v2/reports/${encodeURIComponent(reportId)}`)
    return completedReportSchema.parse(data)
  }

  private async request(path: string, init: RequestInit = {}) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const response = await fetch(joinUrl(this.config.baseUrl, path), {
        ...init,
        signal: controller.signal,
      })
      const body = await parseResponseBody(response)

      if (!response.ok) {
        const message = errorMessageFromBody(body) ?? `Report service request failed with status ${response.status}.`
        throw new ReportServiceError(message, {
          code: `report_service_${response.status}`,
          retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
          status: response.status,
        })
      }

      return body
    } catch (error) {
      if (error instanceof ReportServiceError) throw error
      if (error instanceof z.ZodError) {
        throw new ReportServiceError('Report service response did not match the expected contract.', {
          code: 'invalid_report_service_response',
          retryable: false,
        })
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ReportServiceError('Report service request timed out.', {
          code: 'report_service_timeout',
          retryable: true,
        })
      }
      throw new ReportServiceError(error instanceof Error ? error.message : 'Report service request failed.', {
        code: 'report_service_request_failed',
        retryable: true,
      })
    } finally {
      clearTimeout(timeout)
    }
  }
}
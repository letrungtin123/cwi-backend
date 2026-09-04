import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { ReportWorker } from '../src/modules/reports/reportWorker.js'
import type { ClaimedReportJob, PgReportRepository } from '../src/modules/reports/reportRepository.js'
import type { ReportServiceClient } from '../src/modules/reports/reportServiceClient.js'

function createJob(): ClaimedReportJob {
  return {
    aiJobId: 'ai-job-1',
    aiReportId: null,
    attemptCount: 0,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    htmlStoragePath: null,
    id: 'job-1',
    pollCount: 0,
    providerEndpoint: '/v3/reports/anonymous',
    requestPayload: {},
    reportType: 'anonymous',
    status: 'queued_ai',
    submissionId: 'submission-1',
  }
}

function createWorker(client: ReportServiceClient, repository: PgReportRepository, maxAttempts = 5) {
  return new ReportWorker({
    assetStorage: {} as never,
    client,
    config: {
      autoEmailEnabled: false,
      debugDumpHtml: false,
      debugHtmlDir: './storage/debug-report-html',
      enabled: true,
      generatedPdfFileName: 'bao-cao.pdf',
      generatedStorageBucket: 'reports',
      initialPollDelayMs: 1000,
      lockMs: 30000,
      loopIntervalMs: 1000,
      maxAttempts,
      maxPollDelayMs: 60000,
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger,
    pdfRenderer: {} as never,
    repository,
  })
}

describe('ReportWorker AI failure handling', () => {
  it('retries a provider failure only when V3 marks it retryable', async () => {
    const repository = { markRetry: vi.fn(), markFailed: vi.fn() } as unknown as PgReportRepository
    const client = { getJob: vi.fn().mockResolvedValue({ error_code: 'worker_timeout', retryable: true, status: 'failed' }) } as unknown as ReportServiceClient
    const worker = createWorker(client, repository)

    await (worker as unknown as { processJob: (job: ClaimedReportJob) => Promise<void> }).processJob(createJob())

    expect(repository.markRetry).toHaveBeenCalledWith(
      'job-1',
      'queued_ai',
      1,
      'worker_timeout',
      'AI report job failed.',
      expect.any(Date),
    )
    expect(repository.markFailed).not.toHaveBeenCalled()
  })

  it('does not retry a permanent provider failure', async () => {
    const repository = { markRetry: vi.fn(), markFailed: vi.fn() } as unknown as PgReportRepository
    const client = { getJob: vi.fn().mockResolvedValue({ error_code: 'invalid_request', retryable: false, status: 'failed' }) } as unknown as ReportServiceClient
    const worker = createWorker(client, repository)

    await (worker as unknown as { processJob: (job: ClaimedReportJob) => Promise<void> }).processJob(createJob())

    expect(repository.markFailed).toHaveBeenCalledWith('job-1', 1, 'invalid_request', 'AI report job failed.')
    expect(repository.markRetry).not.toHaveBeenCalled()
  })
})

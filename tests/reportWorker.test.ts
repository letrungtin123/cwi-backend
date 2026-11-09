import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import { ReportWorker } from '../src/modules/reports/reportWorker.js'
import type { ReportAssetStorage } from '../src/modules/reports/reportAssetStorage.js'
import type { ReportPdfRenderer } from '../src/modules/reports/reportPdfRenderer.js'
import type { ClaimedReportJob, PgReportRepository } from '../src/modules/reports/reportRepository.js'
import { ReportServiceError, type ReportServiceClient } from '../src/modules/reports/reportServiceClient.js'

function createJob(): ClaimedReportJob {
  return {
    aiJobId: 'ai-job-1',
    aiReportId: null,
    attemptCount: 0,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
    htmlStoragePath: null,
    id: 'job-1',
    language: 'vi',
    pollCount: 0,
    providerEndpoint: '/v3/reports/anonymous',
    requestPayload: {},
    reportType: 'anonymous',
    status: 'queued_ai',
    submissionId: 'submission-1',
  }
}

function createWorker(
  client: ReportServiceClient,
  repository: PgReportRepository,
  maxAttempts = 5,
  storage: { assetStorage: ReportAssetStorage; pdfRenderer: ReportPdfRenderer } = { assetStorage: {} as never, pdfRenderer: {} as never },
) {
  return new ReportWorker({
    assetStorage: storage.assetStorage,
    client,
    config: {
      autoEmailEnabled: false,
      debugDumpHtml: false,
      debugHtmlDir: './storage/debug-report-html',
      enabled: true,
      generatedPdfFileName: 'bao-cao.pdf',
      generatedPdfFileNameEn: 'report.pdf',
      generatedStorageBucket: 'reports',
      initialPollDelayMs: 1000,
      lockMs: 30000,
      loopIntervalMs: 1000,
      maxAiInFlight: 3,
      maxAttempts,
      maxPollDelayMs: 60000,
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger,
    pdfRenderer: storage.pdfRenderer,
    repository,
  })
}

function completedReport(reportId: string, language: 'vi' | 'en') {
  return { generated_at: '2026-11-02T00:00:00Z', language, report: { html: `<html lang="${language}"></html>` }, report_id: reportId, report_type: 'anonymous' as const }
}

function createStorage() {
  return {
    assetStorage: { uploadFile: vi.fn() } as unknown as ReportAssetStorage,
    pdfRenderer: {
      cleanup: vi.fn().mockResolvedValue(undefined),
      renderPdf: vi.fn().mockResolvedValue({ pdfPath: '/tmp/report.pdf', sha256: 'b'.repeat(64) }),
      storeHtml: vi.fn().mockResolvedValue({ htmlPath: '/tmp/report.html', reportDir: '/tmp' }),
    } as unknown as ReportPdfRenderer,
  }
}

describe('ReportWorker report language', () => {
  it('publishes the English translation of the Vietnamese report for a survey taken in English', async () => {
    const repository = { markCompleted: vi.fn(), markHtmlReady: vi.fn() } as unknown as PgReportRepository
    const client = {
      createEnglishReport: vi.fn().mockResolvedValue(completedReport('en-report', 'en')),
      getReport: vi.fn(),
    } as unknown as ReportServiceClient
    const storage = createStorage()
    const worker = createWorker(client, repository, 5, storage)

    await (worker as unknown as { processJob: (job: ClaimedReportJob) => Promise<void> }).processJob({
      ...createJob(),
      aiReportId: 'vi-report',
      language: 'en',
      status: 'generating_pdf',
    })

    expect(client.createEnglishReport).toHaveBeenCalledWith('vi-report')
    expect(client.getReport).not.toHaveBeenCalled()
    expect(storage.pdfRenderer.storeHtml).toHaveBeenCalledWith('submission-1', 'en-report', '<html lang="en"></html>')
    expect(repository.markHtmlReady).toHaveBeenCalledWith('job-1', expect.any(String), expect.objectContaining({ language: 'en', report_id: 'en-report' }))
    expect(repository.markCompleted).toHaveBeenCalledWith('job-1', expect.any(String), 'b'.repeat(64), expect.objectContaining({ fileName: 'report.pdf' }))
  })

  it('publishes the Vietnamese report unchanged for a survey taken in Vietnamese', async () => {
    const repository = { markCompleted: vi.fn(), markHtmlReady: vi.fn() } as unknown as PgReportRepository
    const client = {
      createEnglishReport: vi.fn(),
      getReport: vi.fn().mockResolvedValue(completedReport('vi-report', 'vi')),
    } as unknown as ReportServiceClient
    const worker = createWorker(client, repository, 5, createStorage())

    await (worker as unknown as { processJob: (job: ClaimedReportJob) => Promise<void> }).processJob({
      ...createJob(),
      aiReportId: 'vi-report',
      status: 'generating_pdf',
    })

    expect(client.getReport).toHaveBeenCalledWith('vi-report')
    expect(client.createEnglishReport).not.toHaveBeenCalled()
    expect(repository.markCompleted).toHaveBeenCalledWith('job-1', expect.any(String), 'b'.repeat(64), expect.objectContaining({ fileName: 'bao-cao.pdf' }))
  })

  it('retries a translation timeout without falling back to the Vietnamese report', async () => {
    const repository = { markCompleted: vi.fn(), markFailed: vi.fn(), markRetry: vi.fn() } as unknown as PgReportRepository
    const client = {
      createEnglishReport: vi.fn().mockRejectedValue(new ReportServiceError('Report service request timed out.', { code: 'report_service_timeout', retryable: true })),
      getReport: vi.fn(),
    } as unknown as ReportServiceClient
    const worker = createWorker(client, repository)

    await (worker as unknown as { processJob: (job: ClaimedReportJob) => Promise<void> }).processJob({
      ...createJob(),
      aiReportId: 'vi-report',
      language: 'en',
      status: 'generating_pdf',
    })

    expect(client.getReport).not.toHaveBeenCalled()
    expect(repository.markCompleted).not.toHaveBeenCalled()
    expect(repository.markRetry).toHaveBeenCalledWith('job-1', 'generating_pdf', 1, 'report_service_timeout', 'Report service request timed out.', expect.any(Date))
  })
})

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

describe('ReportWorker cwi-ai switch', () => {
  function settings(aiCallsEnabled: boolean) {
    return { aiCallsEnabled, deferredResultDays: 7, updatedAt: null, updatedByEmail: null }
  }

  async function tick(worker: ReportWorker) {
    await (worker as unknown as { tick: () => Promise<void> }).tick()
    worker.stop()
  }

  it('claims no job and calls nothing while cwi-ai calls are turned off', async () => {
    const repository = {
      claimNextReadyJob: vi.fn(),
      getGenerationSettings: vi.fn().mockResolvedValue(settings(false)),
    } as unknown as PgReportRepository
    const client = { getJob: vi.fn(), submitReport: vi.fn() } as unknown as ReportServiceClient
    const worker = createWorker(client, repository)

    await tick(worker)

    expect(repository.claimNextReadyJob).not.toHaveBeenCalled()
    expect(client.submitReport).not.toHaveBeenCalled()
    expect(client.getJob).not.toHaveBeenCalled()
  })

  it('sends a waiting job to cwi-ai once the calls are turned back on, capped by maxAiInFlight', async () => {
    const pendingJob = { ...createJob(), aiJobId: null, status: 'pending' as const }
    const repository = {
      claimNextReadyJob: vi.fn().mockResolvedValue(pendingJob),
      getGenerationSettings: vi.fn().mockResolvedValue(settings(true)),
      markAccepted: vi.fn(),
    } as unknown as PgReportRepository
    const client = { submitReport: vi.fn().mockResolvedValue({ job_id: 'ai-job-2', status_url: '/v3/report-jobs/ai-job-2' }) } as unknown as ReportServiceClient
    const worker = createWorker(client, repository)

    await tick(worker)

    expect(repository.claimNextReadyJob).toHaveBeenCalledWith(expect.any(String), 30000, 3)
    expect(client.submitReport).toHaveBeenCalledWith('/v3/reports/anonymous', {})
    expect(repository.markAccepted).toHaveBeenCalledOnce()
  })
})

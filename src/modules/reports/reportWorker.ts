import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { buildReportObjectPaths, ReportAssetStorageError, type ReportAssetStorage } from './reportAssetStorage.js'
import type { ClaimedReportJob, PgReportRepository } from './reportRepository.js'
import { PdfRenderError, type ReportPdfRenderer, type StoredHtml } from './reportPdfRenderer.js'
import { ReportServiceClient, ReportServiceError, type CompletedReport } from './reportServiceClient.js'

export type ReportWorkerConfig = {
  enabled: boolean
  initialPollDelayMs: number
  lockMs: number
  loopIntervalMs: number
  maxAttempts: number
  maxPollDelayMs: number
}

export type ReportWorkerDependencies = {
  assetStorage: ReportAssetStorage
  client: ReportServiceClient
  config: ReportWorkerConfig
  logger: Logger
  pdfRenderer: ReportPdfRenderer
  repository: PgReportRepository
}

type ErrorInfo = {
  code: string
  message: string
  retryable: boolean
}

function addMs(value: number) {
  return new Date(Date.now() + value)
}

function pollDelay(job: ClaimedReportJob, config: ReportWorkerConfig) {
  const exponent = Math.min(job.pollCount, 3)
  return Math.min(config.maxPollDelayMs, config.initialPollDelayMs * 2 ** exponent)
}

function retryDelay(attemptCount: number, config: ReportWorkerConfig) {
  const exponent = Math.min(attemptCount, 4)
  return Math.min(config.maxPollDelayMs, config.initialPollDelayMs * 2 ** exponent)
}

function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ReportServiceError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  if (error instanceof PdfRenderError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  if (error instanceof ReportAssetStorageError) {
    return { code: error.code, message: error.message, retryable: error.retryable }
  }
  return {
    code: 'report_worker_error',
    message: error instanceof Error ? error.message : 'Report worker failed.',
    retryable: true,
  }
}

function minimalReportForStorage(report: CompletedReport) {
  return {
    assets: report.assets ?? [],
    citations: report.citations ?? [],
    generated_at: report.generated_at,
    lifecycle: report.lifecycle ?? null,
    next_action: report.next_action ?? null,
    report_id: report.report_id,
    report_type: report.report_type,
    scores: report.scores ?? null,
    warnings: report.warnings ?? [],
  }
}

export class ReportWorker {
  private readonly workerId = `cwi-report-worker-${process.pid}-${randomUUID()}`
  private isRunning = false
  private isStopping = false
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly dependencies: ReportWorkerDependencies) {}

  start() {
    if (!this.dependencies.config.enabled) return
    this.dependencies.logger.info({ workerId: this.workerId }, 'Report worker started')
    this.schedule(0)
  }

  stop() {
    this.isStopping = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delayMs: number) {
    if (this.isStopping) return
    this.timer = setTimeout(() => {
      void this.tick()
    }, delayMs)
    this.timer.unref?.()
  }

  private async tick() {
    if (this.isRunning || this.isStopping) return
    this.isRunning = true

    try {
      const job = await this.dependencies.repository.claimNextReadyJob(this.workerId, this.dependencies.config.lockMs)
      if (job) await this.processJob(job)
    } catch (error) {
      this.dependencies.logger.error({ error }, 'Report worker tick failed')
    } finally {
      this.isRunning = false
      this.schedule(this.dependencies.config.loopIntervalMs)
    }
  }

  private async processJob(job: ClaimedReportJob) {
    try {
      if (job.status === 'pending') {
        await this.submitToAi(job)
        return
      }

      if (job.status === 'html_ready' || job.status === 'generating_pdf') {
        if (!job.aiReportId) {
          throw new ReportServiceError('Report job is missing ai_report_id for PDF generation.', {
            code: 'missing_ai_report_id',
            retryable: false,
          })
        }

        await this.generateAndUploadReportAssets(job, job.aiReportId)
        return
      }

      await this.pollAi(job)
    } catch (error) {
      await this.handleJobError(job, error)
    }
  }

  private async submitToAi(job: ClaimedReportJob) {
    const accepted = await this.dependencies.client.submitReport(job.providerEndpoint, job.requestPayload)
    await this.dependencies.repository.markAccepted(job.id, accepted, addMs(this.dependencies.config.initialPollDelayMs))
    this.dependencies.logger.info({ aiJobId: accepted.job_id, jobId: job.id }, 'Report job accepted by AI service')
  }

  private async pollAi(job: ClaimedReportJob) {
    if (!job.aiJobId) {
      throw new ReportServiceError('Report job is missing ai_job_id.', {
        code: 'missing_ai_job_id',
        retryable: false,
      })
    }

    const status = await this.dependencies.client.getJob(job.aiJobId)

    if (status.status === 'failed') {
      await this.dependencies.repository.markFailed(job.id, job.attemptCount + 1, status.error_code ?? 'ai_report_failed', 'AI report job failed.')
      return
    }

    if (status.status !== 'completed') {
      await this.dependencies.repository.markPolled(job.id, status.status, addMs(pollDelay(job, this.dependencies.config)))
      return
    }

    if (!status.report_id) {
      throw new ReportServiceError('Completed AI report job did not include report_id.', {
        code: 'missing_ai_report_id',
        retryable: true,
      })
    }

    await this.dependencies.repository.markPdfGenerating(job.id, status.report_id)
    await this.generateAndUploadReportAssets(job, status.report_id)
  }

  private async generateAndUploadReportAssets(job: ClaimedReportJob, reportId: string) {
    let storedHtml: StoredHtml | null = null

    try {
      const report = await this.dependencies.client.getReport(reportId)
      storedHtml = await this.dependencies.pdfRenderer.storeHtml(job.submissionId, report.report_id, report.report.html)
      const pdf = await this.dependencies.pdfRenderer.renderPdf(storedHtml)
      const objectPaths = buildReportObjectPaths({ reportJobId: job.id, submissionId: job.submissionId, timestamp: job.createdAt })

      await this.dependencies.assetStorage.uploadFile(objectPaths.htmlPath, storedHtml.htmlPath, 'text/html')
      await this.dependencies.assetStorage.uploadFile(objectPaths.pdfPath, pdf.pdfPath, 'application/pdf')
      await this.dependencies.repository.markCompleted(
        job.id,
        objectPaths.htmlPath,
        objectPaths.pdfPath,
        pdf.sha256,
        minimalReportForStorage(report),
      )
      this.dependencies.logger.info({ jobId: job.id, pdfStoragePath: objectPaths.pdfPath }, 'Report PDF uploaded to Supabase Storage')
    } finally {
      if (storedHtml) {
        await this.dependencies.pdfRenderer.cleanup(storedHtml).catch((error: unknown) => {
          this.dependencies.logger.warn({ error, jobId: job.id }, 'Report temporary file cleanup failed')
        })
      }
    }
  }

  private async handleJobError(job: ClaimedReportJob, error: unknown) {
    const info = toErrorInfo(error)
    const nextAttemptCount = job.attemptCount + 1

    if (info.retryable && nextAttemptCount < this.dependencies.config.maxAttempts) {
      await this.dependencies.repository.markRetry(
        job.id,
        job.status,
        nextAttemptCount,
        info.code,
        info.message,
        addMs(retryDelay(nextAttemptCount, this.dependencies.config)),
      )
      this.dependencies.logger.warn({ errorCode: info.code, jobId: job.id }, 'Report job will retry')
      return
    }

    await this.dependencies.repository.markFailed(job.id, nextAttemptCount, info.code, info.message)
    this.dependencies.logger.error({ errorCode: info.code, jobId: job.id }, 'Report job failed')
  }
}
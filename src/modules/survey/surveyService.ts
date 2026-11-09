import type { RequestMeta } from '../../http/requestMeta.js'
import { buildReportJobRequest } from '../reports/reportPayload.js'
import type { ReportAccessTokenService } from '../reports/reportAccessToken.js'
import { reportDeferral } from '../reports/reportDeferral.js'
import type { PgReportRepository, ReportJobStatusValue } from '../reports/reportRepository.js'
import { normalizeSurveySubmission } from './submissionValidation.js'
import type { SubmissionCreateResult, SurveyRepository } from './surveyRepository.js'

export class SurveyService {
  constructor(
    private readonly repository: SurveyRepository,
    private readonly options: {
      reportAccessTokenService?: ReportAccessTokenService
      reportServiceEnabled: boolean
      reportSettings?: Pick<PgReportRepository, 'getGenerationSettings'>
    } = { reportServiceEnabled: false },
  ) {}

  async submit(payload: unknown, meta: RequestMeta): Promise<SubmissionCreateResult> {
    const submission = normalizeSurveySubmission(payload, meta.idempotencyKey)

    const reportJob = this.options.reportServiceEnabled ? buildReportJobRequest(submission) : null
    const result = await this.repository.createSubmission(submission, meta, reportJob)
    if (!this.options.reportServiceEnabled || !result.reportJob || !this.options.reportAccessTokenService) return result

    const access = this.options.reportAccessTokenService.issue(result.reportJob.id)
    // The submission is already stored; the deferral only tells the waiting page what to show.
    const deferral = this.options.reportSettings
      ? reportDeferral(result.reportJob.status as ReportJobStatusValue, await this.options.reportSettings.getGenerationSettings())
      : { deferredResultDays: null, resultDeferred: false }
    return {
      ...result,
      reportAccess: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        deferredResultDays: deferral.deferredResultDays,
        jobId: result.reportJob.id,
        resultDeferred: deferral.resultDeferred,
        status: result.reportJob.status,
      },
    }
  }
}

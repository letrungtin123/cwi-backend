import type { RequestMeta } from '../../http/requestMeta.js'
import { buildReportJobRequest } from '../reports/reportPayload.js'
import type { ReportAccessTokenService } from '../reports/reportAccessToken.js'
import { normalizeSurveySubmission } from './submissionValidation.js'
import type { SubmissionCreateResult, SurveyRepository } from './surveyRepository.js'

export class SurveyService {
  constructor(
    private readonly repository: SurveyRepository,
    private readonly options: {
      reportAccessTokenService?: ReportAccessTokenService
      reportServiceEnabled: boolean
    } = { reportServiceEnabled: false },
  ) {}

  async submit(payload: unknown, meta: RequestMeta): Promise<SubmissionCreateResult> {
    const submission = normalizeSurveySubmission(payload, meta.idempotencyKey)

    const reportJob = this.options.reportServiceEnabled ? buildReportJobRequest(submission) : null
    const result = await this.repository.createSubmission(submission, meta, reportJob)
    if (!this.options.reportServiceEnabled || !result.reportJob || !this.options.reportAccessTokenService) return result

    const access = this.options.reportAccessTokenService.issue(result.reportJob.id)
    return {
      ...result,
      reportAccess: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        jobId: result.reportJob.id,
        status: result.reportJob.status,
      },
    }
  }
}

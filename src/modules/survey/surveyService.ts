import type { RequestMeta } from '../../http/requestMeta.js'
import { buildReportJobRequest } from '../reports/reportPayload.js'
import { normalizeSurveySubmission } from './submissionValidation.js'
import type { SubmissionCreateResult, SurveyRepository } from './surveyRepository.js'

export type ReportQueueConfig = {
  enabled: boolean
  participantPhonePlaceholder: string
}

const disabledReportQueue: ReportQueueConfig = {
  enabled: false,
  participantPhonePlaceholder: '00000000',
}

export class SurveyService {
  constructor(
    private readonly repository: SurveyRepository,
    private readonly reportQueue: ReportQueueConfig = disabledReportQueue,
  ) {}

  async submit(payload: unknown, meta: RequestMeta): Promise<SubmissionCreateResult> {
    const submission = normalizeSurveySubmission(payload, meta.idempotencyKey)
    const reportJob = this.reportQueue.enabled
      ? buildReportJobRequest(submission, { participantPhonePlaceholder: this.reportQueue.participantPhonePlaceholder })
      : null

    return this.repository.createSubmission(submission, meta, reportJob)
  }
}
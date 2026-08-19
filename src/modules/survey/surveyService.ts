import type { RequestMeta } from '../../http/requestMeta.js'
import { buildAnonymousReportPayload } from '../reports/anonymousReportPayload.js'
import { normalizeSurveySubmission } from './submissionValidation.js'
import type { SubmissionCreateResult, SurveyRepository } from './surveyRepository.js'

export class SurveyService {
  constructor(private readonly repository: SurveyRepository) {}

  async submit(payload: unknown, meta: RequestMeta): Promise<SubmissionCreateResult> {
    const submission = normalizeSurveySubmission(payload, meta.idempotencyKey)

    // Build now to keep the future report-service contract covered by tests.
    // The actual external call is intentionally not enabled in this phase.
    buildAnonymousReportPayload(submission)

    return this.repository.createSubmission(submission, meta)
  }
}

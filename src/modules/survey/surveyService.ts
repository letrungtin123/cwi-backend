import type { RequestMeta } from '../../http/requestMeta.js'
import { normalizeSurveySubmission } from './submissionValidation.js'
import type { SubmissionCreateResult, SurveyRepository } from './surveyRepository.js'

export class SurveyService {
  constructor(private readonly repository: SurveyRepository) {}

  async submit(payload: unknown, meta: RequestMeta): Promise<SubmissionCreateResult> {
    const submission = normalizeSurveySubmission(payload, meta.idempotencyKey)

    // Temporarily disabled: survey submissions must not enqueue cwi-ai report jobs.
    return this.repository.createSubmission(submission, meta, null)
  }
}
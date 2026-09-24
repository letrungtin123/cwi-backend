import type { RequestMeta } from '../../http/requestMeta.js'
import { normalizeWebinarEmailCheck, normalizeWebinarRegistration } from './webinarValidation.js'
import type { WebinarRegistrationCreateResult, WebinarRepository } from './webinarRepository.js'

export class WebinarService {
  constructor(private readonly repository: WebinarRepository) {}

  async register(payload: unknown, meta: RequestMeta): Promise<WebinarRegistrationCreateResult> {
    const registration = normalizeWebinarRegistration(payload, meta.idempotencyKey)
    return this.repository.createRegistration(registration, meta)
  }

  async check(payload: unknown): Promise<{ registered: boolean }> {
    const { email } = normalizeWebinarEmailCheck(payload)
    return this.repository.checkRegistration(email)
  }
}

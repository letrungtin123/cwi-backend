import type { RequestMeta } from '../../http/requestMeta.js'
import { normalizeRoundtableEmailCheck, normalizeRoundtableRegistration } from './roundtableValidation.js'
import type { RoundtableRegistrationCreateResult, RoundtableRepository } from './roundtableRepository.js'

export class RoundtableService {
  constructor(private readonly repository: RoundtableRepository) {}

  async register(payload: unknown, meta: RequestMeta): Promise<RoundtableRegistrationCreateResult> {
    const registration = normalizeRoundtableRegistration(payload, meta.idempotencyKey)
    return this.repository.createRegistration(registration, meta)
  }

  async check(payload: unknown): Promise<{ registered: boolean }> {
    const { email } = normalizeRoundtableEmailCheck(payload)
    return this.repository.checkRegistration(email)
  }
}

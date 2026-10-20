import type { RequestMeta } from '../../http/requestMeta.js'
import { CURRENT_ROUNDTABLE_QUARTER } from './roundtableQuarter.js'
import { normalizeRoundtableEmailCheck, normalizeRoundtableEventUpdate, normalizeRoundtableRegistration } from './roundtableValidation.js'
import type { RoundtableEvent, RoundtableRegistrationCreateResult, RoundtableRepository } from './roundtableRepository.js'

export class RoundtableService {
  constructor(private readonly repository: RoundtableRepository) {}

  async register(payload: unknown, meta: RequestMeta): Promise<RoundtableRegistrationCreateResult> {
    const registration = normalizeRoundtableRegistration(payload, meta.idempotencyKey)
    return this.repository.createRegistration(registration, meta)
  }

  async check(payload: unknown): Promise<{ quarter: string; registered: boolean }> {
    const { email } = normalizeRoundtableEmailCheck(payload)
    const result = await this.repository.checkRegistration(email, CURRENT_ROUNDTABLE_QUARTER)
    return { ...result, quarter: CURRENT_ROUNDTABLE_QUARTER }
  }

  getCurrentEvent(): Promise<RoundtableEvent> {
    return this.repository.getEvent(CURRENT_ROUNDTABLE_QUARTER)
  }

  saveCurrentEvent(payload: unknown, updatedByEmail: string): Promise<RoundtableEvent> {
    return this.repository.saveEvent(CURRENT_ROUNDTABLE_QUARTER, normalizeRoundtableEventUpdate(payload), updatedByEmail)
  }
}

import { describe, expect, it } from 'vitest'
import { isUuid } from '../src/http/ids.js'
import { roundtableSelect, webinarSelect } from '../src/modules/admin/adminQueries.js'
import { normalizePhoneNumber } from '../src/modules/shared/phone.js'

describe('phone numbers (the key that links surveys to registrations)', () => {
  it.each([
    ['0901234567', '+84901234567'],
    [' 090 123 4567 ', '+84901234567'],
    ['(090) 123-4567', '+84901234567'],
    ['090.123.4567', '+84901234567'],
    ['02838123456', '+842838123456'],
    ['+84901234567', '+84901234567'],
    ['+65 6123 4567', '+6561234567'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected)
  })

  it.each(['', '12345', '090123', '+0123456789', '84901234567', '0901 234 567 890', 'abc'])('rejects %j', (input) => {
    expect(normalizePhoneNumber(input)).toBeNull()
  })
})

describe('ids', () => {
  it('accepts UUIDs and nothing else', () => {
    expect(isUuid('2c78db0b-e97e-49ca-8a9a-2565077f0ffd')).toBe(true)
    expect(isUuid('2C78DB0B-E97E-49CA-8A9A-2565077F0FFD')).toBe(true)
    expect(isUuid('2c78db0b-e97e-49ca-8a9a')).toBe(false)
    expect(isUuid(42)).toBe(false)
    expect(isUuid(undefined)).toBe(false)
  })
})

describe('webinar list query', () => {
  it('is the roundtable query pointed at the webinar table and columns', () => {
    expect(webinarSelect).toContain('public.cwi_webinar_registrations')
    expect(webinarSelect).not.toContain('public.cwi_roundtable_registrations')
    expect(webinarSelect).toContain('r.speaker_question')
    expect(webinarSelect).toContain('NULL::text AS quarter,')
    expect(roundtableSelect).toContain('public.cwi_roundtable_registrations')
  })
})

import { describe, expect, it } from 'vitest'
import { ReportAccessTokenService } from '../src/modules/reports/reportAccessToken.js'

describe('ReportAccessTokenService', () => {
  it('issues a token that is bound to the report job', () => {
    const service = new ReportAccessTokenService('a'.repeat(32), 3600)
    const issued = service.issue('2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd')

    expect(service.verify('2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd', issued.token)).toBe(true)
    expect(service.verify('00000000-0000-4000-8000-000000000000', issued.token)).toBe(false)
  })

  it('rejects tampered and expired tokens', () => {
    const service = new ReportAccessTokenService('b'.repeat(32), 1)
    const issued = service.issue('2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd')
    const parts = issued.token.split('.')

    expect(service.verify('2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd', `${parts[0]}.${parts[1]}.tampered`)).toBe(false)

    const expiredService = new ReportAccessTokenService('b'.repeat(32), -1)
    const expired = expiredService.issue('2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd')
    expect(expiredService.verify('2d8f8c6a-2c0b-4bd4-9f86-1f9d8bf4b4dd', expired.token)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { reportDeferral } from '../src/modules/reports/reportDeferral.js'
import { normalizeReportGenerationSettingsUpdate } from '../src/modules/reports/reportGenerationSettingsRoutes.js'

function settings(aiCallsEnabled: boolean) {
  return { aiCallsEnabled, deferredResultDays: 7, updatedAt: null, updatedByEmail: null }
}

describe('report deferral', () => {
  it('defers an unfinished report while cwi-ai calls are turned off', () => {
    expect(reportDeferral('pending', settings(false))).toEqual({ deferredResultDays: 7, resultDeferred: true })
    expect(reportDeferral('queued_ai', settings(false))).toEqual({ deferredResultDays: 7, resultDeferred: true })
  })

  it('does not defer while cwi-ai calls are on', () => {
    expect(reportDeferral('pending', settings(true))).toEqual({ deferredResultDays: null, resultDeferred: false })
  })

  it('does not defer a report that is already finished', () => {
    expect(reportDeferral('completed', settings(false))).toEqual({ deferredResultDays: null, resultDeferred: false })
    expect(reportDeferral('failed', settings(false))).toEqual({ deferredResultDays: null, resultDeferred: false })
  })
})

describe('report generation settings update', () => {
  it('accepts the switch and a whole number of days from 1 to 60', () => {
    expect(normalizeReportGenerationSettingsUpdate({ aiCallsEnabled: false, deferredResultDays: 7 })).toEqual({ aiCallsEnabled: false, deferredResultDays: 7 })
  })

  it('rejects days outside 1 to 60, fractions and unknown fields', () => {
    for (const payload of [
      { aiCallsEnabled: true, deferredResultDays: 0 },
      { aiCallsEnabled: true, deferredResultDays: 61 },
      { aiCallsEnabled: true, deferredResultDays: 2.5 },
      { aiCallsEnabled: 'false', deferredResultDays: 7 },
      { aiCallsEnabled: true, deferredResultDays: 7, extra: 1 },
    ]) {
      expect(() => normalizeReportGenerationSettingsUpdate(payload)).toThrow('Số ngày báo kết quả')
    }
  })
})

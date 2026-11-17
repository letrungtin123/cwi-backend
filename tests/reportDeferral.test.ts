import { describe, expect, it } from 'vitest'
import { reportDeferral } from '../src/modules/reports/reportDeferral.js'

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


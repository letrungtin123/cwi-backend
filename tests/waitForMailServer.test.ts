import { describe, expect, it, vi } from 'vitest'
import { waitForMailServer } from '../src/modules/reportDelivery/waitForMailServer.js'

function fakeLogger() {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}

describe('waitForMailServer', () => {
  it('retries a failing mail server instead of giving up, then continues', async () => {
    const logger = fakeLogger()
    const verify = vi.fn()
      .mockRejectedValueOnce(new Error('TLS handshake timed out'))
      .mockRejectedValueOnce(new Error('Invalid login: 451 4.7.0 Temporary server error'))
      .mockResolvedValueOnce(true)
    const slept: number[] = []
    const ok = await waitForMailServer(verify, { firstDelayMs: 3000, isStopping: () => false, logger, sleep: async (ms) => { slept.push(ms) } })
    expect(ok).toBe(true)
    expect(verify).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith({ attempt: 3 }, 'Mail server reachable again')
    // 3 s after the first failure, then double: 6 s, slept in steps of at most 1 s.
    expect(slept.reduce((a, b) => a + b, 0)).toBe(3000 + 6000)
    expect(Math.max(...slept)).toBeLessThanOrEqual(1000)
  })

  it('caps the pause and reports an error after repeated failures', async () => {
    const logger = fakeLogger()
    let calls = 0
    const verify = vi.fn(async () => {
      calls += 1
      if (calls < 7) throw new Error('Greeting never received')
    })
    const pauses: number[] = []
    let current = 0
    await waitForMailServer(verify, {
      firstDelayMs: 1000,
      isStopping: () => false,
      logger,
      maxDelayMs: 4000,
      sleep: async (ms) => { current += ms },
    })
    // Recover pause lengths from the retryInMs the log carries.
    for (const call of [...logger.warn.mock.calls, ...logger.error.mock.calls]) pauses.push((call[0] as { retryInMs: number }).retryInMs)
    expect(pauses.sort((a, b) => a - b)).toEqual([1000, 2000, 4000, 4000, 4000, 4000])
    expect(logger.warn).toHaveBeenCalledTimes(4)
    expect(logger.error).toHaveBeenCalledTimes(2)
    expect(current).toBe(19000)
  })

  it('stops waiting as soon as the worker is asked to stop', async () => {
    const logger = fakeLogger()
    let stopping = false
    let slept = 0
    const ok = await waitForMailServer(async () => { throw new Error('ECONNRESET') }, {
      firstDelayMs: 60_000,
      isStopping: () => stopping,
      logger,
      sleep: async (ms) => {
        slept += ms
        if (slept >= 2000) stopping = true
      },
    })
    expect(ok).toBe(false)
    expect(slept).toBe(2000)
  })
})

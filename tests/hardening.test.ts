import { createServer, validateHeaderValue } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { describe, expect, it } from 'vitest'
import { createRequestLogger } from '../src/app.js'
import { normalizeTrustProxy } from '../src/config/trustProxy.js'
import { createLogger } from '../src/logger.js'
import { contentDispositionAttachment, contentDispositionInline } from '../src/modules/reportDelivery/reportDeliveryFilename.js'
import { withRenderCsp } from '../src/modules/reports/reportPdfRenderer.js'

describe('TRUST_PROXY', () => {
  it('reads "true" as one proxy hop and numbers as hop counts', () => {
    expect(normalizeTrustProxy('true')).toBe(1)
    expect(normalizeTrustProxy(true)).toBe(1)
    expect(normalizeTrustProxy('2')).toBe(2)
    expect(normalizeTrustProxy('false')).toBe(false)
    expect(normalizeTrustProxy('')).toBe(false)
    expect(normalizeTrustProxy(undefined)).toBe(false)
    expect(normalizeTrustProxy('yes')).toBe('yes')
  })

  it('takes the address the nearest proxy added, not one the client wrote itself', async () => {
    const app = express()
    app.set('trust proxy', normalizeTrustProxy('true'))
    app.get('/ip', (req, res) => {
      res.json({ ip: req.ip })
    })
    const server = createServer(app).listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    try {
      const { port } = server.address() as AddressInfo
      // The client sent "6.6.6.6"; nginx appended the real address 203.0.113.9.
      const response = await fetch(`http://127.0.0.1:${port}/ip`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } })
      expect(await response.json()).toEqual({ ip: '203.0.113.9' })
    } finally {
      server.close()
    }
  })
})

function captureLogs() {
  const lines: Record<string, unknown>[] = []
  const destination = { write: (line: string) => { lines.push(JSON.parse(line) as Record<string, unknown>) } }
  return { lines, logger: createLogger('debug', destination) }
}

describe('logging', () => {
  it('keeps the message and stack of logged errors', () => {
    const { lines, logger } = captureLogs()
    logger.error({ error: new Error('database went away') }, 'Worker failed')
    const logged = lines[0]?.error as { message?: string; stack?: string } | undefined
    expect(logged?.message).toBe('database went away')
    expect(logged?.stack).toContain('Error: database went away')
  })

  it('logs requests without headers, client IPs or query tokens', async () => {
    const { lines, logger } = captureLogs()
    const app = express()
    app.use(createRequestLogger(logger))
    app.get('/report', (_req, res) => {
      res.status(404).json({})
    })
    const server = createServer(app).listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    try {
      const { port } = server.address() as AddressInfo
      await fetch(`http://127.0.0.1:${port}/report?token=secret-token-value&page=2`, {
        headers: { cookie: 'cwi_admin_session=abc', 'x-cwi-report-token': 'header-token', 'x-forwarded-for': '6.6.6.6', 'x-request-id': '<bad id>' },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      server.close()
    }
    const text = JSON.stringify(lines)
    const request = lines.at(-1)?.req as { url?: string; id?: string } | undefined
    expect(request?.url).toBe('/report?token=[redacted]&page=2')
    expect(request?.id).not.toBe('<bad id>')
    for (const secret of ['secret-token-value', 'cwi_admin_session', 'header-token', '6.6.6.6']) expect(text).not.toContain(secret)
  })
})

describe('PDF Content-Disposition', () => {
  it('produces a valid header for Vietnamese file names, inline and as attachment', () => {
    const name = 'Báo cáo Chỉ số Năng lực Q3/2026.pdf'
    for (const value of [contentDispositionInline(name), contentDispositionAttachment(name)]) {
      expect(() => validateHeaderValue('Content-Disposition', value)).not.toThrow()
      expect(value).toContain("filename*=UTF-8''" + encodeURIComponent('Báo cáo Chỉ số Năng lực Q3_2026.pdf'))
    }
    expect(contentDispositionInline(name).startsWith('inline; ')).toBe(true)
  })
})

describe('PDF render policy', () => {
  it('puts the CSP right after <head> so it applies to everything in the report', () => {
    const html = withRenderCsp('<!doctype html><html lang="vi"><head><title>x</title></head><body>a</body></html>')
    expect(html.startsWith('<!doctype html><html lang="vi"><head><meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(html).toContain("script-src 'none'")
    expect(html).toContain("default-src 'none'")
  })

  it('still adds the policy when the report has no <head>', () => {
    expect(withRenderCsp('<html><body>a</body></html>')).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy"/)
    expect(withRenderCsp('<p>a</p>')).toMatch(/^<head><meta http-equiv="Content-Security-Policy"/)
  })
})

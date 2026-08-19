import { createHmac } from 'node:crypto'
import type { Request } from 'express'

export type RequestMeta = {
  clientIpHash: string | null
  idempotencyKey: string | null
  source: string
  userAgent: string | null
}

function limitText(value: string | undefined, maxLength: number) {
  if (!value) return null
  return value.slice(0, maxLength)
}

export function getIdempotencyKey(req: Request) {
  const raw = req.get('idempotency-key')
  return raw?.trim() || null
}

export function getRequestMeta(req: Request, ipHashSecret: string): RequestMeta {
  const ip = req.ip || req.socket.remoteAddress || ''
  const clientIpHash = ip ? createHmac('sha256', ipHashSecret).update(ip).digest('hex') : null

  return {
    clientIpHash,
    idempotencyKey: getIdempotencyKey(req),
    source: limitText(req.get('x-cwi-source') ?? undefined, 80) ?? 'source4',
    userAgent: limitText(req.get('user-agent') ?? undefined, 512),
  }
}

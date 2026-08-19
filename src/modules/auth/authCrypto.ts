import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url')
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
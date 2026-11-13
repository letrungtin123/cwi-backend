// TRUST_PROXY tells Express how many reverse proxies sit in front of the API. "true" means one: in
// production cwi-public forwards the request and nginx appends the real client address (taken from
// Cloudflare's CF-Connecting-IP) as the last X-Forwarded-For entry. Trusting exactly one hop makes
// Express use that last entry. Plain "trust everything" would take the FIRST entry, which the
// client can write itself, so anyone could fake their IP and dodge rate limits.
// Returns false, a hop count, or the raw value (rejected by the schema in env.ts).
export function normalizeTrustProxy(value: unknown): unknown {
  if (value === undefined || value === '' || value === false || value === 'false') return false
  if (value === true || value === 'true') return 1
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return value
}

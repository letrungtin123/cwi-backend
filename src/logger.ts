import pino, { type Logger } from 'pino'

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      censor: '[redacted]',
      paths: [
        'DATABASE_URL',
        'ADMIN_API_KEY',
        'IP_HASH_SECRET',
        'SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'req.headers["x-csrf-token"]',
        'req.body.password',
        'res.headers.set-cookie',
        'res.headers["set-cookie"]',
        'res.body',
      ],
    },
  })
}

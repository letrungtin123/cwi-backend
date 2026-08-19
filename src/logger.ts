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
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body',
        'res.body',
      ],
    },
  })
}

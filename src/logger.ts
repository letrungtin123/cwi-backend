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
        'RABBITMQ_URL',
        'MAIL_SMTP_PASSWORD',
        'MAIL_M365_CLIENT_SECRET',
        'req.headers["x-admin-key"]',
        'req.headers["x-api-key"]',
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-csrf-token',
        'req.headers["x-csrf-token"]',
        'req.body.password',
        'req.body.pass',
        'req.body.client_secret',
        'req.body.access_token',
        'req.body.refresh_token',
        'res.headers.set-cookie',
        'res.headers["set-cookie"]',
        'res.body',
      ],
    },
  })
}

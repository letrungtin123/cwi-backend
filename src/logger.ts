import pino, { type DestinationStream, type Logger } from 'pino'

// destination: only tests pass one, to read what would be logged; normally logs go to stdout.
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
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
        'req.headers["x-cwi-report-token"]',
        'req.headers["x-forwarded-for"]',
        'req.headers["x-real-ip"]',
        'req.headers["cf-connecting-ip"]',
        'req.remoteAddress',
        'req.remotePort',
      ],
    },
    // Errors are logged under both `err` and `error`; without a serializer an Error object prints
    // as {} and the message and stack are lost.
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  }
  return destination ? pino(options, destination) : pino(options)
}

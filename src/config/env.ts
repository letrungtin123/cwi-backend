import 'dotenv/config'
import { z } from 'zod'

const booleanSchema = z.preprocess((value) => {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  return value
}, z.boolean().optional())

const nullablePathSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}, z.string().optional())

const bucketNameSchema = z.string().trim().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)

const envSchema = z
  .object({
    ADMIN_CURSOR_SECRET: z.string().optional(),
    ADMIN_EXPORT_ENABLED: booleanSchema.default(false),
    RABBITMQ_URL: z.string().url().optional(),
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'none', 'strict']).default('lax'),
    AUTH_COOKIE_SECURE: booleanSchema.default(false),
    AUTH_CSRF_COOKIE_NAME: z.string().min(1).default('cwi_admin_csrf'),
    AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(500).default(10),
    AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(300000),
    AUTH_SESSION_COOKIE_NAME: z.string().min(1).default('cwi_admin_session'),
    AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(28800),
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    DATABASE_URL: z.string().optional(),
    DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DB_SSL: booleanSchema.default(false),
    EXPORT_WORKER_LOCK_MS: z.coerce.number().int().min(30000).max(1800000).default(300000),
    EXPORT_WORKER_LOOP_INTERVAL_MS: z.coerce.number().int().min(500).max(60000).default(2000),
    EXPORT_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    IP_HASH_SECRET: z.string().optional(),
    LOG_LEVEL: z.string().default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PDF_BROWSER_PATH: nullablePathSchema,
    PDF_DISABLE_SANDBOX: booleanSchema.default(false),
    PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().min(10000).max(600000).default(120000),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    REPORT_SERVICE_BASE_URL: z.string().url().default('http://127.0.0.1:8000'),
    REPORT_STORAGE_BUCKET: bucketNameSchema.default('cwi-report-assets'),
    REPORT_STORAGE_UPLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
    REPORT_PUBLIC_TOKEN_SECRET: z.string().trim().optional(),
    REPORT_PUBLIC_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(604800).default(86400),
    REPORT_SERVICE_ENABLED: booleanSchema.default(false),
    REPORT_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(10000),
    REPORT_AUTO_EMAIL_ENABLED: booleanSchema.default(false),
    REPORT_GENERATED_PDF_FILE_NAME: z.string().trim().min(1).max(180).default('Bao-cao-CEO-Workforce-Index.pdf'),
    REPORT_DELIVERY_ENABLED: booleanSchema.default(false),
    REPORT_DELIVERY_BUCKET: bucketNameSchema.default('cwi-submission-report-pdfs'),
    REPORT_DELIVERY_BATCH_SIZE: z.coerce.number().int().min(10).max(5000).default(500),
    REPORT_DELIVERY_LOCK_MS: z.coerce.number().int().min(30000).max(1800000).default(300000),
    REPORT_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    REPORT_DELIVERY_PREFETCH: z.coerce.number().int().min(1).max(50).default(2),
    REPORT_DELIVERY_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(1),
    REPORT_DELIVERY_REQUEUE_DELAY_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
    REPORT_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1048576).max(52428800).default(52428800),
    MAIL_AUTH_MODE: z.enum(['basic', 'microsoft365-oauth2']).default('basic'),
    MAIL_M365_CLIENT_ID: z.string().trim().optional(),
    MAIL_M365_CLIENT_SECRET: z.string().optional(),
    MAIL_M365_SCOPE: z.string().url().default('https://outlook.office365.com/.default'),
    MAIL_M365_TENANT_ID: z.string().trim().optional(),
    MAIL_M365_TOKEN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    MAIL_SMTP_HOST: z.string().trim().optional(),
    MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    MAIL_SMTP_REQUIRE_TLS: booleanSchema.default(true),
    MAIL_SMTP_SECURE: booleanSchema.default(false),
    MAIL_SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    MAIL_SMTP_GREETING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    MAIL_SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300000).default(120000),
    MAIL_SMTP_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(10).default(2),
    MAIL_SMTP_MAX_MESSAGES: z.coerce.number().int().min(1).max(1000).default(100),
    MAIL_SMTP_USER: z.string().trim().optional(),
    MAIL_SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM_NAME: z.string().trim().min(1).max(160).default('CEO Workforce Index'),
    MAIL_FROM_ADDRESS: z.string().trim().email().optional(),
    MAIL_REPLY_TO: z.string().trim().email().optional(),
    MAIL_SEND_RATE_PER_SECOND: z.coerce.number().int().min(1).max(100).default(2),
    REPORT_STORAGE_DIR: z.string().trim().min(1).default('./storage/reports'),
    REPORT_WORKER_INITIAL_POLL_DELAY_MS: z.coerce.number().int().min(1000).max(600000).default(10000),
    REPORT_WORKER_LOCK_MS: z.coerce.number().int().min(30000).max(1800000).default(300000),
    REPORT_WORKER_LOOP_INTERVAL_MS: z.coerce.number().int().min(500).max(60000).default(2000),
    REPORT_WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    REPORT_WORKER_MAX_POLL_DELAY_MS: z.coerce.number().int().min(5000).max(600000).default(60000),
    REQUEST_BODY_LIMIT: z.string().default('256kb'),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_AUTH_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    SUPABASE_STORAGE_URL: z.string().url().default('http://127.0.0.1:55321/storage/v1'),
    TRUST_PROXY: booleanSchema.default(false),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'test' && !value.DATABASE_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DATABASE_URL is required outside test', path: ['DATABASE_URL'] })
    }
    if (value.NODE_ENV === 'production') {
      if (!value.IP_HASH_SECRET || value.IP_HASH_SECRET.length < 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'IP_HASH_SECRET must be at least 32 characters in production', path: ['IP_HASH_SECRET'] })
      }
      if (!value.CORS_ALLOWED_ORIGINS?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'CORS_ALLOWED_ORIGINS is required in production', path: ['CORS_ALLOWED_ORIGINS'] })
      }
      if (!value.SUPABASE_AUTH_URL) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SUPABASE_AUTH_URL is required in production', path: ['SUPABASE_AUTH_URL'] })
      }
      if (!value.SUPABASE_ANON_KEY || value.SUPABASE_ANON_KEY.length < 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SUPABASE_ANON_KEY is required in production', path: ['SUPABASE_ANON_KEY'] })
      }
      if (!value.AUTH_COOKIE_SECURE) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_COOKIE_SECURE must be true in production', path: ['AUTH_COOKIE_SECURE'] })
      }
    }
    if (value.REPORT_DELIVERY_ENABLED) {
      if (!value.RABBITMQ_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RABBITMQ_URL is required when report delivery is enabled', path: ['RABBITMQ_URL'] })
      if (!value.MAIL_SMTP_HOST || !value.MAIL_SMTP_USER || !value.MAIL_FROM_ADDRESS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SMTP host, mailbox and from address are required when report delivery is enabled', path: ['MAIL_SMTP_HOST'] })
      }
      if (value.MAIL_AUTH_MODE === 'basic' && !value.MAIL_SMTP_PASSWORD) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MAIL_SMTP_PASSWORD is required when MAIL_AUTH_MODE is basic', path: ['MAIL_SMTP_PASSWORD'] })
      }
      if (value.MAIL_AUTH_MODE === 'microsoft365-oauth2' && (!value.MAIL_M365_TENANT_ID || !value.MAIL_M365_CLIENT_ID || !value.MAIL_M365_CLIENT_SECRET)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Microsoft 365 OAuth credentials are required when MAIL_AUTH_MODE is microsoft365-oauth2', path: ['MAIL_M365_TENANT_ID'] })
      }
      if (value.NODE_ENV === 'production' && value.MAIL_AUTH_MODE === 'basic' && !value.MAIL_SMTP_REQUIRE_TLS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Production SMTP basic authentication requires STARTTLS', path: ['MAIL_SMTP_REQUIRE_TLS'] })
      }
    }
    if (value.REPORT_SERVICE_ENABLED) {
      if (value.NODE_ENV === 'production' && (!value.REPORT_PUBLIC_TOKEN_SECRET || value.REPORT_PUBLIC_TOKEN_SECRET.length < 32)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'REPORT_PUBLIC_TOKEN_SECRET must be at least 32 characters in production when report generation is enabled', path: ['REPORT_PUBLIC_TOKEN_SECRET'] })
      }
      if (!value.SUPABASE_SERVICE_ROLE_KEY || value.SUPABASE_SERVICE_ROLE_KEY.length < 32) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SUPABASE_SERVICE_ROLE_KEY is required when REPORT_SERVICE_ENABLED is true', path: ['SUPABASE_SERVICE_ROLE_KEY'] })
      }
      if (value.NODE_ENV === 'production' && !process.env.SUPABASE_STORAGE_URL?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SUPABASE_STORAGE_URL must be set explicitly in production when report generation is enabled', path: ['SUPABASE_STORAGE_URL'] })
      }
    }
    if (value.REPORT_AUTO_EMAIL_ENABLED && (!value.REPORT_SERVICE_ENABLED || !value.REPORT_DELIVERY_ENABLED)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'REPORT_SERVICE_ENABLED and REPORT_DELIVERY_ENABLED are required when REPORT_AUTO_EMAIL_ENABLED is true', path: ['REPORT_AUTO_EMAIL_ENABLED'] })
    }
    if (value.AUTH_COOKIE_SAME_SITE === 'none' && !value.AUTH_COOKIE_SECURE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none', path: ['AUTH_COOKIE_SECURE'] })
    }
  })

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => issue.path.join('.') + ': ' + issue.message).join('; ')
  throw new Error('Invalid environment: ' + message)
}

function splitOrigins(value: string | undefined) {
  return (value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
}

export const env = {
  adminCursorSecret: parsed.data.ADMIN_CURSOR_SECRET ?? parsed.data.IP_HASH_SECRET ?? 'development-only-admin-cursor-secret',
  adminExportEnabled: parsed.data.ADMIN_EXPORT_ENABLED,
  rabbitmqUrl: parsed.data.RABBITMQ_URL ?? '',
  authCookieDomain: parsed.data.AUTH_COOKIE_DOMAIN ?? null,
  authCookieSameSite: parsed.data.AUTH_COOKIE_SAME_SITE,
  authCookieSecure: parsed.data.AUTH_COOKIE_SECURE,
  authCsrfCookieName: parsed.data.AUTH_CSRF_COOKIE_NAME,
  authLoginRateLimitMax: parsed.data.AUTH_LOGIN_RATE_LIMIT_MAX,
  authLoginRateLimitWindowMs: parsed.data.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
  authSessionCookieName: parsed.data.AUTH_SESSION_COOKIE_NAME,
  authSessionTtlSeconds: parsed.data.AUTH_SESSION_TTL_SECONDS,
  corsAllowedOrigins: splitOrigins(parsed.data.CORS_ALLOWED_ORIGINS),
  databaseUrl: parsed.data.DATABASE_URL ?? '',
  dbConnectionTimeoutMs: parsed.data.DB_CONNECTION_TIMEOUT_MS,
  dbIdleTimeoutMs: parsed.data.DB_IDLE_TIMEOUT_MS,
  dbPoolMax: parsed.data.DB_POOL_MAX,
  dbSsl: parsed.data.DB_SSL,
  exportWorkerLockMs: parsed.data.EXPORT_WORKER_LOCK_MS,
  exportWorkerLoopIntervalMs: parsed.data.EXPORT_WORKER_LOOP_INTERVAL_MS,
  exportWorkerMaxAttempts: parsed.data.EXPORT_WORKER_MAX_ATTEMPTS,
  host: parsed.data.HOST,
  ipHashSecret: parsed.data.IP_HASH_SECRET ?? 'development-only-ip-hash-secret',
  logLevel: parsed.data.LOG_LEVEL,
  nodeEnv: parsed.data.NODE_ENV,
  pdfBrowserPath: parsed.data.PDF_BROWSER_PATH ?? null,
  pdfDisableSandbox: parsed.data.PDF_DISABLE_SANDBOX,
  pdfRenderTimeoutMs: parsed.data.PDF_RENDER_TIMEOUT_MS,
  port: parsed.data.PORT,
  rateLimitMax: parsed.data.RATE_LIMIT_MAX,
  rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
  reportServiceBaseUrl: parsed.data.REPORT_SERVICE_BASE_URL,
  reportServiceEnabled: parsed.data.REPORT_SERVICE_ENABLED,
  reportServiceTimeoutMs: parsed.data.REPORT_SERVICE_TIMEOUT_MS,
  reportAutoEmailEnabled: parsed.data.REPORT_AUTO_EMAIL_ENABLED,
  reportGeneratedPdfFileName: parsed.data.REPORT_GENERATED_PDF_FILE_NAME,
  reportDeliveryEnabled: parsed.data.REPORT_DELIVERY_ENABLED,
  reportDeliveryBucket: parsed.data.REPORT_DELIVERY_BUCKET,
  reportDeliveryBatchSize: parsed.data.REPORT_DELIVERY_BATCH_SIZE,
  reportDeliveryLockMs: parsed.data.REPORT_DELIVERY_LOCK_MS,
  reportDeliveryMaxAttempts: parsed.data.REPORT_DELIVERY_MAX_ATTEMPTS,
  reportDeliveryPrefetch: parsed.data.REPORT_DELIVERY_PREFETCH,
  reportDeliveryConcurrency: parsed.data.REPORT_DELIVERY_CONCURRENCY,
  reportDeliveryRequeueDelayMs: parsed.data.REPORT_DELIVERY_REQUEUE_DELAY_MS,
  reportUploadMaxBytes: parsed.data.REPORT_UPLOAD_MAX_BYTES,
  mailAuthMode: parsed.data.MAIL_AUTH_MODE,
  mailM365ClientId: parsed.data.MAIL_M365_CLIENT_ID ?? '',
  mailM365ClientSecret: parsed.data.MAIL_M365_CLIENT_SECRET ?? '',
  mailM365Scope: parsed.data.MAIL_M365_SCOPE,
  mailM365TenantId: parsed.data.MAIL_M365_TENANT_ID ?? '',
  mailM365TokenTimeoutMs: parsed.data.MAIL_M365_TOKEN_TIMEOUT_MS,
  mailSmtpHost: parsed.data.MAIL_SMTP_HOST ?? '',
  mailSmtpPort: parsed.data.MAIL_SMTP_PORT,
  mailSmtpRequireTls: parsed.data.MAIL_SMTP_REQUIRE_TLS,
  mailSmtpSecure: parsed.data.MAIL_SMTP_SECURE,
  mailSmtpConnectionTimeoutMs: parsed.data.MAIL_SMTP_CONNECTION_TIMEOUT_MS,
  mailSmtpGreetingTimeoutMs: parsed.data.MAIL_SMTP_GREETING_TIMEOUT_MS,
  mailSmtpSocketTimeoutMs: parsed.data.MAIL_SMTP_SOCKET_TIMEOUT_MS,
  mailSmtpMaxConnections: parsed.data.MAIL_SMTP_MAX_CONNECTIONS,
  mailSmtpMaxMessages: parsed.data.MAIL_SMTP_MAX_MESSAGES,
  mailSmtpUser: parsed.data.MAIL_SMTP_USER ?? '',
  mailSmtpPassword: parsed.data.MAIL_SMTP_PASSWORD ?? '',
  mailFromName: parsed.data.MAIL_FROM_NAME,
  mailFromAddress: parsed.data.MAIL_FROM_ADDRESS ?? '',
  mailReplyTo: parsed.data.MAIL_REPLY_TO ?? '',
  mailSendRatePerSecond: parsed.data.MAIL_SEND_RATE_PER_SECOND,
  reportStorageBucket: parsed.data.REPORT_STORAGE_BUCKET,
  reportStorageDir: parsed.data.REPORT_STORAGE_DIR,
  reportStorageUploadTimeoutMs: parsed.data.REPORT_STORAGE_UPLOAD_TIMEOUT_MS,
  reportPublicTokenSecret: parsed.data.REPORT_PUBLIC_TOKEN_SECRET ?? parsed.data.IP_HASH_SECRET ?? 'development-only-report-token-secret',
  reportPublicTokenTtlSeconds: parsed.data.REPORT_PUBLIC_TOKEN_TTL_SECONDS,
  reportWorkerInitialPollDelayMs: parsed.data.REPORT_WORKER_INITIAL_POLL_DELAY_MS,
  reportWorkerLockMs: parsed.data.REPORT_WORKER_LOCK_MS,
  reportWorkerLoopIntervalMs: parsed.data.REPORT_WORKER_LOOP_INTERVAL_MS,
  reportWorkerMaxAttempts: parsed.data.REPORT_WORKER_MAX_ATTEMPTS,
  reportWorkerMaxPollDelayMs: parsed.data.REPORT_WORKER_MAX_POLL_DELAY_MS,
  requestBodyLimit: parsed.data.REQUEST_BODY_LIMIT,
  supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY ?? '',
  supabaseAuthUrl: parsed.data.SUPABASE_AUTH_URL ?? 'http://127.0.0.1:55321/auth/v1',
  supabaseServiceRoleKey: parsed.data.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseStorageUrl: parsed.data.SUPABASE_STORAGE_URL,
  trustProxy: parsed.data.TRUST_PROXY,
} as const

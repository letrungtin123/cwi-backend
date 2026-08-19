import 'dotenv/config'
import { z } from 'zod'

const booleanSchema = z.preprocess((value) => {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true'
  return value
}, z.boolean().optional())

const envSchema = z
  .object({
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
    IP_HASH_SECRET: z.string().optional(),
    LOG_LEVEL: z.string().default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(60),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
    REPORT_SERVICE_BASE_URL: z.string().url().default('http://127.0.0.1:8000'),
    REPORT_SERVICE_ENABLED: booleanSchema.default(false),
    REPORT_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    REQUEST_BODY_LIMIT: z.string().default('256kb'),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_AUTH_URL: z.string().url().optional(),
    TRUST_PROXY: booleanSchema.default(false),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'test' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DATABASE_URL is required outside test',
        path: ['DATABASE_URL'],
      })
    }

    if (value.NODE_ENV === 'production') {

      if (!value.IP_HASH_SECRET || value.IP_HASH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'IP_HASH_SECRET must be at least 32 characters in production',
          path: ['IP_HASH_SECRET'],
        })
      }

      if (!value.CORS_ALLOWED_ORIGINS?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ALLOWED_ORIGINS is required in production',
          path: ['CORS_ALLOWED_ORIGINS'],
        })
      }

      if (!value.SUPABASE_AUTH_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SUPABASE_AUTH_URL is required in production',
          path: ['SUPABASE_AUTH_URL'],
        })
      }

      if (!value.SUPABASE_ANON_KEY || value.SUPABASE_ANON_KEY.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SUPABASE_ANON_KEY is required in production',
          path: ['SUPABASE_ANON_KEY'],
        })
      }

      if (!value.AUTH_COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'AUTH_COOKIE_SECURE must be true in production',
          path: ['AUTH_COOKIE_SECURE'],
        })
      }
    }

    if (value.AUTH_COOKIE_SAME_SITE === 'none' && !value.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none',
        path: ['AUTH_COOKIE_SECURE'],
      })
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  throw new Error(`Invalid environment: ${message}`)
}

function splitOrigins(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export const env = {
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
  ipHashSecret: parsed.data.IP_HASH_SECRET ?? 'development-only-ip-hash-secret',
  logLevel: parsed.data.LOG_LEVEL,
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  rateLimitMax: parsed.data.RATE_LIMIT_MAX,
  rateLimitWindowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
  reportServiceBaseUrl: parsed.data.REPORT_SERVICE_BASE_URL,
  reportServiceEnabled: parsed.data.REPORT_SERVICE_ENABLED,
  reportServiceTimeoutMs: parsed.data.REPORT_SERVICE_TIMEOUT_MS,
  requestBodyLimit: parsed.data.REQUEST_BODY_LIMIT,
  supabaseAnonKey: parsed.data.SUPABASE_ANON_KEY ?? '',
  supabaseAuthUrl: parsed.data.SUPABASE_AUTH_URL ?? 'http://127.0.0.1:55321/auth/v1',
  trustProxy: parsed.data.TRUST_PROXY,
} as const
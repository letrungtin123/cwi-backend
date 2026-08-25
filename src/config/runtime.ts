export type AuthCookieSameSite = 'lax' | 'none' | 'strict'

export type AuthConfig = {
  cookieDomain: string | null
  cookieSameSite: AuthCookieSameSite
  cookieSecure: boolean
  csrfCookieName: string
  loginRateLimitMax: number
  loginRateLimitWindowMs: number
  sessionCookieName: string
  sessionTtlSeconds: number
  supabaseAnonKey: string
  supabaseAuthUrl: string
}

export type RuntimeConfig = {
  adminCursorSecret: string
  adminExportEnabled: boolean
  reportDeliveryEnabled: boolean
  reportDeliveryBucket: string
  reportUploadMaxBytes: number
  auth: AuthConfig
  corsAllowedOrigins: string[]
  ipHashSecret: string
  nodeEnv: 'development' | 'test' | 'production'
  rateLimitMax: number
  rateLimitWindowMs: number
  requestBodyLimit: string
  trustProxy: boolean
}



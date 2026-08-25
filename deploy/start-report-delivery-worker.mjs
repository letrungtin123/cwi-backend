const isProduction = process.env.NODE_ENV === 'production'

if (isProduction) {
  process.env.AUTH_COOKIE_SECURE = 'true'
  process.env.AUTH_COOKIE_SAME_SITE = 'lax'
  process.env.CORS_ALLOWED_ORIGINS =
    process.env.CWI_CORS_ALLOWED_ORIGINS || process.env.CWI_PUBLIC_ORIGIN || 'https://ceo-workforce-index.com'
}

await import('../dist/reportDeliveryWorker.js')

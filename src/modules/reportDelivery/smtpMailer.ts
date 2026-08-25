import nodemailer, { type Transporter } from 'nodemailer'
import { buildReportEmail } from './emailTemplate.js'
import { normalizeReportFileName } from './reportDeliveryFilename.js'

export type SmtpAuthMode = 'basic' | 'microsoft365-oauth2'

export type SmtpMailerConfig = {
  authMode: SmtpAuthMode
  connectionTimeoutMs: number
  fromAddress: string
  fromName: string
  host: string
  m365ClientId: string
  m365ClientSecret: string
  m365Scope: string
  m365TenantId: string
  greetingTimeoutMs: number
  maxConnections: number
  maxMessages: number
  password: string
  port: number
  replyTo: string
  requireTls: boolean
  secure: boolean
  tokenTimeoutMs: number
  user: string
  socketTimeoutMs: number
}

export function buildReportPdfAttachment(input: { originalFileName: string; pdfPath: string }) {
  return {
    contentDisposition: 'attachment' as const,
    contentType: 'application/pdf',
    filename: normalizeReportFileName(input.originalFileName),
    path: input.pdfPath,
  }
}

type OAuthTokenResponse = {
  access_token?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

type CachedToken = {
  accessToken: string
  expiresAt: number
}

export class Microsoft365OAuthTokenProvider {
  private cachedToken: CachedToken | null = null

  constructor(
    private readonly config: {
      clientId: string
      clientSecret: string
      scope: string
      tenantId: string
      timeoutMs: number
    },
  ) {}

  async getAccessToken() {
    const cached = this.cachedToken
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.accessToken

    const response = await fetch(
      'https://login.microsoftonline.com/' + encodeURIComponent(this.config.tenantId) + '/oauth2/v2.0/token',
      {
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: 'client_credentials',
          scope: this.config.scope,
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      },
    )
    const payload = await response.json().catch(() => null) as OAuthTokenResponse | null
    if (!response.ok || typeof payload?.access_token !== 'string' || !payload.access_token) {
      throw new Error('Microsoft 365 OAuth token request failed with status ' + response.status + '.')
    }

    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in)
    const safeExpiresIn = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300
    this.cachedToken = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(60, safeExpiresIn - 60) * 1000,
    }
    return payload.access_token
  }
}

export type SmtpDeliveryOutcome = 'not_sent' | 'unknown'

export class SmtpDeliveryError extends Error {
  constructor(readonly outcome: SmtpDeliveryOutcome, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SmtpDeliveryError'
  }
}

function classifySmtpError(error: unknown) {
  if (error instanceof SmtpDeliveryError) return error
  const value = error as { code?: unknown; command?: unknown; responseCode?: unknown } | null
  const code = typeof value?.code === 'string' ? value.code : ''
  const command = typeof value?.command === 'string' ? value.command.toUpperCase() : ''
  const responseCode = typeof value?.responseCode === 'number' ? value.responseCode : Number(value?.responseCode)
  const serverRejectedBeforeData = Number.isFinite(responseCode) && responseCode >= 400 && responseCode < 600 && !['DATA', 'END'].includes(command)
  if (serverRejectedBeforeData || ['EAUTH', 'ECONNECTION', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code)) {
    return new SmtpDeliveryError('not_sent', 'SMTP từ chối kết nối hoặc thư trước khi nhận nội dung.', { cause: error })
  }
  return new SmtpDeliveryError('unknown', 'Không xác định được SMTP đã nhận thư hay chưa.', { cause: error })
}

export class SmtpReportMailer {
  private readonly oauthTokenProvider: Microsoft365OAuthTokenProvider | null
  private transporter: Transporter | null = null
  private transporterPromise: Promise<Transporter> | null = null

  constructor(private readonly config: SmtpMailerConfig) {
    this.oauthTokenProvider = config.authMode === 'microsoft365-oauth2'
      ? new Microsoft365OAuthTokenProvider({
        clientId: config.m365ClientId,
        clientSecret: config.m365ClientSecret,
        scope: config.m365Scope,
        tenantId: config.m365TenantId,
        timeoutMs: config.tokenTimeoutMs,
      })
      : null
  }

  private async createTransport(): Promise<Transporter> {
    const auth = this.config.authMode === 'microsoft365-oauth2'
      ? {
        accessToken: await this.oauthTokenProvider?.getAccessToken() ?? '',
        type: 'OAuth2' as const,
        user: this.config.user,
      }
      : {
        pass: this.config.password,
        user: this.config.user,
      }

    return nodemailer.createTransport({
      auth,
      host: this.config.host,
      pool: true,
      port: this.config.port,
      maxConnections: this.config.maxConnections,
      maxMessages: this.config.maxMessages,
      connectionTimeout: this.config.connectionTimeoutMs,
      greetingTimeout: this.config.greetingTimeoutMs,
      socketTimeout: this.config.socketTimeoutMs,
      requireTLS: this.config.requireTls,
      secure: this.config.secure,
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
    })
  }

  private async getTransport() {
    if (this.transporter) return this.transporter
    if (!this.transporterPromise) {
      this.transporterPromise = this.createTransport()
        .then((transporter) => {
          this.transporter = transporter
          return transporter
        })
        .catch((error) => {
          this.transporterPromise = null
          throw error
        })
    }
    return this.transporterPromise
  }

  async verify() {
    await (await this.getTransport()).verify()
  }

  async send(input: { messageId: string; originalFileName: string; pdfPath: string; recipientEmail: string; recipientName: string }) {
    const transporter = await this.getTransport()
    try {
      const { html, text } = buildReportEmail()
      const info = await transporter.sendMail({
        attachments: [buildReportPdfAttachment({ originalFileName: input.originalFileName, pdfPath: input.pdfPath })],
        from: { address: this.config.fromAddress, name: this.config.fromName },
        html,
        messageId: input.messageId,
        replyTo: this.config.replyTo || undefined,
        subject: 'Báo cáo kết quả khảo sát CEO Workforce Index',
        text,
        to: input.recipientEmail,
      })
      return info.messageId
    } catch (error) {
      const smtpError = error as { code?: unknown } | null
      if (this.config.authMode === 'microsoft365-oauth2' && smtpError?.code === 'EAUTH') this.close()
      throw classifySmtpError(error)
    }
  }

  close() {
    this.transporter?.close()
    this.transporter = null
    this.transporterPromise = null
  }
}

import nodemailer, { type Transporter } from 'nodemailer'
import { buildReportEmail, reportEmailLogoCid, reportEmailLogoPath } from './emailTemplate.js'
import { normalizeReportFileName } from './reportDeliveryFilename.js'

export type SmtpAuthMode = 'basic' | 'microsoft365-oauth2'

export type SmtpMailerConfig = {
  authMode: SmtpAuthMode
  fromAddress: string
  fromName: string
  host: string
  m365ClientId: string
  m365ClientSecret: string
  m365Scope: string
  m365TenantId: string
  password: string
  port: number
  replyTo: string
  requireTls: boolean
  secure: boolean
  tokenTimeoutMs: number
  user: string
}

export function buildReportPdfAttachment(input: { originalFileName: string; pdfPath: string }) {
  return {
    contentDisposition: 'attachment' as const,
    contentType: 'application/pdf',
    filename: normalizeReportFileName(input.originalFileName),
    path: input.pdfPath,
  }
}

export function buildReportLogoAttachment() {
  return {
    cid: reportEmailLogoCid,
    contentDisposition: 'inline' as const,
    contentType: 'image/svg+xml',
    filename: 'cwi-logo.svg',
    path: reportEmailLogoPath,
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

export class SmtpReportMailer {
  private readonly oauthTokenProvider: Microsoft365OAuthTokenProvider | null

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
      port: this.config.port,
      requireTLS: this.config.requireTls,
      secure: this.config.secure,
      tls: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
    })
  }

  async verify() {
    const transporter = await this.createTransport()
    try {
      await transporter.verify()
    } finally {
      transporter.close()
    }
  }

  async send(input: { messageId: string; originalFileName: string; pdfPath: string; recipientEmail: string; recipientName: string }) {
    const transporter = await this.createTransport()
    try {
      const { html, text } = buildReportEmail()
      const info = await transporter.sendMail({
        attachments: [
          buildReportPdfAttachment({ originalFileName: input.originalFileName, pdfPath: input.pdfPath }),
          buildReportLogoAttachment(),
        ],
        from: { address: this.config.fromAddress, name: this.config.fromName },
        html,
        messageId: input.messageId,
        replyTo: this.config.replyTo || undefined,
        subject: 'Báo cáo kết quả khảo sát CEO Workforce Index',
        text,
        to: input.recipientEmail,
      })
      return info.messageId
    } finally {
      transporter.close()
    }
  }
}

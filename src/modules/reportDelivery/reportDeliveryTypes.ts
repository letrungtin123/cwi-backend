export type DeliveryEmailStatus = 'not_sent' | 'queued' | 'sending' | 'sent' | 'failed'

export type ReportDeliveryFile = {
  available: boolean
  fileName: string | null
  fileSize: number | null
  uploadedAt: string | null
  lockedAt: string | null
  downloadUrl: string | null
}

export type ReportDeliveryStatus = {
  emailStatus: DeliveryEmailStatus | 'not_ready'
  emailSentAt: string | null
  emailLastError: string | null
  file: ReportDeliveryFile
  submissionId: string
}

export type ReportDeliveryCampaign = {
  completedAt: string | null
  createdAt: string
  eligibleUsers: number
  errorCode: string | null
  errorMessage: string | null
  failedCount: number
  id: string
  missingPdfUsers: number
  queuedCount: number
  sentCount: number
  snapshotAt: string
  startedAt: string | null
  status: 'draft' | 'queued' | 'dispatching' | 'sending' | 'completed' | 'failed' | 'expired'
  totalUsers: number
  expiresAt: string
}

export type ClaimedEmailJob = {
  attemptCount: number
  campaignId: string
  fileSha256: string
  id: string
  originalFileName: string
  recipientEmail: string
  recipientName: string
  storageBucket: string
  storagePath: string
  submissionId: string
}

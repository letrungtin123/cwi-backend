export const SUBMISSION_STATUSES = [
  'part1_only',
  'part2_refused_privacy',
  'full_private_report',
] as const

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]

export const PRIVACY_CONSENTS = ['yes', 'no', 'not_applicable'] as const

export type PrivacyConsent = (typeof PRIVACY_CONSENTS)[number]

export type SubmissionStatusRule = {
  defaultNote: string
  expectedPrivacyConsent: PrivacyConsent
  requiredPart: 'part1' | 'all'
}

export const SUBMISSION_STATUS_RULES: Record<SubmissionStatus, SubmissionStatusRule> = {
  part1_only: {
    defaultNote: 'Hoàn thành Phần 1 và gửi kết quả Phần 1.',
    expectedPrivacyConsent: 'not_applicable',
    requiredPart: 'part1',
  },
  part2_refused_privacy: {
    defaultNote:
      'Hoàn thành Phần 1 + Phần 2, chọn "Không đồng ý" bảo mật dữ liệu và nhận báo cáo Phần 1.',
    expectedPrivacyConsent: 'no',
    requiredPart: 'all',
  },
  full_private_report: {
    defaultNote:
      'Hoàn thành Phần 1 + Phần 2, chọn "Đồng ý" bảo mật dữ liệu và gửi kết quả cả 2 phần.',
    expectedPrivacyConsent: 'yes',
    requiredPart: 'all',
  },
}

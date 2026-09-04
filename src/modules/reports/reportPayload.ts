import type { NormalizedAnswer, NormalizedSurveySubmission } from '../survey/submissionValidation.js'
import { OTHER_OPTION } from '../survey/surveyQuestions.js'

export type AiReportType = 'anonymous' | 'personalized'

export type AiReportAnswer = {
  answer: number | string
  idx: number
  other_text?: string
  question: string
}

export type AiReportPayload = {
  answers: AiReportAnswer[]
  cohort_consent: boolean
  delivery_contact: {
    email: string
    full_name: string
  }
  participant: {
    position: string
  }
}

export type ReportJobCreateInput = {
  providerEndpoint: string
  reportType: AiReportType
  requestPayload: AiReportPayload
}

const aiQuestionTextByIdx = new Map<number, string>([
  [1, 'Doanh nghiệp của chúng tôi có đủ năng lực nhân sự để đạt mục tiêu tăng trưởng mong muốn trong 2–3 năm tới.'],
  [2, 'Đội ngũ quản lý của chúng tôi chuyển hóa chiến lược thành kết quả một cách hiệu quả.'],
  [3, 'Tôi tin tưởng vào năng lực của đội ngũ quản lý.'],
  [4, 'Đội ngũ quản lý hiện tại đủ sức hỗ trợ kế hoạch tăng trưởng mà CEO mong đợi.'],
  [5, 'Chúng tôi giữ chân được nhân tài quan trọng.'],
  // CWI AI V3 validates the transport question against its own fixed registry.
  // The local survey keeps its current UI wording independently.
  [6, 'Tôi tin Hệ năng lực (bao gồm con người, AI, công nghệ, dữ liệu, đối tác) hiện tại sẽ tạo lợi thế cạnh tranh trong 3 năm tới.'],
  [7, 'Đội ngũ quản lý của chúng tôi có thể chuyển các ưu tiên chiến lược thành hành động nhất quán trong đơn vị mình phụ trách.'],
  [8, 'Các quản lý có đủ quyền và năng lực để tự ra quyết định trong phạm vi trách nhiệm mà không phải phụ thuộc quá nhiều vào cấp trên.'],
  [9, 'Các quản lý chủ động phát triển đội ngũ kế cận thay vì chỉ tập trung hoàn thành mục tiêu ngắn hạn.'],
  [10, 'Nếu một quản lý chủ chốt rời khỏi doanh nghiệp trong hôm nay, chúng tôi có người đủ năng lực để thay thế trong thời gian hợp lý.'],
  [11, 'Chúng tôi có khả năng xác định sớm những nhân sự có tiềm năng trở thành lãnh đạo trong tương lai.'],
  [12, 'Các chương trình phát triển lãnh đạo đã tạo ra sự cải thiện rõ rệt trong chất lượng quản lý và kết quả kinh doanh.'],
  [13, 'Đội ngũ quản lý của chúng tôi thích nghi nhanh với những thay đổi về công nghệ, dữ liệu và cách thức làm việc mới.'],
  [14, 'CEO và Giám đốc nhân sự có cùng quan điểm về chất lượng đội ngũ quản lý và các ưu tiên phát triển trong 12 tháng tới.'],
  [15, 'Khi doanh nghiệp mở rộng quy mô hoặc triển khai chiến lược mới, đội ngũ quản lý hiện tại đủ năng lực để dẫn dắt sự thay đổi.'],
  [16, 'Những quản lý giỏi nhất trong doanh nghiệp đang giúp nhân rộng năng lực cho tổ chức, thay vì chỉ tạo ra kết quả trong phạm vi đội ngũ của mình.'],
  [17, 'Trong 12 tháng tới, rủi ro lớn nhất đối với tăng trưởng của doanh nghiệp liên quan đến đội ngũ quản lý là gì?'],
  [18, 'Nếu chỉ được đầu tư vào một ưu tiên duy nhất trong năm tới, anh/chị sẽ chọn điều gì?'],
  [19, 'Khi doanh nghiệp cần đưa ra một quyết định quan trọng trong vòng 48 giờ, điều nào mô tả đúng nhất?'],
  [20, 'Nếu ngày mai doanh nghiệp mở thêm một chi nhánh, nhà máy hoặc đơn vị kinh doanh mới, điều gì sẽ là thách thức lớn nhất trong 90 ngày đầu?'],
  [21, 'Nếu anh/chị vắng mặt trong ba tháng, điều gì khiến anh/chị lo ngại nhất?'],
  [22, 'Hiện nay, điều gì đang giới hạn khả năng tăng trưởng của doanh nghiệp nhiều nhất?'],
  [23, 'Quy mô doanh thu của công ty hiện nay'],
  [24, 'Website công ty'],
])

const aiOtherTextIdxs = new Set([17, 18, 19, 20, 21, 22])

const aiAnswerLabelByIdx = new Map<number, Map<string, string>>([
  [17, new Map([['CEO và Nhân sự chưa thống nhất', 'CEO và HR chưa thống nhất']])],
  [23, new Map([
    // V3 validates revenue answers against its registered labels. Keep the
    // local survey labels unchanged and translate only at the AI boundary.
    ['Dưới 100 tỷ VND', 'Dưới 100 tỷ VND'],
    ['Từ 100 - <300 tỷ VND', 'Từ 100 - <300 tỷ VND'],
    ['Từ 300 - <1,000 tỷ VND', 'Từ 300 - <1,000 tỷ VND'],
    ['Từ 1,000 - <5,000 tỷ VND', 'Từ 1,000 - <5,000 tỷ VND'],
    ['Từ 5,000 - <10,000 tỷ VND', 'Từ 5,000 - <10,000 tỷ VND'],
    ['Trên 10,000 tỷ VND', 'Trên 10,000 tỷ VND'],
  ])],
])

function aiQuestionText(idx: number) {
  return aiQuestionTextByIdx.get(idx) ?? ''
}

function aiAnswerValue(answer: NormalizedAnswer) {
  if (answer.otherText) {
    if (aiOtherTextIdxs.has(answer.idx)) {
      return { answer: 'Khác', other_text: answer.otherText }
    }

    return { answer: answer.otherText }
  }

  if (typeof answer.answerForReport !== 'string') {
    return { answer: answer.answerForReport }
  }

  if (answer.answerForReport === OTHER_OPTION) {
    return { answer: 'Khác' }
  }

  return {
    answer: aiAnswerLabelByIdx.get(answer.idx)?.get(answer.answerForReport) ?? answer.answerForReport,
  }
}

function toAiAnswer(answer: NormalizedAnswer): AiReportAnswer {
  return {
    idx: answer.idx,
    question: aiQuestionText(answer.idx),
    ...aiAnswerValue(answer),
  }
}

function buildBasePayload(submission: NormalizedSurveySubmission): Omit<AiReportPayload, 'answers'> {
  return {
    cohort_consent: submission.privacyConsent === 'yes',
    delivery_contact: {
      email: submission.participant.email,
      full_name: submission.participant.fullName,
    },
    participant: {
      position: submission.participant.position,
    },
  }
}

export function buildReportJobRequest(submission: NormalizedSurveySubmission): ReportJobCreateInput {
  const reportType: AiReportType = submission.submissionStatus === 'full_private_report' ? 'personalized' : 'anonymous'
  const endpoint = reportType === 'personalized' ? '/v3/reports/personalized' : '/v3/reports/anonymous'
  const maxQuestionIdx = reportType === 'personalized' ? 24 : 18
  const requestPayload: AiReportPayload = {
    ...buildBasePayload(submission),
    answers: submission.answers.filter((answer) => answer.idx <= maxQuestionIdx).map(toAiAnswer),
  }

  return {
    providerEndpoint: endpoint,
    reportType,
    requestPayload,
  }
}

// Keep the existing module contract available for callers that only need the
// anonymous V3 payload. Report generation itself uses the richer request
// object above so endpoint selection remains explicit.
export function buildAnonymousReportPayload(submission: NormalizedSurveySubmission): AiReportPayload {
  return buildReportJobRequest(submission).requestPayload
}

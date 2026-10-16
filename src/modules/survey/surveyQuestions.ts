// Question set of the current survey edition. Every stored submission records
// SURVEY_VERSION so answers from earlier editions (2026Q3) stay distinguishable.
// Question and option text must match the CWI AI V3 registry character for
// character because the report service validates the transport payload.
export const SURVEY_VERSION = '2026Q4'

export const OTHER_OPTION = 'Khác.'

export type SurveyQuestionType = 'likert' | 'mcq' | 'text'

export type SurveyQuestion = {
  idx: number
  instruction?: string
  options?: readonly string[]
  part: 1 | 2
  question: string
  type: SurveyQuestionType
}

export const SURVEY_QUESTIONS = [
  {
    idx: 1,
    part: 1,
    type: 'likert',
    question: 'Chúng tôi có đủ năng lực để thích ứng nhanh trước thay đổi của thị trường.',
  },
  {
    idx: 2,
    part: 1,
    type: 'likert',
    question: 'AI và công nghệ đang giúp cải thiện hiệu quả quản trị.',
  },
  {
    idx: 3,
    part: 1,
    type: 'likert',
    question: 'Người quản lý có đủ dữ liệu để ra quyết định kịp thời.',
  },
  {
    idx: 4,
    part: 1,
    type: 'likert',
    question: 'Các phòng ban phối hợp hiệu quả để đạt mục tiêu chung.',
  },
  {
    idx: 5,
    part: 1,
    type: 'likert',
    question: 'Chúng tôi có thể mở rộng quy mô mà không phụ thuộc quá nhiều vào một vài cá nhân chủ chốt.',
  },
  {
    idx: 6,
    part: 1,
    type: 'likert',
    question: 'Văn hóa doanh nghiệp hỗ trợ hiệu suất cao.',
  },
  {
    idx: 7,
    part: 1,
    type: 'likert',
    question:
      'Ban điều hành của chúng tôi có tầm nhìn rõ ràng và hiểu sâu sắc về cách AI sẽ thay đổi mô hình kinh doanh của doanh nghiệp.',
  },
  {
    idx: 8,
    part: 1,
    type: 'likert',
    question:
      'Chúng tôi đã thiết lập các chính sách và nguyên tắc quản trị (governance) rõ ràng để bảo đảm việc sử dụng dữ liệu và AI an toàn, đạo đức.',
  },
  {
    idx: 9,
    part: 1,
    type: 'likert',
    question:
      'Đội ngũ quản lý và nhân viên của chúng tôi đang chủ động ứng dụng công nghệ/AI để nâng cao hiệu suất làm việc hàng ngày.',
  },
  {
    idx: 10,
    part: 1,
    type: 'likert',
    question:
      'Chúng tôi nhận diện rõ những kỹ năng nào sắp lỗi thời và đang chủ động đào tạo lại (reskill/upskill) cho lực lượng lao động.',
  },
  {
    idx: 11,
    part: 1,
    type: 'likert',
    question:
      'Đội ngũ của chúng tôi có tư duy cởi mở, không e ngại sự thay đổi và học hỏi rất nhanh các phương thức làm việc mới.',
  },
  {
    idx: 12,
    part: 1,
    type: 'likert',
    question:
      'Cơ cấu tổ chức của chúng tôi tinh gọn, ít tầng nấc quan liêu, cho phép ra quyết định và hành động nhanh chóng.',
  },
  {
    idx: 13,
    part: 1,
    type: 'likert',
    question:
      'Các phòng ban trong công ty có khả năng phá vỡ ranh giới (silo) để phối hợp chéo một cách linh hoạt khi có dự án hoặc chiến lược mới.',
  },
  {
    idx: 14,
    part: 1,
    type: 'likert',
    question:
      'Chu kỳ lập kế hoạch chiến lược và phân bổ nguồn lực của chúng tôi đủ nhanh để bắt kịp những biến động bất ngờ của thị trường.',
  },
  {
    idx: 15,
    part: 1,
    type: 'likert',
    question:
      'Chúng tôi đang ưu tiên đầu tư xây dựng các năng lực mới cho tương lai (emerging skills) thay vì chỉ tuyển dụng để lấp đầy các vị trí hiện tại.',
  },
  {
    idx: 16,
    part: 1,
    type: 'likert',
    question:
      'AI và công nghệ đang mở ra cơ hội đột phá về mô hình vận hành cho doanh nghiệp, chứ không chỉ dừng lại ở việc cắt giảm chi phí.',
  },
  {
    idx: 17,
    options: [
      'Ban điều hành thiếu tầm nhìn và tư duy về AI.',
      'Đội ngũ thiếu kỹ năng và e ngại sự thay đổi.',
      'Cơ cấu tổ chức cồng kềnh, phản ứng chậm.',
      'Nguồn lực hạn chế để đầu tư chuyển đổi.',
      'Thiếu hụt các nhân tài có kỹ năng mới (Strategic Skills).',
      OTHER_OPTION,
    ],
    part: 1,
    question:
      'Trong 12 tháng tới, rủi ro lớn nhất cản trở doanh nghiệp của anh/chị trở nên sẵn sàng cho tương lai (Future-Ready) là gì?',
    type: 'mcq',
  },
  {
    idx: 18,
    options: [
      'Đào tạo kỹ năng AI và năng lực số cho toàn hệ thống.',
      'Tái cấu trúc tổ chức để tăng tốc độ và sự linh hoạt.',
      'Đưa AI vào quá trình ra quyết định của Ban điều hành.',
      'Xây dựng văn hóa đổi mới sáng tạo và thử nghiệm.',
      'Xây dựng hệ thống quản trị dữ liệu (Data Governance).',
      OTHER_OPTION,
    ],
    part: 1,
    question:
      'Nếu chỉ được đầu tư vào một ưu tiên duy nhất để xây dựng lực lượng lao động tương lai, anh/chị sẽ chọn điều gì?',
    type: 'mcq',
  },
  {
    idx: 19,
    options: [
      'Chờ chỉ đạo từ Ban điều hành rồi mới lập kế hoạch ứng phó.',
      'Mất nhiều tháng để điều chỉnh quy trình và phân bổ lại nguồn lực.',
      'Các phòng ban phối hợp chậm chạp, có xu hướng đùn đẩy trách nhiệm.',
      'Nhanh chóng lập các nhóm phản ứng nhanh (cross-functional) để xử lý.',
      'Tổ chức tự điều chỉnh rất linh hoạt mà không cần chỉ đạo gắt gao.',
    ],
    part: 2,
    question:
      'Khi thị trường biến động mạnh hoặc xuất hiện công nghệ đột phá, phản ứng của tổ chức anh/chị thường diễn ra như thế nào?',
    type: 'mcq',
  },
  {
    idx: 20,
    options: [
      'Chúng tôi vẫn đang quan sát, chưa có ưu tiên đầu tư rõ ràng.',
      'Ứng dụng nhỏ lẻ ở một vài phòng ban (như Marketing, IT) theo nhu cầu tự phát.',
      'Chủ yếu ứng dụng để cắt giảm chi phí và thay thế các tác vụ thủ công.',
      'Triển khai có hệ thống để nâng cao năng suất và ra quyết định.',
      'AI là trọng tâm chiến lược để chuyển đổi hoàn toàn mô hình kinh doanh.',
    ],
    part: 2,
    question:
      'Đối với việc ứng dụng AI và tự động hóa, chiến lược hiện tại của doanh nghiệp anh/chị nghiêng về hướng nào nhất?',
    type: 'mcq',
  },
  {
    idx: 21,
    options: [
      'Nhân viên hiện tại thiếu kỹ năng số/AI và e ngại sự thay đổi.',
      'Rất khó tuyển dụng được nhân tài có các kỹ năng công nghệ mới.',
      'Cấu trúc tổ chức hiện tại quá cứng nhắc để tích hợp công nghệ mới.',
      'Chúng tôi không có dữ liệu để đánh giá năng lực thực sự của đội ngũ.',
      'Tôi không lo ngại vì đã có lộ trình nâng cấp năng lực rõ ràng.',
    ],
    part: 2,
    question:
      'Khi nghĩ về nguồn nhân lực cho 3 năm tới (đặc biệt trước làn sóng AI), rào cản nào khiến anh/chị lo ngại nhất?',
    type: 'mcq',
  },
  {
    idx: 22,
    options: [
      'Chủ yếu dựa vào kinh nghiệm và trực giác của người quản lý.',
      'Dữ liệu bị phân mảnh, phòng ban nào dùng số liệu của phòng ban đó.',
      'Có hệ thống báo cáo nhưng thường chậm trễ, chỉ phản ánh dữ liệu quá khứ.',
      'Hệ thống dữ liệu cập nhật theo thời gian thực (real-time) để hỗ trợ quyết định.',
      'Đang ứng dụng AI và phân tích dự báo (predictive) để chủ động định hướng.',
    ],
    part: 2,
    question: 'Hiện tại, các quyết định điều hành của doanh nghiệp dựa nhiều nhất vào yếu tố nào?',
    type: 'mcq',
  },
  {
    idx: 23,
    options: [
      'Dưới 100 tỉ VND',
      'Từ 100 - <300 tỉ VND',
      'Từ 300 - <1000 tỉ VND',
      'Từ 1000 - <5000 tỉ VND',
      'Từ 5000 - <10000 tỉ VND',
      'Từ 10000 tỉ VND trở lên',
    ],
    part: 2,
    question: 'Quy mô doanh thu của công ty hiện nay:',
    type: 'mcq',
  },
  {
    idx: 24,
    part: 2,
    question: 'Website chính thức của công ty',
    type: 'text',
  },
] as const satisfies readonly SurveyQuestion[]

export const PART_ONE_QUESTION_IDXS = SURVEY_QUESTIONS.filter((question) => question.part === 1).map(
  (question) => question.idx,
)

export const ALL_QUESTION_IDXS = SURVEY_QUESTIONS.map((question) => question.idx)

export const SURVEY_QUESTION_BY_IDX: ReadonlyMap<number, SurveyQuestion> = new Map(
  SURVEY_QUESTIONS.map((question) => [question.idx, question]),
)

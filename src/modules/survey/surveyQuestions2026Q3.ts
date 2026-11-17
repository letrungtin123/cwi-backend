import type { SurveyQuestion } from './surveyQuestions.js'

// Question set of the 2026Q3 edition ("Năng lực lãnh đạo cho tăng trưởng"), as the
// survey showed it when that quarter ran (Aug–Oct 2026). Stored submissions keep this
// text, so answers taken now read the same as the 149 earlier ones.
//
// cwi-ai's 2026Q3 registry differs in two places, translated by AI_TEXT_2026Q3:
// question 6 (the survey kept its later "Hệ cộng lực" wording) and the "other" option
// ("Mục khác:" here, "Khác" + other_text for cwi-ai).
export const OTHER_OPTION_2026Q3 = 'Mục khác:'
export const AI_OTHER_OPTION_2026Q3 = 'Khác'

export const AI_QUESTION_TEXT_2026Q3: ReadonlyMap<number, string> = new Map([
  [6, 'Tôi tin Hệ năng lực (bao gồm con người, AI, công nghệ, dữ liệu, đối tác) hiện tại sẽ tạo lợi thế cạnh tranh trong 3 năm tới.'],
])

export const SURVEY_QUESTIONS_2026Q3 = [
  { idx: 1, part: 1, type: 'likert', question: 'Doanh nghiệp của chúng tôi có đủ năng lực nhân sự để đạt mục tiêu tăng trưởng mong muốn trong 2–3 năm tới.' },
  { idx: 2, part: 1, type: 'likert', question: 'Đội ngũ quản lý của chúng tôi chuyển hóa chiến lược thành kết quả một cách hiệu quả.' },
  { idx: 3, part: 1, type: 'likert', question: 'Tôi tin tưởng vào năng lực của đội ngũ quản lý.' },
  { idx: 4, part: 1, type: 'likert', question: 'Đội ngũ quản lý hiện tại đủ sức hỗ trợ kế hoạch tăng trưởng mà CEO mong đợi.' },
  { idx: 5, part: 1, type: 'likert', question: 'Chúng tôi giữ chân được nhân tài quan trọng.' },
  {
    idx: 6,
    part: 1,
    type: 'likert',
    question: 'Tôi tin Hệ cộng lực (bao gồm con người, AI, tự động hóa, hệ sinh thái) hiện tại sẽ tạo lợi thế cạnh tranh trong 3 năm tới.',
  },
  {
    idx: 7,
    part: 1,
    type: 'likert',
    question: 'Đội ngũ quản lý của chúng tôi có thể chuyển các ưu tiên chiến lược thành hành động nhất quán trong đơn vị mình phụ trách.',
  },
  {
    idx: 8,
    part: 1,
    type: 'likert',
    question: 'Các quản lý có đủ quyền và năng lực để tự ra quyết định trong phạm vi trách nhiệm mà không phải phụ thuộc quá nhiều vào cấp trên.',
  },
  { idx: 9, part: 1, type: 'likert', question: 'Các quản lý chủ động phát triển đội ngũ kế cận thay vì chỉ tập trung hoàn thành mục tiêu ngắn hạn.' },
  {
    idx: 10,
    part: 1,
    type: 'likert',
    question: 'Nếu một quản lý chủ chốt rời khỏi doanh nghiệp trong hôm nay, chúng tôi có người đủ năng lực để thay thế trong thời gian hợp lý.',
  },
  { idx: 11, part: 1, type: 'likert', question: 'Chúng tôi có khả năng xác định sớm những nhân sự có tiềm năng trở thành lãnh đạo trong tương lai.' },
  {
    idx: 12,
    part: 1,
    type: 'likert',
    question: 'Các chương trình phát triển lãnh đạo đã tạo ra sự cải thiện rõ rệt trong chất lượng quản lý và kết quả kinh doanh.',
  },
  {
    idx: 13,
    part: 1,
    type: 'likert',
    question: 'Đội ngũ quản lý của chúng tôi thích nghi nhanh với những thay đổi về công nghệ, dữ liệu và cách thức làm việc mới.',
  },
  {
    idx: 14,
    part: 1,
    type: 'likert',
    question: 'CEO và Giám đốc nhân sự có cùng quan điểm về chất lượng đội ngũ quản lý và các ưu tiên phát triển trong 12 tháng tới.',
  },
  {
    idx: 15,
    part: 1,
    type: 'likert',
    question: 'Khi doanh nghiệp mở rộng quy mô hoặc triển khai chiến lược mới, đội ngũ quản lý hiện tại đủ năng lực để dẫn dắt sự thay đổi.',
  },
  {
    idx: 16,
    part: 1,
    type: 'likert',
    question: 'Những quản lý giỏi nhất trong doanh nghiệp đang giúp nhân rộng năng lực cho tổ chức, thay vì chỉ tạo ra kết quả trong phạm vi đội ngũ của mình.',
  },
  {
    idx: 17,
    options: [
      'Thiếu năng lực quản lý',
      'Thiếu người kế nhiệm',
      'Khó tuyển quản lý giỏi',
      'Quản lý chưa theo kịp AI/chuyển đổi số',
      'CEO và Nhân sự chưa thống nhất',
      OTHER_OPTION_2026Q3,
    ],
    part: 1,
    question: 'Trong 12 tháng tới, rủi ro lớn nhất đối với tăng trưởng của doanh nghiệp liên quan đến đội ngũ quản lý là gì?',
    type: 'mcq',
  },
  {
    idx: 18,
    options: [
      'Phát triển năng lực quản lý',
      'Xây dựng đội ngũ kế nhiệm',
      'Nâng cao năng lực lãnh đạo trong chuyển đổi',
      'AI cho đội ngũ quản lý',
      'Coaching và phát triển nhân tài',
      OTHER_OPTION_2026Q3,
    ],
    part: 1,
    question: 'Nếu chỉ được đầu tư vào một ưu tiên duy nhất trong năm tới, anh/chị sẽ chọn điều gì?',
    type: 'mcq',
  },
  {
    idx: 19,
    options: [
      'CEO là người ra quyết định cuối cùng trong hầu hết trường hợp',
      'Ban điều hành cùng thống nhất trước khi quyết định',
      'Business Unit có quyền quyết định trong phạm vi của mình',
      'Quyền quyết định đã được phân cấp rõ đến các cấp quản lý.',
      OTHER_OPTION_2026Q3,
    ],
    part: 2,
    question: 'Khi doanh nghiệp cần đưa ra một quyết định quan trọng trong vòng 48 giờ, điều nào mô tả đúng nhất?',
    type: 'mcq',
  },
  {
    // "Mục khác:" is left out of questions 20 and 21 until cwi-ai's 2026Q3 registry
    // accepts "Khác" for them (it returns 422 today). Add it back here and on the
    // landing page together.
    idx: 20,
    options: [
      'Tìm người quản lý đủ năng lực',
      'Đảm bảo các đơn vị phối hợp nhất quán',
      'Chuẩn hóa quy trình và cách làm',
      'Tuyển đủ nhân sự',
      'Tôi tin doanh nghiệp đã sẵn sàng để mở rộng',
    ],
    part: 2,
    question: 'Nếu ngày mai doanh nghiệp mở thêm một chi nhánh, nhà máy hoặc đơn vị kinh doanh mới, điều gì sẽ là thách thức lớn nhất trong 90 ngày đầu?',
    type: 'mcq',
  },
  {
    idx: 21,
    options: [
      'Các quyết định quan trọng sẽ chậm lại',
      'Chiến lược sẽ khó được triển khai nhất quán',
      'Thiếu người đủ năng lực để thay thế',
      'Các đơn vị sẽ phối hợp kém',
      'Tôi không quá lo vì đội ngũ đã đủ trưởng thành',
    ],
    part: 2,
    question: 'Nếu anh/chị vắng mặt trong ba tháng, điều gì khiến anh/chị lo ngại nhất?',
    type: 'mcq',
  },
  {
    idx: 22,
    options: [
      'Thị trường',
      'Nguồn vốn',
      'Năng lực đội ngũ quản lý',
      'Khả năng thực thi',
      'Hệ thống và quy trình',
      'Tôi chưa thấy có rào cản lớn',
      OTHER_OPTION_2026Q3,
    ],
    part: 2,
    question: 'Hiện nay, điều gì đang giới hạn khả năng tăng trưởng của doanh nghiệp nhiều nhất?',
    type: 'mcq',
  },
  {
    idx: 23,
    instruction: '*Lựa chọn 1 đáp án phù hợp nhất',
    options: [
      'Dưới 100 tỷ VND',
      'Từ 100 - <300 tỷ VND',
      'Từ 300 - <1,000 tỷ VND',
      'Từ 1,000 - <5,000 tỷ VND',
      'Từ 5,000 - <10,000 tỷ VND',
      'Trên 10,000 tỷ VND',
    ],
    part: 2,
    question: 'Quy mô doanh thu của công ty hiện nay',
    type: 'mcq',
  },
  { idx: 24, part: 2, question: 'Website công ty', type: 'text' },
] as const satisfies readonly SurveyQuestion[]

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import type { ReportAssetStorage } from '../reports/reportAssetStorage.js'
import type { ClaimedExportJob } from './exportTypes.js'
import type { ExportFilters } from './exportTypes.js'
import type { ExportCursor } from './exportRepository.js'
import { PgExportRepository } from './exportRepository.js'

const BATCH_SIZE = 750
const MAX_DATA_ROWS_PER_SHEET = 1_048_575
const DATE_FORMAT = 'dd/mm/yyyy hh:mm'
const HEADER_COLOR = '164EAF'
const HEADER_TEXT_COLOR = 'FFFFFF'
const BORDER_COLOR = 'D9E2F2'
const ALTERNATE_ROW_COLOR = 'F7FAFF'

type CellValue = string | number | boolean | Date | null

type SheetWriter = {
  add(values: CellValue[]): void
  finish(): Promise<void>
}

function safeCellText(value: string) {
  const trimmed = value.length > 32_000 ? value.slice(0, 31_997) + '...' : value
  return /^[=+\-@]/.test(trimmed) ? "'" + trimmed : trimmed
}

export function sanitizeExcelCell(value: string | null | undefined) {
  if (value === null || value === undefined) return ''
  return safeCellText(value)
}

function answerValueToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => answerValueToText(item)).join(', ')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.label === 'string') return record.label
    if (typeof record.value === 'string') return record.value
  }
  return String(value)
}

function statusLabel(value: string | null | undefined) {
  if (value === 'part1_only') return 'Chỉ Phần 1'
  if (value === 'part2_refused_privacy') return 'Hoàn thành Phần 2 nhưng không đồng ý bảo mật'
  if (value === 'full_private_report') return 'Đã gửi đủ hai phần'
  return 'Chưa xác định'
}

function reportLabel(value: string | null | undefined) {
  if (!value) return 'Chưa tạo báo cáo'
  if (value === 'completed' || value === 'sent') return 'Đã tạo báo cáo'
  if (value === 'failed') return 'Tạo báo cáo lỗi'
  if (value === 'skipped') return 'Không áp dụng'
  return 'Đang tạo báo cáo'
}

function consentLabel(value: string | null | undefined) {
  if (value === 'yes') return 'Đồng ý'
  if (value === 'no') return 'Không đồng ý'
  return 'Không áp dụng'
}

function yesNo(value: boolean | null | undefined) {
  return value ? 'Có' : 'Không'
}

function toExcelValue(value: CellValue): CellValue {
  if (typeof value === 'string') return safeCellText(value)
  return value
}

function columnName(index: number) {
  let value = ''
  let current = index
  while (current > 0) {
    const remainder = (current - 1) % 26
    value = String.fromCharCode(65 + remainder) + value
    current = Math.floor((current - 1) / 26)
  }
  return value
}

function styleHeader(row: ExcelJS.Row, columnCount: number) {
  row.height = 28
  for (let index = 1; index <= columnCount; index += 1) {
    const cell = row.getCell(index)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } }
    cell.font = { bold: true, color: { argb: HEADER_TEXT_COLOR }, name: 'Aptos', size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      bottom: { color: { argb: BORDER_COLOR }, style: 'thin' },
      left: { color: { argb: BORDER_COLOR }, style: 'thin' },
      right: { color: { argb: BORDER_COLOR }, style: 'thin' },
      top: { color: { argb: BORDER_COLOR }, style: 'thin' },
    }
  }
}

function styleDataRow(row: ExcelJS.Row, rowNumber: number) {
  row.height = 22
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { color: { argb: '202939' }, name: 'Aptos', size: 10 }
    cell.alignment = { vertical: 'top', wrapText: true }
    cell.border = {
      bottom: { color: { argb: BORDER_COLOR }, style: 'hair' },
    }
    if (rowNumber % 2 === 0) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALTERNATE_ROW_COLOR } }
    }
    if (cell.value instanceof Date) cell.numFmt = DATE_FORMAT
  })
}

function createSheetWriter(workbook: ExcelJS.stream.xlsx.WorkbookWriter, name: string, headers: string[], widths: number[]): SheetWriter {
  let sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  let dataRows = 0
  let sheetIndex = 1

  const configure = (nextSheet: ExcelJS.Worksheet) => {
    nextSheet.autoFilter = { from: 'A1', to: columnName(headers.length) + '1' }
    nextSheet.columns = headers.map((header, index) => ({ header, key: String(index), width: widths[index] ?? 18 }))
    const headerRow = nextSheet.getRow(1)
    styleHeader(headerRow, headers.length)
    headerRow.commit()
  }

  configure(sheet)

  return {
    add(values) {
      if (dataRows >= MAX_DATA_ROWS_PER_SHEET) {
        sheet.commit()
        sheetIndex += 1
        sheet = workbook.addWorksheet(name + ' ' + sheetIndex, { views: [{ state: 'frozen', ySplit: 1 }] })
        dataRows = 0
        configure(sheet)
      }
      dataRows += 1
      const row = sheet.addRow(values.map(toExcelValue))
      styleDataRow(row, dataRows)
      row.commit()
    },
    async finish() {
      sheet.commit()
    },
  }
}

function addOverview(workbook: ExcelJS.stream.xlsx.WorkbookWriter, job: ClaimedExportJob) {
  const sheet = workbook.addWorksheet('Tổng quan', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: 'Thông tin', key: 'label', width: 30 },
    { header: 'Nội dung', key: 'value', width: 70 },
  ]
  styleHeader(sheet.getRow(1), 2)
  sheet.getRow(1).commit()
  const filters = job.filters as ExportFilters
  const rows: CellValue[][] = [
    ['Loại dữ liệu', job.dataset === 'submissions' ? 'Lượt gửi khảo sát' : 'Đăng ký Roundtable'],
    ['Thời gian tạo', job.created_at],
    ['Trạng thái lọc', filters.status ? statusLabel(filters.status) : 'Tất cả trạng thái'],
    ['Đăng ký Roundtable', filters.roundtableRegistered === undefined ? 'Tất cả' : yesNo(filters.roundtableRegistered)],
    ['Tình trạng liên kết', filters.linkStatus === undefined ? 'Tất cả' : filters.linkStatus === 'linked' ? 'Đã khảo sát' : 'Đăng ký riêng'],
    ['Từ khóa tìm kiếm', filters.search ? sanitizeExcelCell(filters.search) : 'Không lọc'],
  ]
  rows.forEach((values, index) => {
    const row = sheet.addRow(values.map(toExcelValue))
    styleDataRow(row, index + 1)
    row.commit()
  })
  sheet.commit()
}

function buildSubmissionValues(row: {
  answers_count: number
  email: string
  full_name: string
  part1_completed: boolean
  part2_completed: boolean
  position: string
  privacy_consent: string
  report_status: string | null
  roundtable_registered: boolean
  status_note: string
  submission_status: string
  submitted_at: Date
}) {
  return [
    row.full_name,
    row.email,
    row.position,
    statusLabel(row.submission_status),
    row.status_note,
    consentLabel(row.privacy_consent),
    yesNo(row.part1_completed),
    yesNo(row.part2_completed),
    row.answers_count,
    yesNo(row.roundtable_registered),
    reportLabel(row.report_status),
    row.submitted_at,
  ] as CellValue[]
}

function buildRoundtableValues(row: {
  email: string
  full_name: string
  linked_answers_count: number | null
  linked_email: string | null
  linked_full_name: string | null
  linked_position: string | null
  linked_privacy_consent: string | null
  linked_report_status: string | null
  linked_submission_id: string | null
  linked_submission_status: string | null
  linked_submitted_at: Date | null
  position: string | null
  registered_at: Date
}) {
  return [
    row.full_name,
    row.email,
    row.position ?? '',
    row.linked_submission_id ? 'Đã khảo sát' : 'Đăng ký riêng',
    row.registered_at,
    row.linked_submission_id ? statusLabel(row.linked_submission_status) : 'Chưa có lượt gửi',
    row.linked_submission_id ? reportLabel(row.linked_report_status) : 'Không áp dụng',
    row.linked_full_name ?? '',
    row.linked_email ?? '',
    row.linked_position ?? '',
    row.linked_answers_count ?? '',
    row.linked_submission_id ? consentLabel(row.linked_privacy_consent) : 'Không áp dụng',
    row.linked_submitted_at,
  ] as CellValue[]
}

export type ExportGenerationResult = {
  fileName: string
  filePath: string
  fileSize: number
  rowCount: number
  storagePath: string
}

export class ExportWorkbookService {
  constructor(
    private readonly repository: PgExportRepository,
    private readonly storage: ReportAssetStorage,
  ) {}

  async generate(job: ClaimedExportJob): Promise<ExportGenerationResult> {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cwi-export-'))
    const filePath = join(temporaryDirectory, job.file_name ?? 'du-lieu.xlsx')
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useSharedStrings: false,
      useStyles: true,
    })

    try {
      addOverview(workbook, job)
      const primaryHeaders =
        job.dataset === 'submissions'
          ? ['Họ tên', 'Email', 'Chức vụ', 'Trạng thái khảo sát', 'Ghi chú trạng thái', 'Bảo mật dữ liệu', 'Đã trả lời Phần 1', 'Đã trả lời Phần 2', 'Số câu trả lời', 'Đăng ký Roundtable', 'Trạng thái báo cáo', 'Thời gian gửi']
          : ['Họ tên', 'Email', 'Chức vụ', 'Tình trạng', 'Thời gian đăng ký', 'Trạng thái khảo sát', 'Trạng thái báo cáo', 'Họ tên trong khảo sát', 'Email trong khảo sát', 'Chức vụ trong khảo sát', 'Số câu trả lời', 'Bảo mật dữ liệu', 'Thời gian gửi khảo sát']
      const primaryWidths = job.dataset === 'submissions' ? [24, 30, 24, 34, 38, 18, 18, 18, 15, 20, 22, 20] : [24, 30, 24, 18, 20, 34, 22, 24, 30, 24, 15, 18, 22]
      const primarySheet = createSheetWriter(workbook, job.dataset === 'submissions' ? 'Lượt gửi khảo sát' : 'Đăng ký Roundtable', primaryHeaders, primaryWidths)
      const answerSheet =
        job.dataset === 'submissions'
          ? createSheetWriter(workbook, 'Câu trả lời', ['Họ tên', 'Email', 'Phần', 'Số câu', 'Câu hỏi', 'Câu trả lời', 'Nội dung khác', 'Thời gian gửi'], [24, 30, 10, 10, 70, 34, 34, 20])
          : null
      const linkedSheet =
        job.dataset === 'roundtable'
          ? createSheetWriter(workbook, 'Lượt gửi liên quan', ['Họ tên', 'Email', 'Chức vụ', 'Trạng thái khảo sát', 'Số câu trả lời', 'Bảo mật dữ liệu', 'Trạng thái báo cáo', 'Thời gian gửi'], [24, 30, 24, 34, 15, 18, 22, 20])
          : null

      let rowCount = 0
      let cursor: ExportCursor | null = null
      let hasMore = true
      while (hasMore) {
        if (job.dataset === 'submissions') {
          const batch = await this.repository.listSubmissionBatch(job.filters, job.snapshot_at, cursor, BATCH_SIZE)
          for (const row of batch.rows) primarySheet.add(buildSubmissionValues(row))
          const answers = await this.repository.listAnswerBatch(batch.rows.map((row) => row.id))
          for (const answer of answers) {
            answerSheet?.add([
              answer.full_name,
              answer.email,
              answer.part,
              answer.question_idx,
              answer.question_text,
              answer.answer_text || answerValueToText(answer.answer_value),
              answer.other_text ?? '',
              answer.submitted_at,
            ])
          }
          rowCount += batch.rows.length
          cursor = batch.nextCursor
          hasMore = batch.hasMore
        } else {
          const batch = await this.repository.listRoundtableBatch(job.filters, job.snapshot_at, cursor, BATCH_SIZE)
          for (const row of batch.rows) {
            primarySheet.add(buildRoundtableValues(row))
            if (row.linked_submission_id) {
              linkedSheet?.add([
                row.linked_full_name ?? '',
                row.linked_email ?? '',
                row.linked_position ?? '',
                statusLabel(row.linked_submission_status),
                row.linked_answers_count ?? '',
                consentLabel(row.linked_privacy_consent),
                reportLabel(row.linked_report_status),
                row.linked_submitted_at,
              ])
            }
          }
          rowCount += batch.rows.length
          cursor = batch.nextCursor
          hasMore = batch.hasMore
        }
      }

      await primarySheet.finish()
      await answerSheet?.finish()
      await linkedSheet?.finish()
      await workbook.commit()

      const fileInfo = await stat(filePath)
      const timestamp = new Date(job.created_at)
      const storagePath = [
        'admin-exports',
        String(timestamp.getUTCFullYear()),
        String(timestamp.getUTCMonth() + 1).padStart(2, '0'),
        job.id,
        job.file_name ?? 'du-lieu.xlsx',
      ].join('/')
      await this.storage.uploadFile(storagePath, filePath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

      return {
        fileName: job.file_name ?? 'du-lieu.xlsx',
        filePath,
        fileSize: fileInfo.size,
        rowCount,
        storagePath,
      }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  }
}





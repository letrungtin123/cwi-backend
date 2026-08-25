import Busboy from 'busboy'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Request } from 'express'
import { pipeline } from 'node:stream/promises'
import { decodeMultipartFileName, normalizeReportFileName } from './reportDeliveryFilename.js'

export class MultipartUploadError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'MultipartUploadError'
  }
}

export type ParsedPdfUpload = {
  fileName: string
  filePath: string
  fileSize: number
  sha256: string
}

function sanitizeFileName(value: string) {
  return normalizeReportFileName(value)
}

export async function parsePdfUpload(request: Request, maxBytes: number): Promise<ParsedPdfUpload> {
  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new MultipartUploadError('Vui lòng tải lên file PDF theo định dạng multipart/form-data.')
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cwi-report-upload-'))
  const temporaryPath = join(temporaryDirectory, 'report.pdf')
  let fileName = 'bao-cao.pdf'
  let fileSize = 0
  let fileSeen = false
  let fileTooLarge = false
  let fileError: Error | null = null
  let writePromise: Promise<void> | null = null
  let prefix = Buffer.alloc(0)
  const hash = createHash('sha256')

  try {
    await new Promise<void>((resolve, reject) => {
      let parser: Busboy.Busboy
      try {
        parser = Busboy({
          defParamCharset: 'utf8',
          headers: request.headers,
          limits: { files: 1, fileSize: maxBytes, fields: 2 },
        })
      } catch {
        reject(new MultipartUploadError('Dữ liệu tải lên không hợp lệ.'))
        return
      }

      parser.on('file', (fieldName, stream, info) => {
        if (fieldName !== 'file' || fileSeen) {
          stream.resume()
          return
        }
        fileSeen = true
        const decodedFileName = decodeMultipartFileName(info.filename)
        if (!/\.pdf$/iu.test(decodedFileName)) fileError = new MultipartUploadError('Tên file phải có đuôi .pdf.')
        fileName = sanitizeFileName(decodedFileName)
        if (info.mimeType !== 'application/pdf' && info.mimeType !== 'application/octet-stream') {
          fileError = new MultipartUploadError('Chỉ chấp nhận file PDF.')
        }
        stream.on('data', (chunk: Buffer) => {
          fileSize += chunk.length
          hash.update(chunk)
          if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk]).subarray(0, 5)
        })
        stream.on('limit', () => { fileTooLarge = true })
        stream.on('error', (error) => { fileError = error })
        const output = createWriteStream(temporaryPath, { flags: 'w', mode: 0o600 })
        writePromise = pipeline(stream, output).catch((error) => { fileError = error })
      })

      parser.on('filesLimit', () => { fileTooLarge = true })
      parser.on('error', reject)
      parser.on('finish', resolve)
      request.pipe(parser)
    })

    if (writePromise) await writePromise
    if (!fileSeen) throw new MultipartUploadError('Chưa chọn file PDF.')
    if (fileTooLarge || fileSize > maxBytes) throw new MultipartUploadError('File PDF vượt quá dung lượng cho phép.')
    if (fileError) throw fileError
    if (prefix.toString('ascii') !== '%PDF-') throw new MultipartUploadError('File tải lên không phải PDF hợp lệ.')
    if (fileSize <= 0) throw new MultipartUploadError('File PDF không được để trống.')

    return { fileName, filePath: temporaryPath, fileSize, sha256: hash.digest('hex') }
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true })
    if (error instanceof MultipartUploadError) throw error
    throw new MultipartUploadError('Không thể đọc file PDF tải lên.')
  }
}

export async function removeParsedPdfUpload(upload: ParsedPdfUpload) {
  await rm(upload.filePath, { force: true }).catch(() => undefined)
  await rm(join(upload.filePath, '..'), { force: true, recursive: true }).catch(() => undefined)
}

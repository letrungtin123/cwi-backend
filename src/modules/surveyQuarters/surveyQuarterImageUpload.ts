import Busboy from 'busboy'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Request } from 'express'
import { HttpError } from '../../http/errors.js'

// One card image ("file" field) for a survey quarter. The type is taken from the file's
// first bytes, never from its name or the browser's claim: JPEG, PNG or WebP only.
export type ParsedImageUpload = {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp'
  extension: 'jpg' | 'png' | 'webp'
  filePath: string
  fileSize: number
  sha256: string
}

export const SURVEY_QUARTER_IMAGE_MAX_BYTES = 5 * 1024 * 1024

function uploadError(message: string) {
  return new HttpError(422, 'invalid_survey_quarter_image', message)
}

export function detectImageType(prefix: Buffer): Pick<ParsedImageUpload, 'contentType' | 'extension'> | null {
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return { contentType: 'image/jpeg', extension: 'jpg' }
  if (prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { contentType: 'image/png', extension: 'png' }
  if (prefix.length >= 12 && prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  return null
}

export async function parseImageUpload(request: Request, maxBytes = SURVEY_QUARTER_IMAGE_MAX_BYTES): Promise<ParsedImageUpload> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data')) {
    throw uploadError('Vui lòng chọn ảnh để tải lên.')
  }

  const directory = await mkdtemp(join(tmpdir(), 'cwi-quarter-image-'))
  const filePath = join(directory, 'image')
  let fileSeen = false
  let fileSize = 0
  let tooLarge = false
  let failure: Error | null = null
  let writing: Promise<void> | null = null
  let prefix = Buffer.alloc(0)
  const hash = createHash('sha256')

  try {
    await new Promise<void>((resolve, reject) => {
      let parser: Busboy.Busboy
      try {
        parser = Busboy({ headers: request.headers, limits: { fields: 0, files: 1, fileSize: maxBytes } })
      } catch {
        reject(uploadError('Dữ liệu tải lên không hợp lệ.'))
        return
      }
      parser.on('file', (fieldName, stream) => {
        if (fieldName !== 'file' || fileSeen) {
          stream.resume()
          return
        }
        fileSeen = true
        stream.on('data', (chunk: Buffer) => {
          fileSize += chunk.length
          hash.update(chunk)
          if (prefix.length < 12) prefix = Buffer.concat([prefix, chunk]).subarray(0, 12)
        })
        stream.on('limit', () => { tooLarge = true })
        writing = pipeline(stream, createWriteStream(filePath, { flags: 'w', mode: 0o600 })).catch((error: Error) => { failure = error })
      })
      parser.on('filesLimit', () => { tooLarge = true })
      parser.on('error', reject)
      parser.on('finish', resolve)
      request.pipe(parser)
    })
    if (writing) await writing
    if (!fileSeen || fileSize === 0) throw uploadError('Vui lòng chọn ảnh để tải lên.')
    if (tooLarge || fileSize > maxBytes) throw uploadError('Ảnh vượt quá 5 MB. Vui lòng chọn ảnh nhỏ hơn.')
    if (failure) throw failure
    const type = detectImageType(prefix)
    if (!type) throw uploadError('Chỉ nhận ảnh JPG, PNG hoặc WebP.')
    return { ...type, filePath, fileSize, sha256: hash.digest('hex') }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    if (error instanceof HttpError) throw error
    throw uploadError('Không đọc được ảnh tải lên. Vui lòng thử lại.')
  }
}

export async function removeImageUpload(upload: ParsedImageUpload) {
  await rm(join(upload.filePath, '..'), { force: true, recursive: true }).catch(() => undefined)
}

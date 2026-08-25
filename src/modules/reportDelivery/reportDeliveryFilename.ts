export const DEFAULT_REPORT_FILE_NAME = 'bao-cao-ceo-workforce-index.pdf'

const MOJIBAKE_MARKERS = /(?:Ã.|Â.|â.|ð.|�)/u

/**
 * Browser multipart headers are UTF-8 in practice, but some parsers decode
 * non-extended filename parameters as Latin-1. Repair only strings that show
 * the characteristic mojibake markers and keep valid Unicode untouched.
 */
export function decodeMultipartFileName(value: string) {
  if (!MOJIBAKE_MARKERS.test(value)) return value
  const repaired = Buffer.from(value, 'latin1').toString('utf8')
  return repaired.includes('\uFFFD') ? value : repaired
}

export function normalizeReportFileName(value: string | null | undefined) {
  const cleaned = Array.from(decodeMultipartFileName(value ?? '').normalize('NFKC'))
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 0x20 && codePoint !== 0x7f
    })
    .join('')
    .replace(/[\\/]/g, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^\.+/, '')

  if (!cleaned) return DEFAULT_REPORT_FILE_NAME
  const baseName = cleaned.replace(/\.pdf$/iu, '')
  return baseName.slice(0, 176) + '.pdf'
}

export function contentDispositionAttachment(value: string | null | undefined) {
  const fileName = normalizeReportFileName(value)
  const asciiFallback = fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[\\"]/g, '_')
  return 'attachment; filename="' + asciiFallback + '"; filename*=UTF-8\'\'' + encodeURIComponent(fileName)
}

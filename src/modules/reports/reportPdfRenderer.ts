import { createHash, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class PdfRenderError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, options: { code: string; retryable: boolean }) {
    super(message)
    this.name = 'PdfRenderError'
    this.code = options.code
    this.retryable = options.retryable
  }
}

export type ReportPdfRendererConfig = {
  browserPath: string | null
  disableSandbox: boolean
  renderTimeoutMs: number
  storageDir: string
}

export type StoredHtml = {
  htmlPath: string
  reportDir: string
}

export type RenderedPdf = {
  pdfPath: string
  sha256: string
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function exists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function findBrowser(configuredPath: string | null) {
  if (configuredPath) {
    if (await exists(configuredPath)) return configuredPath
    throw new PdfRenderError('Configured PDF_BROWSER_PATH does not exist.', {
      code: 'pdf_browser_not_found',
      retryable: false,
    })
  }

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ]

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }

  throw new PdfRenderError('No Chrome, Chromium, or Edge executable was found for PDF rendering.', {
    code: 'pdf_browser_not_found',
    retryable: false,
  })
}

export class ReportPdfRenderer {
  constructor(private readonly config: ReportPdfRendererConfig) {}

  async storeHtml(submissionId: string, reportId: string, html: string): Promise<StoredHtml> {
    const reportDir = path.resolve(this.config.storageDir, safeSegment(submissionId), safeSegment(reportId))
    await mkdir(reportDir, { recursive: true })
    const htmlPath = path.join(reportDir, 'report.html')
    await writeFile(htmlPath, html, 'utf8')
    return { htmlPath, reportDir }
  }


  async cleanup(storedHtml: StoredHtml) {
    const storageRoot = path.resolve(this.config.storageDir)
    const reportDir = path.resolve(storedHtml.reportDir)
    const isInsideStorageRoot = reportDir.startsWith(`${storageRoot}${path.sep}`)

    if (!isInsideStorageRoot) {
      throw new PdfRenderError('Refusing to clean up report files outside REPORT_STORAGE_DIR.', {
        code: 'invalid_report_cleanup_path',
        retryable: false,
      })
    }

    await rm(reportDir, { force: true, recursive: true })
  }

  async renderPdf(storedHtml: StoredHtml): Promise<RenderedPdf> {
    const browserPath = await findBrowser(this.config.browserPath)
    const tempDir = path.join(tmpdir(), `cwi-report-${randomUUID()}`)
    const tempPdfPath = path.join(tempDir, 'report.pdf')
    const finalPdfPath = path.join(storedHtml.reportDir, 'report.pdf')
    const browserArgs = [
      '--headless=new',
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--no-first-run',
      '--print-to-pdf-no-header',
      `--print-to-pdf=${tempPdfPath}`,
      pathToFileURL(storedHtml.htmlPath).toString(),
    ]

    if (this.config.disableSandbox) browserArgs.splice(6, 0, '--no-sandbox')

    await mkdir(tempDir, { recursive: true })

    try {
      await execFileAsync(
        browserPath,
        browserArgs,
        {
          timeout: this.config.renderTimeoutMs,
          windowsHide: true,
        },
      )

      const pdf = await readFile(tempPdfPath)
      const hasPdfHeader = pdf.subarray(0, 5).toString('ascii') === '%PDF-'
      const hasPdfTrailer = pdf.includes(Buffer.from('%%EOF'))
      if (pdf.length < 1024 || !hasPdfHeader || !hasPdfTrailer) {
        throw new PdfRenderError('Generated PDF failed structural validation.', {
          code: 'pdf_output_invalid',
          retryable: true,
        })
      }

      await copyFile(tempPdfPath, finalPdfPath)
      return {
        pdfPath: finalPdfPath,
        sha256: createHash('sha256').update(pdf).digest('hex'),
      }
    } catch (error) {
      if (error instanceof PdfRenderError) throw error
      const timedOut = error instanceof Error && /timed out|timeout/i.test(error.message)
      throw new PdfRenderError(error instanceof Error ? error.message : 'PDF rendering failed.', {
        code: timedOut ? 'pdf_render_timeout' : 'pdf_render_failed',
        retryable: timedOut,
      })
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  }
}

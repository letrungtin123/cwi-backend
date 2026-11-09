import { isUnfinishedReportStatus, type ReportGenerationSettings, type ReportJobStatusValue } from './reportRepository.js'

// While cwi-ai calls are turned off, an unfinished report will not be ready on the
// waiting page; the survey tells the user it arrives by email within N days instead.
export function reportDeferral(status: ReportJobStatusValue, settings: ReportGenerationSettings) {
  const resultDeferred = !settings.aiCallsEnabled && isUnfinishedReportStatus(status)
  return {
    deferredResultDays: resultDeferred ? settings.deferredResultDays : null,
    resultDeferred,
  }
}

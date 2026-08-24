import { z } from 'zod'

export const exportDatasetSchema = z.enum(['submissions', 'roundtable'])

export const exportFiltersSchema = z
  .object({
    linkStatus: z.enum(['linked', 'standalone']).optional(),
    roundtableRegistered: z.boolean().optional(),
    search: z.string().trim().max(120).optional(),
    status: z.enum(['part1_only', 'part2_refused_privacy', 'full_private_report']).optional(),
  })
  .strict()

export const createExportSchema = z
  .object({
    dataset: exportDatasetSchema,
    filters: exportFiltersSchema.default({}),
  })
  .strict()

export type ExportDataset = z.infer<typeof exportDatasetSchema>
export type ExportFilters = z.infer<typeof exportFiltersSchema>

export type ExportJobStatus = 'queued' | 'generating' | 'completed' | 'failed' | 'expired'

export type ExportJob = {
  createdAt: string
  dataset: ExportDataset
  errorMessage: string | null
  expiresAt: string
  fileName: string | null
  fileSize: number | null
  id: string
  rowCount: number | null
  status: ExportJobStatus
}

export type ExportJobRow = {
  attempt: number
  created_at: Date
  dataset: ExportDataset
  error_code: string | null
  error_message: string | null
  expires_at: Date
  file_name: string | null
  file_size: string | null
  filters: ExportFilters
  id: string
  locked_at: Date | null
  locked_by: string | null
  row_count: string | null
  snapshot_at: Date
  started_at: Date | null
  status: ExportJobStatus
  storage_path: string | null
}

export type ClaimedExportJob = ExportJobRow & {
  requested_by: string
}

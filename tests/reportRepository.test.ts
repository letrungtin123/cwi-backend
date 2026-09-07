import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { PgReportRepository } from '../src/modules/reports/reportRepository.js'

describe('report retry repository', () => {
  it('creates one pending retry job from the latest failed job', async () => {
    const clientQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] }
      if (sql.includes('FROM public.cwi_survey_submissions')) return { rows: [{ id: 'submission-1' }] }
      if (sql.includes('FROM public.cwi_report_jobs')) {
        if (sql.includes('status = ANY')) return { rows: [] }
        return {
          rows: [{
            id: 'failed-job',
            provider_endpoint: '/v3/reports/personalized',
            report_type: 'personalized',
            request_payload: {
              answers: [{ answer: 'CEO và HR chưa thống nhất', idx: 17 }],
            },
            status: 'failed',
          }],
        }
      }
      if (sql.includes('INSERT INTO public.cwi_report_jobs')) return { rows: [{ id: 'retry-job', status: 'pending' }] }
      throw new Error(`Unexpected query: ${sql}`)
    })
    const client = { query: clientQuery, release: vi.fn() }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as pg.Pool
    const repository = new PgReportRepository(pool)

    await expect(repository.retryFailedJob('submission-1')).resolves.toEqual({
      jobId: 'retry-job',
      status: 'pending',
      submissionId: 'submission-1',
    })

    const insertCall = clientQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO public.cwi_report_jobs'))
    expect(insertCall?.[1]?.[3]).toContain('CEO và Nhân sự chưa thống nhất')
    expect(client.release).toHaveBeenCalledOnce()
  })
})

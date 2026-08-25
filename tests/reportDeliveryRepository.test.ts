import { describe, expect, it, vi } from "vitest"
import pg from "pg"
import { PgReportDeliveryRepository } from "../src/modules/reportDelivery/reportDeliveryRepository.js"

describe("PgReportDeliveryRepository", () => {
  it("maps a left-joined submission without a PDF as unavailable", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        submission_id: "submission-id",
        storage_bucket: null,
        storage_path: null,
        original_file_name: null,
        file_size: null,
        sha256: null,
        uploaded_at: null,
        locked_at: null,
        email_status: null,
        sent_at: null,
        last_error_message: null,
      }],
    })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await expect(repository.getStatuses(["submission-id"])).resolves.toEqual([{
      emailLastError: null,
      emailSentAt: null,
      emailStatus: "not_sent",
      file: { available: false, fileName: null, fileSize: null, uploadedAt: null, lockedAt: null, downloadUrl: null },
      submissionId: "submission-id",
    }])
  })

  it("returns the original filename when claiming an email job", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: "job-id",
        campaign_id: "campaign-id",
        submission_id: "submission-id",
        recipient_email: "user@example.com",
        recipient_name: "Nguyễn Văn A",
        storage_bucket: "cwi-submission-report-pdfs",
        storage_path: "submissions/2026/08/submission-id/file.pdf",
        file_sha256: "a".repeat(64),
        attempt_count: 1,
        original_file_name: "Báo cáo khảo sát Q3 2026.pdf",
      }],
    })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await expect(repository.claimJob("job-id", "worker-id", 60_000)).resolves.toMatchObject({
      originalFileName: "Báo cáo khảo sát Q3 2026.pdf",
    })
    expect(String(query.mock.calls[0]?.[0])).toContain("original_file_name")
    expect(String(query.mock.calls[0]?.[0])).not.toContain("published_at IS NOT NULL")
  })
})

describe("report delivery queue recovery", () => {
  it("claims a campaign only when the dispatch lock is acquired", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "campaign-id" }] })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await expect(repository.claimCampaign("campaign-id", 300_000)).resolves.toBe(true)
    expect(String(query.mock.calls[0]?.[0])).toContain("updated_at < now()")
  })

  it("reclaims queued jobs whose publish marker is stale", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "job-id" }] })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await expect(repository.claimUnpublished("campaign-id", 100, "worker-id", 300_000)).resolves.toEqual(["job-id"])
    expect(String(query.mock.calls[0]?.[0])).toContain("published_at IS NULL OR published_at < now()")
  })

  it("only lists unexpired campaigns for recovery", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "campaign-id" }] })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await expect(repository.listActiveCampaigns(20)).resolves.toEqual(["campaign-id"])
    expect(String(query.mock.calls[0]?.[0])).toContain("c.expires_at > now()")
    expect(String(query.mock.calls[0]?.[0])).not.toContain("EXISTS")
  })

  it("expires stale campaigns and makes queued jobs retryable", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await repository.expireStaleCampaigns()
    expect(query).toHaveBeenCalledOnce()
    expect(String(query.mock.calls[0]?.[0])).toContain("job.status = 'queued'")
    expect(String(query.mock.calls[0]?.[0])).toContain("SET status = 'failed'")
  })

  it("refreshes campaign counters and status atomically", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repository = new PgReportDeliveryRepository({ query } as unknown as pg.Pool)

    await repository.refreshCampaign("campaign-id")
    expect(query).toHaveBeenCalledOnce()
    expect(String(query.mock.calls[0]?.[0])).toContain("WITH counts AS")
    expect(String(query.mock.calls[0]?.[0])).toContain("counts.queued_count > 0 OR counts.sending_count > 0")
    expect(String(query.mock.calls[0]?.[0])).toContain("campaign.status IN ('completed', 'failed', 'expired')")
  })
})

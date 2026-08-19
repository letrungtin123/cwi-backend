import { Router } from 'express'
import type { RuntimeConfig } from '../../config/runtime.js'
import { requireAdminSession } from '../../http/adminSession.js'
import { HttpError } from '../../http/errors.js'
import type { AuthService } from '../auth/authService.js'
import type { PgAdminRepository } from './adminRepository.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validStatuses = new Set(['part1_only', 'part2_refused_privacy', 'full_private_report'])

function parseLimit(value: unknown) {
  if (typeof value !== 'string') return 50
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return 50
  return Math.min(100, Math.max(1, parsed))
}

function parseBefore(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'invalid_before_cursor', 'before must be an ISO timestamp.')
  }
  return parsed
}

function parseStatus(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (!validStatuses.has(value)) {
    throw new HttpError(400, 'invalid_submission_status', 'submission_status filter is invalid.')
  }
  return value
}

function parseSearch(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

function parseRoundtable(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (value === 'true') return true
  if (value === 'false') return false
  throw new HttpError(400, 'invalid_roundtable_filter', 'roundtable filter must be true or false.')
}

export function createAdminRouter(repository: PgAdminRepository, authService: AuthService, config: RuntimeConfig) {
  const router = Router()

  router.use(requireAdminSession(authService, config))

  router.get('/survey-submissions/stats', async (_req, res, next) => {
    try {
      const data = await repository.getSubmissionStats()
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/survey-submissions', async (req, res, next) => {
    try {
      const data = await repository.listSubmissions({
        before: parseBefore(req.query.before),
        limit: parseLimit(req.query.limit),
        roundtableRegistered: parseRoundtable(req.query.roundtable),
        search: parseSearch(req.query.search),
        status: parseStatus(req.query.status),
      })
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  router.get('/survey-submissions/:id', async (req, res, next) => {
    try {
      const id = req.params.id
      if (!id || !uuidPattern.test(id)) {
        throw new HttpError(400, 'invalid_submission_id', 'Submission id must be a UUID.')
      }

      const data = await repository.getSubmission(id)
      res.json({ data })
    } catch (error) {
      next(error)
    }
  })

  return router
}
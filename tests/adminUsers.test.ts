import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/http/errors.js'
import { normalizeAdminAccountCreate, normalizeAdminAccountUpdate } from '../src/modules/adminUsers/adminUserRoutes.js'
import { canManageContent, isSuperadmin, requireSuperadmin } from '../src/modules/auth/adminRoles.js'
import { changePasswordSchema } from '../src/modules/auth/authRoutes.js'
import { generateTemporaryPassword, TEMPORARY_PASSWORD_LENGTH } from '../src/modules/auth/temporaryPassword.js'
import { diffSurveySource } from '../src/modules/surveySources/surveySourceRepository.js'

function httpCode(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return error instanceof HttpError ? `${error.statusCode} ${error.code}` : 'other error'
  }
  return 'no error'
}

describe('dashboard roles', () => {
  it('lets admins and super admins change content, viewers only read', () => {
    expect(canManageContent('superadmin')).toBe(true)
    expect(canManageContent('admin')).toBe(true)
    expect(canManageContent('viewer')).toBe(false)
  })

  it('keeps account management for super admins', () => {
    expect(isSuperadmin('superadmin')).toBe(true)
    expect(isSuperadmin('admin')).toBe(false)
    const admin = { displayName: 'A', email: 'a@x.vn', id: '1', role: 'admin' as const }
    expect(httpCode(() => requireSuperadmin(admin))).toBe('403 superadmin_required')
    expect(httpCode(() => requireSuperadmin({ ...admin, role: 'superadmin' }))).toBe('no error')
  })
})

describe('temporary passwords', () => {
  it('have every character kind and no look-alike characters', () => {
    for (let run = 0; run < 200; run += 1) {
      const password = generateTemporaryPassword()
      expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[2-9]/)
      expect(password).toMatch(/[@#$%&*?!]/)
      expect(password).not.toMatch(/[0O1lI]/)
    }
  })

  it('are different every time', () => {
    const passwords = new Set(Array.from({ length: 500 }, () => generateTemporaryPassword()))
    expect(passwords.size).toBe(500)
  })
})

describe('admin account form', () => {
  it('trims the name and lower-cases the email', () => {
    expect(normalizeAdminAccountCreate({ displayName: '  Nguyễn Văn An ', email: ' An@CWI.vn ', role: 'admin' })).toEqual({
      displayName: 'Nguyễn Văn An',
      email: 'an@cwi.vn',
      role: 'admin',
    })
  })

  it('refuses a missing name, a bad email, an unknown role or extra fields', () => {
    expect(httpCode(() => normalizeAdminAccountCreate({ displayName: ' ', email: 'a@b.vn', role: 'admin' }))).toBe('422 invalid_admin_user')
    expect(httpCode(() => normalizeAdminAccountCreate({ displayName: 'A', email: 'not-an-email', role: 'admin' }))).toBe('422 invalid_admin_user')
    expect(httpCode(() => normalizeAdminAccountCreate({ displayName: 'A', email: 'a@b.vn', role: 'owner' }))).toBe('422 invalid_admin_user')
    expect(httpCode(() => normalizeAdminAccountCreate({ displayName: 'A', email: 'a@b.vn', password: 'x', role: 'admin' }))).toBe('422 invalid_admin_user')
  })

  it('never changes the email on edit', () => {
    expect(normalizeAdminAccountUpdate({ displayName: 'B', role: 'viewer' })).toEqual({ displayName: 'B', role: 'viewer' })
    expect(httpCode(() => normalizeAdminAccountUpdate({ displayName: 'B', email: 'b@x.vn', role: 'viewer' }))).toBe('422 invalid_admin_user')
  })
})

describe('change my password', () => {
  it('needs 8 to 72 characters for the new password', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: '1234567' }).success).toBe(false)
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: '12345678' }).success).toBe(true)
    expect(changePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'a'.repeat(73) }).success).toBe(false)
    expect(changePasswordSchema.safeParse({ currentPassword: '', newPassword: '12345678' }).success).toBe(false)
  })
})

describe('survey source history', () => {
  const before = { code: 'vcci-hcm', is_active: true, name: 'VCCI HCM', note: null }

  it('records only what changed', () => {
    expect(diffSurveySource(before, { isActive: true, name: 'VCCI HCM', note: null })).toEqual({})
    expect(diffSurveySource(before, { isActive: true, name: 'VCCI Hồ Chí Minh', note: null })).toEqual({
      name: { from: 'VCCI HCM', to: 'VCCI Hồ Chí Minh' },
    })
    expect(diffSurveySource(before, { isActive: false, name: 'VCCI HCM', note: 'Phát ở hội thảo' })).toEqual({
      isActive: { from: true, to: false },
      note: { from: null, to: 'Phát ở hội thảo' },
    })
  })
})

describe('deleting waiting submissions', () => {
  const id = '6f1e970a-8924-4870-9ab1-05804a0160fb'

  it('accepts 1 to 200 ids and removes duplicates', async () => {
    const { parseSubmissionIds, MAX_SUBMISSIONS_PER_DELETION } = await import('../src/modules/submissionDeletion/submissionDeletionRoutes.js')
    expect(parseSubmissionIds({ ids: [id, id.toUpperCase()] })).toEqual([id])
    expect(httpCode(() => parseSubmissionIds({ ids: [] }))).toBe('422 invalid_submission_ids')
    expect(httpCode(() => parseSubmissionIds({ ids: ['abc'] }))).toBe('422 invalid_submission_ids')
    expect(httpCode(() => parseSubmissionIds({ ids: Array.from({ length: MAX_SUBMISSIONS_PER_DELETION + 1 }, () => id) }))).toBe('422 invalid_submission_ids')
    expect(httpCode(() => parseSubmissionIds({ ids: [id], force: true }))).toBe('422 invalid_submission_ids')
  })

  it('only allows rows whose report never started and has no PDF, file or email', async () => {
    const { submissionDeletableSql } = await import('../src/modules/submissionDeletion/submissionDeletionRepository.js')
    const sql = submissionDeletableSql('s')
    expect(sql).toContain('NOT settings.ai_calls_enabled')
    expect(sql).toContain("status NOT IN ('pending', 'queued')")
    expect(sql).toContain('pdf_storage_path IS NOT NULL')
    expect(sql).toContain('cwi_submission_report_files')
    expect(sql).toContain('cwi_report_email_jobs')
  })
})

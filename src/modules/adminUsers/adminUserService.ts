import type { AuthConfig } from '../../config/runtime.js'
import { withTransaction } from '../../db/transaction.js'
import { HttpError } from '../../http/errors.js'
import { writeAdminAudit, type AuditActor } from '../audit/adminAuditLog.js'
import type { AdminRole } from '../auth/authTypes.js'
import { createSupabaseAuthUser, setSupabaseAuthPassword } from '../auth/supabaseAdminClient.js'
import { generateTemporaryPassword } from '../auth/temporaryPassword.js'
import { ADMIN_USER_AUDIT_TARGET, type AdminAccount, type PgAdminUserRepository } from './adminUserRepository.js'

export type AdminAccountCreate = {
  displayName: string
  email: string
  role: AdminRole
}

export type AdminAccountUpdate = {
  displayName: string
  role: AdminRole
}

export type AdminAccountWithPassword = {
  account: AdminAccount
  // Shown to the super admin once; never stored or logged by the backend.
  temporaryPassword: string
}

function pgErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined
}

function emailTaken() {
  return new HttpError(409, 'admin_user_email_taken', 'Email này đã có tài khoản quản trị.')
}

function refuseSelf(code: string, message: string): never {
  throw new HttpError(422, code, message)
}

// Admin account management for super admins. Accounts are never deleted, only
// locked, so their names stay right in every history.
export class AdminUserService {
  constructor(
    private readonly repository: PgAdminUserRepository,
    private readonly authConfig: AuthConfig,
  ) {}

  list() {
    return this.repository.list()
  }

  async create(input: AdminAccountCreate, actor: AuditActor): Promise<AdminAccountWithPassword> {
    if (await this.repository.emailTaken(input.email)) throw emailTaken()
    const temporaryPassword = generateTemporaryPassword()
    const existingAuthUserId = await this.repository.findAuthUserId(input.email)
    let authUserId: string
    if (existingAuthUserId) {
      await setSupabaseAuthPassword(this.authConfig, existingAuthUserId, temporaryPassword)
      authUserId = existingAuthUserId
    } else {
      authUserId = await createSupabaseAuthUser(this.authConfig, { ...input, password: temporaryPassword })
    }

    try {
      const id = await withTransaction(this.repository.pool, async (client) => {
        await this.repository.lockSuperadmins(client, actor.user.id)
        const createdId = await this.repository.insert(client, { ...input, authUserId, createdByAdminId: actor.user.id })
        await writeAdminAudit(client, actor, {
          action: 'admin_user.create',
          metadata: { after: { displayName: input.displayName, email: input.email, role: input.role } },
          targetId: createdId,
          targetType: ADMIN_USER_AUDIT_TARGET,
        })
        return createdId
      })
      return { account: await this.repository.getById(id), temporaryPassword }
    } catch (error) {
      if (pgErrorCode(error) === '23505') throw emailTaken()
      throw error
    }
  }

  async update(id: string, input: AdminAccountUpdate, actor: AuditActor): Promise<AdminAccount> {
    await withTransaction(this.repository.pool, async (client) => {
      await this.repository.lockSuperadmins(client, actor.user.id)
      const before = await this.repository.getState(id, client, true)
      if (before.id === actor.user.id && before.role !== input.role) {
        refuseSelf('cannot_change_own_role', 'Bạn không thể tự đổi vai trò của mình.')
      }
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      if (before.display_name !== input.displayName) changes.displayName = { from: before.display_name, to: input.displayName }
      if (before.role !== input.role) changes.role = { from: before.role, to: input.role }
      if (!Object.keys(changes).length) return
      await this.repository.update(client, id, input)
      await writeAdminAudit(client, actor, {
        action: 'admin_user.update',
        metadata: { changes, email: before.email },
        targetId: id,
        targetType: ADMIN_USER_AUDIT_TARGET,
      })
    })
    return this.repository.getById(id)
  }

  // Locking signs the account out at once; its history stays.
  async setActive(id: string, isActive: boolean, actor: AuditActor): Promise<AdminAccount> {
    await withTransaction(this.repository.pool, async (client) => {
      await this.repository.lockSuperadmins(client, actor.user.id)
      const before = await this.repository.getState(id, client, true)
      if (before.id === actor.user.id && !isActive) {
        refuseSelf('cannot_lock_self', 'Bạn không thể tự khóa tài khoản của mình.')
      }
      if (before.is_active === isActive) return
      await this.repository.setActive(client, id, isActive)
      if (!isActive) await this.repository.revokeSessions(client, id)
      await writeAdminAudit(client, actor, {
        action: isActive ? 'admin_user.unlock' : 'admin_user.lock',
        metadata: { email: before.email },
        targetId: id,
        targetType: ADMIN_USER_AUDIT_TARGET,
      })
    })
    return this.repository.getById(id)
  }

  // Sets a new random password and signs the account out everywhere.
  async resetPassword(id: string, actor: AuditActor): Promise<AdminAccountWithPassword> {
    const target = await this.repository.getState(id)
    if (target.id === actor.user.id) {
      refuseSelf('use_change_password', 'Để đổi mật khẩu của chính bạn, hãy dùng nút "Đổi mật khẩu" ở góc tài khoản.')
    }
    const temporaryPassword = generateTemporaryPassword()
    await withTransaction(this.repository.pool, async (client) => {
      await this.repository.lockSuperadmins(client, actor.user.id)
      await setSupabaseAuthPassword(this.authConfig, target.auth_user_id, temporaryPassword)
      await this.repository.revokeSessions(client, id)
      await writeAdminAudit(client, actor, {
        action: 'admin_user.reset_password',
        metadata: { email: target.email },
        targetId: id,
        targetType: ADMIN_USER_AUDIT_TARGET,
      })
    })
    return { account: await this.repository.getById(id), temporaryPassword }
  }
}

import { HttpError } from '../../http/errors.js'
import type { AdminRole, AdminUser } from './authTypes.js'

export const ADMIN_ROLES = ['superadmin', 'admin', 'viewer'] as const satisfies readonly AdminRole[]

// Admins and super admins change content; viewers only read.
export function canManageContent(role: AdminRole) {
  return role === 'admin' || role === 'superadmin'
}

export function isSuperadmin(role: AdminRole) {
  return role === 'superadmin'
}

export function requireSuperadmin(user: AdminUser) {
  if (!isSuperadmin(user.role)) {
    throw new HttpError(403, 'superadmin_required', 'Chỉ Super Admin được quản lý tài khoản quản trị.')
  }
  return user
}

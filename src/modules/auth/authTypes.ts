// superadmin: everything an admin can do, plus managing the admin accounts.
// admin: changes content (sources, reports, settings, exports). viewer: read only.
export type AdminRole = 'superadmin' | 'admin' | 'viewer'

export type AdminUser = {
  displayName: string | null
  email: string
  id: string
  role: AdminRole
}

export type AdminSession = {
  csrfTokenHash: string
  expiresAt: string
  id: string
  user: AdminUser
}

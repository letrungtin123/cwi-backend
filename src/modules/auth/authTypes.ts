export type AdminRole = 'admin' | 'viewer'

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
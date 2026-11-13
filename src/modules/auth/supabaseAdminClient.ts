import type { AuthConfig } from '../../config/runtime.js'
import { HttpError } from '../../http/errors.js'

// Supabase Auth admin API (service role key): creates dashboard login accounts and
// sets their passwords. Passwords are never stored or logged by this backend.

type AdminApiError = { code?: unknown; error_code?: unknown; msg?: unknown; message?: unknown }

function adminApi(config: AuthConfig) {
  if (!config.supabaseAuthUrl || !config.supabaseServiceRoleKey) {
    throw new HttpError(503, 'auth_admin_not_configured', 'Chưa cấu hình quản lý tài khoản đăng nhập trên máy chủ.')
  }
  return {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'content-type': 'application/json',
    },
    url: config.supabaseAuthUrl.replace(/\/+$/, ''),
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as AdminApiError
    return String(body.error_code ?? body.code ?? body.msg ?? body.message ?? '')
  } catch {
    return ''
  }
}

async function failed(response: Response): Promise<never> {
  const reason = await readError(response)
  if (response.status === 422 && /weak_password/i.test(reason)) {
    throw new HttpError(422, 'weak_password', 'Mật khẩu chưa đủ mạnh. Vui lòng chọn mật khẩu dài hơn, có chữ hoa, chữ thường, số và ký tự đặc biệt.')
  }
  if (/email_exists|already been registered/i.test(reason)) {
    throw new HttpError(409, 'auth_email_exists', 'Email này đã có tài khoản đăng nhập.')
  }
  throw new HttpError(502, 'auth_provider_error', 'Không cập nhật được tài khoản đăng nhập. Vui lòng thử lại.')
}

export async function createSupabaseAuthUser(
  config: AuthConfig,
  input: { displayName: string; email: string; password: string },
): Promise<string> {
  const api = adminApi(config)
  const response = await fetch(`${api.url}/admin/users`, {
    body: JSON.stringify({
      email: input.email,
      email_confirm: true,
      password: input.password,
      user_metadata: { display_name: input.displayName },
    }),
    headers: api.headers,
    method: 'POST',
  })
  if (!response.ok) return failed(response)
  const user = (await response.json()) as { id?: unknown }
  if (typeof user.id !== 'string') {
    throw new HttpError(502, 'auth_provider_invalid_response', 'Dịch vụ đăng nhập trả về dữ liệu không hợp lệ. Vui lòng thử lại sau.')
  }
  return user.id
}

export async function setSupabaseAuthPassword(config: AuthConfig, authUserId: string, password: string): Promise<void> {
  const api = adminApi(config)
  const response = await fetch(`${api.url}/admin/users/${encodeURIComponent(authUserId)}`, {
    body: JSON.stringify({ password }),
    headers: api.headers,
    method: 'PUT',
  })
  if (!response.ok) await failed(response)
}

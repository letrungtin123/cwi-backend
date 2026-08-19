import type { AuthConfig } from '../../config/runtime.js'
import { HttpError } from '../../http/errors.js'

type SupabasePasswordResponse = {
  user?: {
    email?: string
    id?: string
  }
}

export type SupabasePasswordUser = {
  email: string
  id: string
}

function getAuthConfig(config: AuthConfig) {
  if (!config.supabaseAuthUrl || !config.supabaseAnonKey) {
    throw new HttpError(503, 'auth_provider_not_configured', 'Authentication provider is not configured.')
  }

  return {
    anonKey: config.supabaseAnonKey,
    url: config.supabaseAuthUrl.replace(/\/+$/, ''),
  }
}

export async function signInWithSupabasePassword(
  config: AuthConfig,
  email: string,
  password: string,
): Promise<SupabasePasswordUser> {
  const { anonKey, url } = getAuthConfig(config)
  const response = await fetch(`${url}/token?grant_type=password`, {
    body: JSON.stringify({ email, password }),
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (response.status === 400 || response.status === 401) {
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.')
  }

  if (!response.ok) {
    throw new HttpError(502, 'auth_provider_error', 'Authentication provider rejected the request.')
  }

  const data = (await response.json()) as SupabasePasswordResponse
  const userId = data.user?.id
  const userEmail = data.user?.email

  if (!userId || !userEmail) {
    throw new HttpError(502, 'auth_provider_invalid_response', 'Authentication provider returned an invalid response.')
  }

  return {
    email: userEmail,
    id: userId,
  }
}
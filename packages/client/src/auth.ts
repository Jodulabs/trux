import { getServerConfig, getStorage } from './ports'

export type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string | null }
  | { mode: 'apikey'; label: string }
export type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'
export interface ProviderInfo { id: string; plane: 'model' | 'machine' }

function authHeaders(): Record<string, string> {
  const token = getStorage().get('trux_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}
function url(path: string): string {
  return getServerConfig().httpBase + path
}
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const authApi = {
  providers: () => fetch(url('/auth/providers'), { headers: authHeaders() }).then(json<ProviderInfo[]>),
  begin: (provider: string) =>
    fetch(url(`/auth/${provider}/begin`), { method: 'POST', headers: authHeaders() }).then(json<AuthMode>),
  poll: (provider: string) =>
    fetch(url(`/auth/${provider}/poll`), { headers: authHeaders() }).then(json<{ status: AuthStatus }>),
  status: (provider: string) =>
    fetch(url(`/auth/${provider}/status`), { headers: authHeaders() }).then(json<{ status: AuthStatus }>),
  disconnect: (provider: string) =>
    fetch(url(`/auth/${provider}/disconnect`), { method: 'POST', headers: authHeaders() }).then(json<{ status: AuthStatus }>),
  submitKey: (provider: string, key: string) =>
    fetch(url(`/auth/${provider}/key`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ key }),
    }).then(json<{ status: AuthStatus }>),
}

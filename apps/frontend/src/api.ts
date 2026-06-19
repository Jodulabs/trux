import type {
  AgentsResponse,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  DiscoveredSession,
  Workspace,
} from '@trux/protocol'

// Optional bearer for remote; empty/absent locally (authRequired off).
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('trux_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const api = {
  listWorkspaces: () => fetch('/workspaces', { headers: authHeaders() }).then(json<Workspace[]>),
  listAgents: () => fetch('/agents', { headers: authHeaders() }).then(json<AgentsResponse>),
  listConversations: () =>
    fetch('/conversations', { headers: authHeaders() }).then(json<Conversation[]>),
  getConversation: (id: string) =>
    fetch(`/conversations/${id}`, { headers: authHeaders() }).then(json<ConversationDetail>),
  createConversation: (body: CreateConversationRequest) =>
    fetch('/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }).then(json<Conversation>),
  getRemoteConfig: () =>
    fetch('/config').then(json<{ tailscaleHost: string | null; vapidPublicKey: string | null }>),
  subscribePush: (sub: PushSubscriptionJSON) =>
    fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(sub),
    }).then(json<{ ok: boolean }>),
  discoverSessions: (agent: string, cwd: string) =>
    fetch(`/sessions/discover?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`, {
      headers: authHeaders(),
    }).then(json<DiscoveredSession[]>),
}

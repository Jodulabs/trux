import type {
  AgentsResponse,
  CommitResult,
  CommandsResponse,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  DiscoveredSession,
  GitStatusResult,
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
  renameConversation: (id: string, title: string) =>
    fetch(`/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title }),
    }).then(json<Conversation>),
  getRemoteConfig: () =>
    fetch('/config').then(json<{ tailscaleHost: string | null; vapidPublicKey: string | null }>),
  subscribePush: (sub: PushSubscriptionJSON) =>
    fetch('/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(sub),
    }).then(json<{ ok: boolean }>),
  searchConversations: (q: string) =>
    fetch(`/conversations/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(json<Conversation[]>),
  discoverSessions: (agent: string, cwd: string) =>
    fetch(`/sessions/discover?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`, {
      headers: authHeaders(),
    }).then(json<DiscoveredSession[]>),
  discoverCommands: (agent: string, cwd: string) =>
    fetch(`/commands/discover?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`, {
      headers: authHeaders(),
    }).then(json<CommandsResponse>),
  gitStatus: (id: string) =>
    fetch(`/conversations/${id}/git`, { headers: authHeaders() }).then(json<GitStatusResult>),
  gitDiff: (id: string, opts?: { path?: string; staged?: boolean }) => {
    const p = new URLSearchParams()
    if (opts?.path) p.set('path', opts.path)
    if (opts?.staged) p.set('staged', '1')
    const qs = p.toString()
    return fetch(`/conversations/${id}/git/diff${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    }).then(json<{ diff: string }>)
  },
  gitStage: (id: string, path: string) =>
    fetch(`/conversations/${id}/git/stage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ path }),
    }).then(json<{ ok: boolean }>),
  gitUnstage: (id: string, path: string) =>
    fetch(`/conversations/${id}/git/unstage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ path }),
    }).then(json<{ ok: boolean }>),
  gitCommit: (id: string, message: string) =>
    fetch(`/conversations/${id}/git/commit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ message }),
    }).then(json<CommitResult>),
}

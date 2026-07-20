import type {
  AgentCatalogResponse,
  CommitResult,
  CommandsResponse,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  CreateProjectRequest,
  DiscoveredSession,
  GitStatusResult,
  PatchProjectRequest,
  Project,
  ProjectDetail,
  Workspace,
} from '@trux/protocol'
import { getServerConfig, getStorage } from './ports'

// Optional bearer for remote; empty/absent locally (authRequired off). The token
// lives in the injected Storage port (localStorage on web, secure-store on native).
function authHeaders(): Record<string, string> {
  const token = getStorage().get('trux_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

// Prefix a path with the configured HTTP base. Web binds httpBase: '' (preserves
// today's same-origin relative fetch); native binds the paired host.
function url(path: string): string {
  return getServerConfig().httpBase + path
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

export const api = {
  listWorkspaces: () => fetch(url('/workspaces'), { headers: authHeaders() }).then(json<Workspace[]>),
  listDirs: (path?: string) => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : ''
    return fetch(url(`/fs/dirs${qs}`), { headers: authHeaders() }).then(
      json<{ path: string; parent: string | null; entries: { name: string; path: string }[] }>,
    )
  },
  getCatalog: () => fetch(url('/catalog'), { headers: authHeaders() }).then(json<AgentCatalogResponse>),
  listConversations: () =>
    fetch(url('/conversations'), { headers: authHeaders() }).then(json<Conversation[]>),
  getConversation: (id: string) =>
    fetch(url(`/conversations/${id}`), { headers: authHeaders() }).then(json<ConversationDetail>),
  createConversation: (body: CreateConversationRequest) =>
    fetch(url('/conversations'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }).then(json<Conversation>),
  renameConversation: (id: string, title: string) =>
    fetch(url(`/conversations/${id}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title }),
    }).then(json<Conversation>),
  // --- Projects ---
  listProjects: () =>
    fetch(url('/projects'), { headers: authHeaders() }).then(json<Project[]>),
  createProject: (body: CreateProjectRequest) =>
    fetch(url('/projects'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }).then(json<Project>),
  getProject: (id: string) =>
    fetch(url(`/projects/${id}`), { headers: authHeaders() }).then(json<ProjectDetail>),
  patchProject: (id: string, patch: PatchProjectRequest) =>
    fetch(url(`/projects/${id}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch),
    }).then(json<Project>),
  deleteProject: (id: string) =>
    fetch(url(`/projects/${id}`), { method: 'DELETE', headers: authHeaders() }).then(json<{ ok: boolean }>),
  getRemoteConfig: () =>
    fetch(url('/config')).then(json<{ tailscaleHost: string | null; vapidPublicKey: string | null; cwd: string }>),
  subscribePush: (sub: PushSubscriptionJSON) =>
    fetch(url('/push/subscribe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(sub),
    }).then(json<{ ok: boolean }>),
  // Native (Expo) devices register a push token instead of a web-push
  // subscription; same route, the backend branches on the body shape.
  subscribeExpoPush: (expoPushToken: string) =>
    fetch(url('/push/subscribe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ expoPushToken }),
    }).then(json<{ ok: boolean }>),
  searchConversations: (q: string) =>
    fetch(url(`/conversations/search?q=${encodeURIComponent(q)}`), { headers: authHeaders() }).then(json<Conversation[]>),
  discoverSessions: (agent: string, cwd: string) =>
    fetch(url(`/sessions/discover?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`), {
      headers: authHeaders(),
    }).then(json<DiscoveredSession[]>),
  discoverCommands: (agent: string, cwd: string) =>
    fetch(url(`/commands/discover?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`), {
      headers: authHeaders(),
    }).then(json<CommandsResponse>),
  gitStatus: (id: string) =>
    fetch(url(`/conversations/${id}/git`), { headers: authHeaders() }).then(json<GitStatusResult>),
  gitDiff: (id: string, opts?: { path?: string; staged?: boolean }) => {
    const p = new URLSearchParams()
    if (opts?.path) p.set('path', opts.path)
    if (opts?.staged) p.set('staged', '1')
    const qs = p.toString()
    return fetch(url(`/conversations/${id}/git/diff${qs ? `?${qs}` : ''}`), {
      headers: authHeaders(),
    }).then(json<{ diff: string }>)
  },
  gitStage: (id: string, path: string) =>
    fetch(url(`/conversations/${id}/git/stage`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ path }),
    }).then(json<{ ok: boolean }>),
  gitUnstage: (id: string, path: string) =>
    fetch(url(`/conversations/${id}/git/unstage`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ path }),
    }).then(json<{ ok: boolean }>),
  gitCommit: (id: string, message: string) =>
    fetch(url(`/conversations/${id}/git/commit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ message }),
    }).then(json<CommitResult>),
}

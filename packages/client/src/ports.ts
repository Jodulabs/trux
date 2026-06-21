export interface Storage {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface ServerConfig {
  httpBase: string
  wsBase: string
}

export interface ClientPorts {
  storage: Storage
  serverConfig: ServerConfig
}

let storage: Storage | null = null
let serverConfig: ServerConfig | null = null

export function configureClient(opts: ClientPorts): void {
  storage = opts.storage
  serverConfig = opts.serverConfig
}

export function getStorage(): Storage {
  if (!storage) throw new Error('configureClient() must be called before using @trux/client')
  return storage
}

export function getServerConfig(): ServerConfig {
  if (!serverConfig) throw new Error('configureClient() must be called before using @trux/client')
  return serverConfig
}

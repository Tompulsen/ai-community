export interface StudioMessageSource {
  title: string
  url: string
  snippet?: string
  number?: number
}

export interface StudioToolActivity {
  id: string
  name: string
  arguments: Record<string, unknown>
  servers: string[]
  status: 'pending' | 'running' | 'complete' | 'error' | 'stopped'
  result?: unknown
  error?: string
  requestId?: string
}

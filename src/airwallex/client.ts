// Thin Airwallex REST client: token cache, per-call API version, 429 backoff and a concurrency cap.
// Amounts on this boundary are in major units (Airwallex convention); the rest of the app uses cents.

export const SANDBOX_BASE_URL = 'https://api.sandbox.airwallex.com'

export interface AirwallexConfig {
  clientId: string
  apiKey: string
  baseUrl?: string
  // Sent only on calls that opt in (simulation endpoints ask for it; FX calls must not send it)
  apiVersion?: string
  fetch?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  maxConcurrent?: number
  maxRetries?: number
}

export interface RequestOptions {
  body?: unknown
  query?: Record<string, string | number | undefined>
  versioned?: boolean
}

export class AirwallexError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(`Airwallex ${status} ${code}: ${message}`)
    this.name = 'AirwallexError'
  }
}

// Refresh a minute early so a token never expires mid-request
const TOKEN_MARGIN_MS = 60_000

export class AirwallexClient {
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxConcurrent: number
  private readonly maxRetries: number
  private token: { value: string; expiresAt: number } | null = null
  private login: Promise<string> | null = null
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly config: AirwallexConfig) {
    if (!config.clientId || !config.apiKey) throw new Error('Missing Airwallex clientId or apiKey')
    this.baseUrl = (config.baseUrl ?? SANDBOX_BASE_URL).replace(/\/$/, '')
    this.fetchFn = config.fetch ?? fetch
    this.now = config.now ?? Date.now
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    // Sandbox allows 10 concurrent requests; stay well below
    this.maxConcurrent = config.maxConcurrent ?? 5
    this.maxRetries = config.maxRetries ?? 3
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, extra: Partial<AirwallexConfig> = {}): AirwallexClient {
    return new AirwallexClient({
      clientId: env.AIRWALLEX_CLIENT_ID ?? '',
      apiKey: env.AIRWALLEX_API_KEY ?? '',
      baseUrl: env.AIRWALLEX_BASE_URL || SANDBOX_BASE_URL,
      apiVersion: env.AIRWALLEX_API_VERSION || undefined,
      ...extra,
    })
  }

  get<T>(path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('GET', path, options)
  }

  post<T>(path: string, body: unknown = {}, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body })
  }

  async request<T>(method: 'GET' | 'POST', path: string, options: RequestOptions = {}): Promise<T> {
    await this.acquire()
    try {
      return await this.send<T>(method, path, options)
    } finally {
      this.release()
    }
  }

  private async send<T>(method: string, path: string, options: RequestOptions): Promise<T> {
    let reauthenticated = false
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken()
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (options.body !== undefined) headers['Content-Type'] = 'application/json'
      if (options.versioned && this.config.apiVersion) headers['x-api-version'] = this.config.apiVersion

      const response = await this.fetchFn(this.url(path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })

      if (response.status === 429 && attempt < this.maxRetries) {
        await this.sleep(retryDelay(response, attempt))
        continue
      }
      if (response.status === 401 && !reauthenticated) {
        // Token revoked or expired early: log in again once
        reauthenticated = true
        this.token = null
        continue
      }
      return parse<T>(response)
    }
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_MARGIN_MS > this.now()) return this.token.value
    // Concurrent callers share one login
    this.login ??= this.authenticate().finally(() => {
      this.login = null
    })
    return this.login
  }

  private async authenticate(): Promise<string> {
    const response = await this.fetchFn(`${this.baseUrl}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': this.config.clientId, 'x-api-key': this.config.apiKey },
    })
    const body = await parse<{ token: string; expires_at?: string }>(response)
    const expiresAt = body.expires_at ? Date.parse(body.expires_at) : NaN
    this.token = { value: body.token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : this.now() + 30 * 60_000 }
    return body.token
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
  }

  private release(): void {
    const next = this.waiting.shift()
    // Hand the slot straight to the next caller; otherwise free it
    if (next) next()
    else this.active--
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'))
  if (Number.isFinite(header) && header > 0) return header * 1000
  return 500 * 2 ** attempt
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let body: any = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const code = typeof body === 'object' && body?.code ? String(body.code) : 'http_error'
    const message = typeof body === 'object' && body?.message ? String(body.message) : String(body ?? response.statusText)
    throw new AirwallexError(response.status, code, message, body)
  }
  return body as T
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const TIMEOUT_MS = 12_000
const MAX_ATTEMPTS = 3
const BACKOFF_MS = [400, 1200]

// Every write in this app is safe to repeat: creates carry a client uid, and
// patches/deletes are idempotent. So a request that fails on a network blip can
// simply be tried again without risking a duplicate.
function retryable(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function fetchWithTimeout(input: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') return body.detail
  } catch {
    // fall through to the generic message
  }
  return 'Something went wrong'
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let last: ApiError = new ApiError(0, "Can't reach assist. Check the server.")
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await fetchWithTimeout(
        path,
        {
          ...init,
          headers: {
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
          },
        },
        TIMEOUT_MS,
      )
    } catch {
      last = new ApiError(0, "Can't reach assist. Check the server.")
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 0)
        continue
      }
      throw last
    }
    if (res.ok) return res.json() as Promise<T>
    last = new ApiError(res.status, await readError(res))
    if (retryable(res.status) && attempt < MAX_ATTEMPTS - 1) {
      await sleep(BACKOFF_MS[attempt] ?? 0)
      continue
    }
    throw last
  }
  throw last
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  let last: ApiError = new ApiError(0, "Can't reach assist. Check the server.")
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await fetchWithTimeout(path, undefined, TIMEOUT_MS)
    } catch {
      last = new ApiError(0, "Can't reach assist. Check the server.")
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt] ?? 0)
        continue
      }
      throw last
    }
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return
    }
    last = new ApiError(res.status, 'Could not export that report')
    if (retryable(res.status) && attempt < MAX_ATTEMPTS - 1) {
      await sleep(BACKOFF_MS[attempt] ?? 0)
      continue
    }
    throw last
  }
  throw last
}

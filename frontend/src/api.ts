export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, "Can't reach assist. Check the server.")
  }
  if (!res.ok) {
    let detail = 'Something went wrong'
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      detail = 'Something went wrong'
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(path)
  } catch {
    throw new ApiError(0, "Can't reach assist. Check the server.")
  }
  if (!res.ok) throw new ApiError(res.status, 'Could not export that report')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

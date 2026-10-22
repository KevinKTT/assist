// Stable client-generated ids. Sending one with a create makes the request safe
// to retry: the server treats the same uid as the same record instead of making
// a duplicate.
export function newUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

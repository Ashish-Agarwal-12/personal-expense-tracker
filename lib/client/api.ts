/** Browser-side wrapper around the /api routes. */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly setupProblems?: string[],
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
/** Called whenever the server says the session has expired. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No internet connection — change not saved.');
  }
  if (res.status === 401 && path !== '/login') {
    onUnauthorized();
    throw new ApiError(401, 'Please log in again.');
  }
  if (res.status === 204) return null as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.setupProblems);
  return data as T;
}

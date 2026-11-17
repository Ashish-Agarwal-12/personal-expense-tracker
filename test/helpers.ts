/** Call a Next.js route handler the way Next.js does, without starting a server. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

export interface CallResult<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function call<T = any>(
  handler: Handler,
  { method = 'GET', body, cookie, params = {}, ip = '203.0.113.7' }: { method?: string; body?: unknown; cookie?: string; params?: Record<string, string>; ip?: string } = {},
): Promise<CallResult<T>> {
  const headers = new Headers({ 'x-real-ip': ip });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const req = new Request('http://localhost/api/test', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

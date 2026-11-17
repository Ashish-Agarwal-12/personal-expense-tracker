import { getContext, SetupError, type ServerContext } from './db';
import { ValidationError } from './validate';

/** Shared plumbing for every /api route: setup checks, login check, JSON parsing, error responses. */

type Params = Record<string, string>;
type Handler<P extends Params> = (req: Request, ctx: ServerContext, params: P) => Promise<Response>;

const MAX_BODY_BYTES = 4_000_000; // Vercel Functions accept request bodies up to 4.5 MB

export const json = (data: unknown, init?: ResponseInit) => Response.json(data, init);
export const noContent = () => new Response(null, { status: 204 });

export function route<P extends Params = Params>(handler: Handler<P>, { auth = true } = {}) {
  return async (req: Request, context: { params: Promise<P> }): Promise<Response> => {
    let ctx: ServerContext;
    try {
      ctx = await getContext();
    } catch (err) {
      if (err instanceof SetupError) {
        return json({ error: 'Server setup problem', setupProblems: err.problems }, { status: 503 });
      }
      console.error('Startup failed:', err);
      return json({ error: 'Server setup problem', setupProblems: ['The server failed to start. Check the Vercel function logs.'] }, { status: 503 });
    }

    try {
      if (auth && !ctx.auth.isAuthed(req.headers.get('cookie'))) return json({ error: 'Please log in' }, { status: 401 });
      return await handler(req, ctx, await context.params);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (err instanceof ValidationError || status === 400) return json({ error: (err as Error).message }, { status: 400 });
      if (status === 404 || status === 409 || status === 413) return json({ error: (err as Error).message }, { status });
      console.error(err);
      return json({ error: 'Something went wrong on the server' }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) throw Object.assign(new Error('Too large'), { status: 413 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw Object.assign(new Error('Too large'), { status: 413 });
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
}

/** Real client IP: Vercel overwrites these headers, so they can't be spoofed there. */
export function clientIp(req: Request): string {
  return req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
}

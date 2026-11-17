import { clientIp, json, readJson, route } from '@/lib/server/route';

export const POST = route(async (req, { auth, limiter }) => {
  const ip = clientIp(req);
  if (await limiter.blocked(ip)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
  const body = (await readJson(req)) as { password?: unknown } | null;
  if (!auth.passwordMatches(body?.password)) {
    await limiter.fail(ip);
    return json({ error: 'Wrong password' }, { status: 401 });
  }
  await limiter.reset(ip);
  return json({ ok: true }, { headers: { 'Set-Cookie': auth.sessionCookie() } });
}, { auth: false });

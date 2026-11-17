import { json, route } from '@/lib/server/route';

export const POST = route(async (_req, { auth }) => json({ ok: true }, { headers: { 'Set-Cookie': auth.clearCookie() } }), { auth: false });

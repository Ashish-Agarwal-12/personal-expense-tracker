import { json, route } from '@/lib/server/route';

export const GET = route(async (req, { auth }) => json({ authenticated: auth.isAuthed(req.headers.get('cookie')) }), { auth: false });

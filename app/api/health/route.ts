import { json, route } from '@/lib/server/route';

/** Public: is the server configured and connected to MongoDB? Used by CI after each deploy. */
export const GET = route(async (_req, { db }) => {
  await db.command({ ping: 1 });
  return json({ ok: true });
}, { auth: false });

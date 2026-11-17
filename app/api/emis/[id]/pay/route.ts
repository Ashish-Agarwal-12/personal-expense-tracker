import { json, readJson, route } from '@/lib/server/route';
import { payEmi } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

/** Body: { month: "YYYY-MM", paid: boolean } */
export const POST = route<{ id: string }>(async (req, { db }, { id }) => {
  const body = (await readJson(req)) as { month?: unknown; paid?: unknown } | null;
  return json(await payEmi(db, v.id(id), v.month(body?.month), !!body?.paid));
});

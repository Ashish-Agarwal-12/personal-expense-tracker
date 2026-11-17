import { json, readJson, route } from '@/lib/server/route';
import { importAll } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

/** Replace everything with a backup file (or data from the old offline version). */
export const POST = route(async (req, { db }) => {
  const data = v.backup(await readJson(req));
  await importAll(db, data);
  return json({ ok: true, expenses: data.expenses.length, emis: data.emis.length });
});

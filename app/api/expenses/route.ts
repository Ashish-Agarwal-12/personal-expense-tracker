import { json, readJson, route } from '@/lib/server/route';
import { insertItem } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

export const POST = route(async (req, { db }) => {
  const item = v.expense(await readJson(req));
  await insertItem(db, 'expenses', item);
  return json(item, { status: 201 });
});

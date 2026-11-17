import { json, noContent, readJson, route } from '@/lib/server/route';
import { deleteItem, replaceItem } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

export const PUT = route<{ id: string }>(async (req, { db }, { id }) => {
  const item = v.category({ ...(await readJson(req) as object), id });
  await replaceItem(db, 'categories', item);
  return json(item);
});

export const DELETE = route<{ id: string }>(async (_req, { db }, { id }) => {
  await deleteItem(db, 'categories', v.id(id));
  return noContent();
});

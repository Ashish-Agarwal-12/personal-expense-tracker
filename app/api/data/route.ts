import { json, noContent, route } from '@/lib/server/route';
import { eraseAll, getData } from '@/lib/server/store';

export const GET = route(async (_req, { db }) => json(await getData(db)));

/** Erase everything and go back to the starter categories. */
export const DELETE = route(async (_req, { db }) => {
  await eraseAll(db);
  return noContent();
});

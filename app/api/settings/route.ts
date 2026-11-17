import { json, readJson, route } from '@/lib/server/route';
import { saveSettings } from '@/lib/server/store';
import * as v from '@/lib/server/validate';

export const PUT = route(async (req, { db }) => {
  const s = v.settings(await readJson(req));
  await saveSettings(db, s);
  return json(s);
});

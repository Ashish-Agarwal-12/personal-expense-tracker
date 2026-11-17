import type { Db, Document } from 'mongodb';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, type AppData, type Category, type Emi, type Expense, type Settings } from '@/lib/types';

/** All MongoDB reads and writes. Our string `id` is stored as `_id`; callers only ever see `id`. */

const SETTINGS_ID = 'settings';
type WithStrId<T> = Omit<T, 'id'> & { _id: string };

export type ListName = 'expenses' | 'emis' | 'categories';
type ListItem = { expenses: Expense; emis: Emi; categories: Category };

const toDoc = <T extends { id: string }>({ id, ...rest }: T) => ({ _id: id, ...rest }) as unknown as WithStrId<T>;
const fromDoc = <T extends { id: string }>({ _id, ...rest }: WithStrId<T>) => ({ id: _id, ...rest }) as unknown as T;

const settingsCol = (db: Db) => db.collection<Settings & { _id: string }>('settings');
const listCol = <N extends ListName>(db: Db, name: N) => db.collection<WithStrId<ListItem[N]>>(name);
/** Untyped handle for the generic helpers below (input is already validated). */
const rawCol = (db: Db, name: ListName) => db.collection<{ _id: string } & Document>(name);
export const loginAttempts = (db: Db) => db.collection<{ _id: string; count: number; expireAt: Date }>('login_attempts');

export class ConflictError extends Error {
  readonly status = 409;
}
export class NotFoundError extends Error {
  readonly status = 404;
}

/** Make sure a fresh database has settings and the starter categories. Safe to call repeatedly. */
export async function ensureInitialized(db: Db): Promise<void> {
  const r = await settingsCol(db).updateOne({ _id: SETTINGS_ID }, { $setOnInsert: { ...DEFAULT_SETTINGS } }, { upsert: true });
  if (r.upsertedCount) {
    await listCol(db, 'categories')
      .insertMany(DEFAULT_CATEGORIES.map(toDoc))
      .catch((e: { code?: number }) => {
        if (e.code !== 11000) throw e; // another instance already seeded them
      });
  }
}

export async function ensureIndexes(db: Db): Promise<void> {
  await listCol(db, 'expenses').createIndex({ date: -1 });
  // Failed-login counters delete themselves when their window ends.
  await loginAttempts(db).createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
}

export async function getData(db: Db): Promise<AppData> {
  const [s, categories, expenses, emis] = await Promise.all([
    settingsCol(db).findOne({ _id: SETTINGS_ID }),
    listCol(db, 'categories').find().toArray(),
    listCol(db, 'expenses').find().sort({ date: -1, createdAt: -1 }).toArray(),
    listCol(db, 'emis').find().toArray(),
  ]);
  const { _id, ...settings } = s ?? { _id: SETTINGS_ID, ...DEFAULT_SETTINGS };
  return {
    settings,
    categories: categories.map((d) => fromDoc<Category>(d)),
    expenses: expenses.map((d) => fromDoc<Expense>(d)),
    emis: emis.map((d) => fromDoc<Emi>(d)),
  };
}

export async function saveSettings(db: Db, s: Settings): Promise<void> {
  await settingsCol(db).updateOne({ _id: SETTINGS_ID }, { $set: s }, { upsert: true });
}

export async function insertItem<N extends ListName>(db: Db, name: N, item: ListItem[N]): Promise<void> {
  try {
    await rawCol(db, name).insertOne(toDoc(item));
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ConflictError('Already exists');
    throw e;
  }
}

export async function replaceItem<N extends ListName>(db: Db, name: N, item: ListItem[N]): Promise<void> {
  const r = await rawCol(db, name).replaceOne({ _id: item.id }, toDoc(item));
  if (!r.matchedCount) throw new NotFoundError('Not found');
}

export async function deleteItem(db: Db, name: ListName, id: string): Promise<void> {
  if (name === 'categories') {
    const used = await listCol(db, 'expenses').findOne({ categoryId: id }, { projection: { _id: 1 } });
    if (used) throw new ConflictError('This category has expenses — set its limit instead of deleting it.');
  }
  await rawCol(db, name).deleteOne({ _id: id });
}

/** Mark (or unmark) an EMI as paid for a month, atomically, so two devices can't double-count. */
export async function payEmi(db: Db, id: string, month: string, paid: boolean): Promise<Emi> {
  const col = db.collection<WithStrId<Emi>>('emis');
  if (paid) {
    await col.updateOne(
      { _id: id, payments: { $ne: month }, $expr: { $lt: ['$paidMonths', '$totalMonths'] } },
      { $push: { payments: month }, $inc: { paidMonths: 1 } },
    );
  } else {
    await col.updateOne({ _id: id, payments: month }, [
      { $set: { payments: { $setDifference: ['$payments', [month]] }, paidMonths: { $max: [0, { $subtract: ['$paidMonths', 1] }] } } },
    ]);
  }
  const doc = await col.findOne({ _id: id });
  if (!doc) throw new NotFoundError('Not found');
  return fromDoc<Emi>(doc);
}

/** Replace everything with a backup (also used to move old browser-only data into the database). */
export async function importAll(db: Db, data: AppData): Promise<void> {
  const categories = data.categories.length ? data.categories : DEFAULT_CATEGORIES;
  await Promise.all((['categories', 'expenses', 'emis'] as const).map((n) => listCol(db, n).deleteMany({})));
  await settingsCol(db).replaceOne({ _id: SETTINGS_ID }, data.settings, { upsert: true });
  await listCol(db, 'categories').insertMany(categories.map(toDoc));
  if (data.expenses.length) await listCol(db, 'expenses').insertMany(data.expenses.map(toDoc));
  if (data.emis.length) await listCol(db, 'emis').insertMany(data.emis.map(toDoc));
}

export async function eraseAll(db: Db): Promise<void> {
  await Promise.all([settingsCol(db).deleteMany({}), ...(['categories', 'expenses', 'emis'] as const).map((n) => listCol(db, n).deleteMany({}))]);
  await ensureInitialized(db);
}

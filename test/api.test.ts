import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import * as categoriesId from '@/app/api/categories/[id]/route';
import * as data from '@/app/api/data/route';
import * as emis from '@/app/api/emis/route';
import * as emisId from '@/app/api/emis/[id]/route';
import * as pay from '@/app/api/emis/[id]/pay/route';
import * as expenses from '@/app/api/expenses/route';
import * as expensesId from '@/app/api/expenses/[id]/route';
import * as health from '@/app/api/health/route';
import * as importRoute from '@/app/api/import/route';
import * as login from '@/app/api/login/route';
import * as logout from '@/app/api/logout/route';
import * as session from '@/app/api/session/route';
import * as settings from '@/app/api/settings/route';
import { getContext, resetContextForTests } from '@/lib/server/db';
import { ensureInitialized, upgradeCategories } from '@/lib/server/store';
import { DEFAULT_CATEGORIES, OLD_EATING_NAME } from '@/lib/types';
import { call } from './helpers';

const PASSWORD = 'correct-horse-battery';
let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri();
  process.env.MONGODB_DB = 'api_test';
  process.env.APP_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = 'test-secret-at-least-16-chars';
});

afterAll(async () => {
  await resetContextForTests();
  await mem.stop();
});

beforeEach(async () => {
  const { db } = await getContext();
  await db.dropDatabase();
  await ensureInitialized(db);
});

async function signIn(): Promise<string> {
  const r = await call(login.POST, { method: 'POST', body: { password: PASSWORD } });
  expect(r.status).toBe(200);
  return r.headers.get('set-cookie')!.split(';')[0];
}

const expense = (over = {}) => ({ id: 'e1', amount: 250, categoryId: 'food', method: 'upi', date: '2026-11-18', note: 'milk', ...over });
const emi = (over = {}) => ({ id: 'm1', name: 'HDFC loan', lender: 'HDFC', kind: 'personal', amount: 14500, dueDay: 5, totalMonths: 12, paidMonths: 10, rate: 14, ...over });

describe('auth', () => {
  test('health check works without login', async () => {
    expect((await call(health.GET)).body).toEqual({ ok: true });
  });

  test('data is not readable or writable without logging in', async () => {
    expect((await call(data.GET)).status).toBe(401);
    expect((await call(expenses.POST, { method: 'POST', body: expense() })).status).toBe(401);
    expect((await call(session.GET)).body).toEqual({ authenticated: false });
  });

  test('wrong password is rejected; right password sets an HttpOnly, SameSite=Strict cookie', async () => {
    expect((await call(login.POST, { method: 'POST', body: { password: 'nope' } })).status).toBe(401);
    const r = await call(login.POST, { method: 'POST', body: { password: PASSWORD } });
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await call(session.GET, { cookie: cookie.split(';')[0] })).body).toEqual({ authenticated: true });
  });

  test('login is blocked after 10 wrong passwords (counter stored in MongoDB)', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await call(login.POST, { method: 'POST', body: { password: 'guess' + i } })).status).toBe(401);
    }
    expect((await call(login.POST, { method: 'POST', body: { password: PASSWORD } })).status).toBe(429);
    // A different IP is not affected.
    expect((await call(login.POST, { method: 'POST', body: { password: PASSWORD }, ip: '198.51.100.1' })).status).toBe(200);
    const { db } = await getContext();
    const counter = await db.collection('login_attempts').findOne({ _id: '203.0.113.7' as never });
    expect(counter?.count).toBe(10);
    expect(counter?.expireAt > new Date()).toBe(true);
  });

  test('forged session cookie is rejected', async () => {
    expect((await call(data.GET, { cookie: 'sid=99999999999999.forgedsignature' })).status).toBe(401);
  });

  test('logout clears the session cookie', async () => {
    expect((await call(logout.POST, { method: 'POST' })).headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  test('malformed JSON is a 400, not a crash', async () => {
    const cookie = await signIn();
    expect((await call(expenses.POST, { method: 'POST', body: '{not json', cookie })).status).toBe(400);
  });
});

describe('data', () => {
  test('fresh database has default categories and zero settings', async () => {
    const cookie = await signIn();
    const { body } = await call(data.GET, { cookie });
    expect(body.categories).toHaveLength(12);
    expect(body.categories.map((c: { id: string }) => c.id)).toEqual(DEFAULT_CATEGORIES.map((c) => c.id));
    expect(body.settings.income).toBe(0);
    expect(body.expenses).toEqual([]);
  });

  test('settings can be saved and read back', async () => {
    const cookie = await signIn();
    const s = { income: 60000, fixedBills: 12000, savingsGoal: 3000, ccLimit: 2000 };
    expect((await call(settings.PUT, { method: 'PUT', body: s, cookie })).status).toBe(200);
    expect((await call(data.GET, { cookie })).body.settings).toEqual(s);
  });

  test('expenses: add, duplicate, list, delete', async () => {
    const cookie = await signIn();
    expect((await call(expenses.POST, { method: 'POST', body: expense(), cookie })).status).toBe(201);
    expect((await call(expenses.POST, { method: 'POST', body: expense(), cookie })).status).toBe(409);
    let d = (await call(data.GET, { cookie })).body;
    expect(d.expenses).toHaveLength(1);
    expect(d.expenses[0].id).toBe('e1');
    expect(d.expenses[0]._id).toBeUndefined();
    expect((await call(expensesId.DELETE, { method: 'DELETE', params: { id: 'e1' }, cookie })).status).toBe(204);
    d = (await call(data.GET, { cookie })).body;
    expect(d.expenses).toHaveLength(0);
  });

  test('invalid expenses are rejected', async () => {
    const cookie = await signIn();
    for (const bad of [
      expense({ amount: -5 }),
      expense({ amount: 'abc' }),
      expense({ method: 'bitcoin' }),
      expense({ date: '18/11/2026' }),
      expense({ id: { $gt: '' } }),
      expense({ note: 'x'.repeat(200) }),
    ]) {
      expect((await call(expenses.POST, { method: 'POST', body: bad, cookie })).status, JSON.stringify(bad)).toBe(400);
    }
  });

  test('EMI mark paid / undo is counted once and capped at tenure', async () => {
    const cookie = await signIn();
    await call(emis.POST, { method: 'POST', body: emi(), cookie });
    const payFor = (month: string, paid: boolean) => call(pay.POST, { method: 'POST', params: { id: 'm1' }, body: { month, paid }, cookie });
    expect((await payFor('2026-11', true)).body.paidMonths).toBe(11);
    expect((await payFor('2026-11', true)).body.paidMonths).toBe(11); // same month twice: no double count
    expect((await payFor('2026-12', true)).body.paidMonths).toBe(12);
    expect((await payFor('2027-01', true)).body.paidMonths).toBe(12); // can't pay beyond tenure
    const r = await payFor('2026-12', false);
    expect(r.body.paidMonths).toBe(11);
    expect(r.body.payments).toEqual(['2026-11']);
    expect((await payFor('bad-month', true)).status).toBe(400);
  });

  test('EMI edit and delete', async () => {
    const cookie = await signIn();
    await call(emis.POST, { method: 'POST', body: emi(), cookie });
    expect((await call(emisId.PUT, { method: 'PUT', params: { id: 'm1' }, body: emi({ amount: 9000 }), cookie })).body.amount).toBe(9000);
    expect((await call(emisId.PUT, { method: 'PUT', params: { id: 'nope' }, body: emi(), cookie })).status).toBe(404);
    expect((await call(emis.POST, { method: 'POST', body: emi({ id: 'm2', paidMonths: 20 }), cookie })).status).toBe(400);
    await call(emisId.DELETE, { method: 'DELETE', params: { id: 'm1' }, cookie });
    expect((await call(data.GET, { cookie })).body.emis).toHaveLength(0);
  });

  test('category in use cannot be deleted', async () => {
    const cookie = await signIn();
    await call(expenses.POST, { method: 'POST', body: expense(), cookie });
    expect((await call(categoriesId.DELETE, { method: 'DELETE', params: { id: 'food' }, cookie })).status).toBe(409);
    expect((await call(categoriesId.DELETE, { method: 'DELETE', params: { id: 'health' }, cookie })).status).toBe(204);
  });

  test('import replaces everything; erase resets to defaults', async () => {
    const cookie = await signIn();
    await call(expenses.POST, { method: 'POST', body: expense(), cookie });
    const backup = {
      settings: { income: 50000 },
      categories: [{ id: 'food', name: 'Food', icon: '🛒', limit: 5000 }],
      expenses: [expense({ id: 'x1' }), expense({ id: 'x2', amount: 99 })],
      emis: [emi()],
    };
    expect((await call(importRoute.POST, { method: 'POST', body: backup, cookie })).status).toBe(200);
    let d = (await call(data.GET, { cookie })).body;
    expect(d.expenses.map((e: { id: string }) => e.id).sort()).toEqual(['x1', 'x2']);
    expect(d.categories).toHaveLength(1);
    expect(d.settings.income).toBe(50000);

    expect((await call(data.DELETE, { method: 'DELETE', cookie })).status).toBe(204);
    d = (await call(data.GET, { cookie })).body;
    expect(d.expenses).toHaveLength(0);
    expect(d.emis).toHaveLength(0);
    expect(d.categories).toHaveLength(12);
  });
});

describe('category upgrade for existing databases', () => {
  /** A database exactly as the previous version of the app left it: the 8 old categories, no upgrade record. */
  async function oldDatabase(eatingName = OLD_EATING_NAME) {
    const { db } = await getContext();
    await db.dropDatabase();
    await db.collection('settings').insertOne({ _id: 'settings' as never, income: 60000, fixedBills: 0, savingsGoal: 0, ccLimit: 0 });
    const old = ['food', 'eating', 'transport', 'shopping', 'entertainment', 'health', 'family', 'other'];
    await db.collection('categories').insertMany(
      old.map((id) => ({ _id: id as never, name: id === 'eating' ? eatingName : id, icon: '📦', limit: id === 'food' ? 8000 : 0 })),
    );
    return db;
  }

  test('adds Blinkit, Zepto, Swiggy and Zomato and renames the old combined category', async () => {
    const db = await oldDatabase();
    await upgradeCategories(db);
    const cookie = await signIn();
    const cats = (await call(data.GET, { cookie })).body.categories as { id: string; name: string; limit: number }[];
    expect(cats.map((c) => c.id)).toEqual(['food', 'blinkit', 'zepto', 'swiggy', 'zomato', 'eating', 'transport', 'shopping', 'entertainment', 'health', 'family', 'other']);
    expect(cats.find((c) => c.id === 'eating')!.name).toBe('Eating out / Restaurants');
    expect(cats.find((c) => c.id === 'food')!.limit).toBe(8000); // your existing limits are kept
  });

  test('keeps a category name you changed yourself', async () => {
    const db = await oldDatabase('Restaurants & cafes');
    await upgradeCategories(db);
    const eating = await db.collection('categories').findOne({ _id: 'eating' as never });
    expect(eating!.name).toBe('Restaurants & cafes');
  });

  test('runs once: a new category you delete does not come back', async () => {
    const db = await oldDatabase();
    await upgradeCategories(db);
    const cookie = await signIn();
    expect((await call(categoriesId.DELETE, { method: 'DELETE', params: { id: 'zepto' }, cookie })).status).toBe(204);
    await upgradeCategories(db);
    const cats = (await call(data.GET, { cookie })).body.categories as { id: string }[];
    expect(cats.map((c) => c.id)).not.toContain('zepto');
  });

  test('does not overwrite a category that already has the same id', async () => {
    const db = await oldDatabase();
    await db.collection('categories').insertOne({ _id: 'swiggy' as never, name: 'My Swiggy', icon: '🍜', limit: 1500 });
    await upgradeCategories(db);
    const swiggy = await db.collection('categories').findOne({ _id: 'swiggy' as never });
    expect(swiggy).toMatchObject({ name: 'My Swiggy', limit: 1500 });
  });
});

'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { createApp, ensureInitialized } = require('../server/app');

const PASSWORD = 'correct-horse-battery';
let mem, client, db, server, base;

before(async () => {
  mem = await MongoMemoryServer.create();
  client = await MongoClient.connect(mem.getUri());
  db = client.db('test');
  const app = createApp({ db, password: PASSWORD, secret: 'test-secret-at-least-16-chars' });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await client.close();
  await mem.stop();
});

beforeEach(async () => {
  await db.dropDatabase();
  await ensureInitialized(db);
});

/** Tiny HTTP helper; pass a cookie to act as a logged-in user. */
async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login() {
  const r = await call('POST', '/api/login', { body: { password: PASSWORD } });
  assert.equal(r.status, 200);
  return r.headers.get('set-cookie').split(';')[0];
}

const expense = (over = {}) => ({ id: 'e1', amount: 250, categoryId: 'food', method: 'upi', date: '2026-11-18', note: 'milk', ...over });
const emi = (over = {}) => ({ id: 'm1', name: 'HDFC loan', lender: 'HDFC', kind: 'personal', amount: 14500, dueDay: 5, totalMonths: 12, paidMonths: 10, rate: 14, ...over });

/* ---------------- auth ---------------- */

test('health check works without login', async () => {
  assert.deepEqual((await call('GET', '/api/health')).body, { ok: true });
});

test('data is not readable without logging in', async () => {
  assert.equal((await call('GET', '/api/data')).status, 401);
  assert.equal((await call('POST', '/api/expenses', { body: expense() })).status, 401);
});

test('wrong password is rejected, right password sets a secure-ish cookie', async () => {
  assert.equal((await call('POST', '/api/login', { body: { password: 'nope' } })).status, 401);
  const r = await call('POST', '/api/login', { body: { password: PASSWORD } });
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('login is blocked after 10 wrong passwords (counter stored in MongoDB)', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('POST', '/api/login', { body: { password: 'guess' + i } })).status, 401);
  }
  assert.equal((await call('POST', '/api/login', { body: { password: PASSWORD } })).status, 429, 'even the right password is blocked');
  const counter = await db.collection('login_attempts').findOne({});
  assert.equal(counter.count, 10);
  assert.ok(counter.expireAt > new Date(), 'counter expires by itself');
});

test('forged session cookie is rejected', async () => {
  const cookie = 'sid=99999999999999.forgedsignature';
  assert.equal((await call('GET', '/api/data', { cookie })).status, 401);
});

test('logout clears the session cookie', async () => {
  const r = await call('POST', '/api/logout');
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

/* ---------------- data ---------------- */

test('fresh database has default categories and zero settings', async () => {
  const cookie = await login();
  const { body } = await call('GET', '/api/data', { cookie });
  assert.equal(body.categories.length, 8);
  assert.equal(body.settings.income, 0);
  assert.deepEqual(body.expenses, []);
});

test('settings can be saved and read back', async () => {
  const cookie = await login();
  const s = { income: 60000, fixedBills: 12000, savingsGoal: 3000, ccLimit: 2000 };
  assert.equal((await call('PUT', '/api/settings', { cookie, body: s })).status, 200);
  assert.deepEqual((await call('GET', '/api/data', { cookie })).body.settings, s);
});

test('expenses: add, list, delete', async () => {
  const cookie = await login();
  assert.equal((await call('POST', '/api/expenses', { cookie, body: expense() })).status, 201);
  assert.equal((await call('POST', '/api/expenses', { cookie, body: expense() })).status, 409, 'duplicate id');
  let data = (await call('GET', '/api/data', { cookie })).body;
  assert.equal(data.expenses.length, 1);
  assert.equal(data.expenses[0].id, 'e1');
  assert.equal(data.expenses[0]._id, undefined, 'Mongo _id is not leaked');
  assert.equal((await call('DELETE', '/api/expenses/e1', { cookie })).status, 204);
  data = (await call('GET', '/api/data', { cookie })).body;
  assert.equal(data.expenses.length, 0);
});

test('invalid expenses are rejected', async () => {
  const cookie = await login();
  for (const bad of [
    expense({ amount: -5 }),
    expense({ amount: 'abc' }),
    expense({ method: 'bitcoin' }),
    expense({ date: '18/11/2026' }),
    expense({ id: { $gt: '' } }),
    expense({ note: 'x'.repeat(200) }),
  ]) {
    const r = await call('POST', '/api/expenses', { cookie, body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test('EMI mark paid / undo is counted once and capped at tenure', async () => {
  const cookie = await login();
  await call('POST', '/api/emis', { cookie, body: emi() });
  let r = await call('POST', '/api/emis/m1/pay', { cookie, body: { month: '2026-11', paid: true } });
  assert.equal(r.body.paidMonths, 11);
  r = await call('POST', '/api/emis/m1/pay', { cookie, body: { month: '2026-11', paid: true } });
  assert.equal(r.body.paidMonths, 11, 'paying the same month twice does not double count');
  r = await call('POST', '/api/emis/m1/pay', { cookie, body: { month: '2026-12', paid: true } });
  assert.equal(r.body.paidMonths, 12);
  r = await call('POST', '/api/emis/m1/pay', { cookie, body: { month: '2027-01', paid: true } });
  assert.equal(r.body.paidMonths, 12, 'cannot pay beyond tenure');
  r = await call('POST', '/api/emis/m1/pay', { cookie, body: { month: '2026-12', paid: false } });
  assert.equal(r.body.paidMonths, 11);
  assert.deepEqual(r.body.payments, ['2026-11']);
});

test('EMI edit and delete', async () => {
  const cookie = await login();
  await call('POST', '/api/emis', { cookie, body: emi() });
  const r = await call('PUT', '/api/emis/m1', { cookie, body: emi({ amount: 9000 }) });
  assert.equal(r.body.amount, 9000);
  assert.equal((await call('PUT', '/api/emis/nope', { cookie, body: emi() })).status, 404);
  assert.equal((await call('POST', '/api/emis', { cookie, body: emi({ id: 'm2', paidMonths: 20 }) })).status, 400, 'paid > tenure');
  await call('DELETE', '/api/emis/m1', { cookie });
  assert.equal((await call('GET', '/api/data', { cookie })).body.emis.length, 0);
});

test('category in use cannot be deleted', async () => {
  const cookie = await login();
  await call('POST', '/api/expenses', { cookie, body: expense() });
  assert.equal((await call('DELETE', '/api/categories/food', { cookie })).status, 409);
  assert.equal((await call('DELETE', '/api/categories/health', { cookie })).status, 204);
});

test('import replaces everything; erase resets to defaults', async () => {
  const cookie = await login();
  await call('POST', '/api/expenses', { cookie, body: expense() });
  const backup = {
    settings: { income: 50000 },
    categories: [{ id: 'food', name: 'Food', icon: '🛒', limit: 5000 }],
    expenses: [expense({ id: 'x1' }), expense({ id: 'x2', amount: 99 })],
    emis: [emi()],
  };
  assert.equal((await call('POST', '/api/import', { cookie, body: backup })).status, 200);
  let data = (await call('GET', '/api/data', { cookie })).body;
  assert.deepEqual(data.expenses.map((e) => e.id).sort(), ['x1', 'x2']);
  assert.equal(data.categories.length, 1);
  assert.equal(data.settings.income, 50000);

  assert.equal((await call('DELETE', '/api/data', { cookie })).status, 204);
  data = (await call('GET', '/api/data', { cookie })).body;
  assert.equal(data.expenses.length, 0);
  assert.equal(data.emis.length, 0);
  assert.equal(data.categories.length, 8);
});

test('website is served with security headers', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Debt-Free Tracker/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

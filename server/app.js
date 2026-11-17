'use strict';

const path = require('path');
const express = require('express');
const v = require('./validate');
const { createAuth, createLoginLimiter } = require('./auth');

const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food & Groceries', icon: '🛒', limit: 0 },
  { id: 'eating', name: 'Eating out / Swiggy / Zomato', icon: '🍔', limit: 0 },
  { id: 'transport', name: 'Transport & Fuel', icon: '⛽', limit: 0 },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', limit: 0 },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬', limit: 0 },
  { id: 'health', name: 'Health & Medicine', icon: '💊', limit: 0 },
  { id: 'family', name: 'Family & Gifts', icon: '🎁', limit: 0 },
  { id: 'other', name: 'Other', icon: '📦', limit: 0 },
];
const DEFAULT_SETTINGS = { income: 0, fixedBills: 0, savingsGoal: 0, ccLimit: 0 };
const SETTINGS_ID = 'settings';

// MongoDB stores our string id as _id; the browser only ever sees `id`.
const toDoc = ({ id, ...rest }) => ({ _id: id, ...rest });
const fromDoc = ({ _id, ...rest }) => ({ id: _id, ...rest });

/** Make sure a fresh database has settings and the starter categories. Safe to call repeatedly. */
async function ensureInitialized(db) {
  const r = await db.collection('settings').updateOne(
    { _id: SETTINGS_ID },
    { $setOnInsert: { ...DEFAULT_SETTINGS } },
    { upsert: true },
  );
  if (r.upsertedCount) {
    await db.collection('categories').insertMany(DEFAULT_CATEGORIES.map(toDoc)).catch((e) => {
      if (e.code !== 11000) throw e; // another instance already seeded them
    });
  }
}

async function ensureIndexes(db) {
  await db.collection('expenses').createIndex({ date: -1 });
}

function createApp({ db, password, secret, secureCookies = false, publicDir = path.join(__dirname, '..', 'public') }) {
  const auth = createAuth({ password, secret, secureCookies });
  const limiter = createLoginLimiter();
  const col = {
    settings: db.collection('settings'),
    categories: db.collection('categories'),
    expenses: db.collection('expenses'),
    emis: db.collection('emis'),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy: req.ip is the real client

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  // Wraps async route handlers so thrown errors reach the error middleware.
  const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* ---------- public endpoints ---------- */
  app.get('/api/health', h(async (req, res) => {
    await db.command({ ping: 1 });
    res.json({ ok: true });
  }));

  app.get('/api/session', (req, res) => res.json({ authenticated: auth.isAuthed(req) }));

  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    if (limiter.blocked(ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    if (!auth.passwordMatches(req.body && req.body.password)) {
      limiter.fail(ip);
      return res.status(401).json({ error: 'Wrong password' });
    }
    limiter.reset(ip);
    auth.setSession(res);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    auth.clearSession(res);
    res.json({ ok: true });
  });

  /* ---------- everything below needs a session ---------- */
  app.use('/api', auth.requireAuth);

  app.get('/api/data', h(async (req, res) => {
    const [settings, categories, expenses, emis] = await Promise.all([
      col.settings.findOne({ _id: SETTINGS_ID }),
      col.categories.find().toArray(),
      col.expenses.find().sort({ date: -1, createdAt: -1 }).toArray(),
      col.emis.find().toArray(),
    ]);
    const { _id, ...s } = settings || { _id: null, ...DEFAULT_SETTINGS };
    res.json({ settings: s, categories: categories.map(fromDoc), expenses: expenses.map(fromDoc), emis: emis.map(fromDoc) });
  }));

  app.put('/api/settings', h(async (req, res) => {
    const s = v.settings(req.body);
    await col.settings.updateOne({ _id: SETTINGS_ID }, { $set: s }, { upsert: true });
    res.json(s);
  }));

  // Generic create / replace / delete for the three list collections.
  function crud(name, validate) {
    const c = col[name];
    app.post(`/api/${name}`, h(async (req, res) => {
      const item = validate(req.body);
      try {
        await c.insertOne(toDoc(item));
      } catch (e) {
        if (e.code === 11000) return res.status(409).json({ error: 'Already exists' });
        throw e;
      }
      res.status(201).json(item);
    }));
    app.put(`/api/${name}/:id`, h(async (req, res) => {
      const item = validate({ ...req.body, id: req.params.id });
      const r = await c.replaceOne({ _id: item.id }, toDoc(item));
      if (!r.matchedCount) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    }));
  }

  crud('expenses', v.expense);
  crud('emis', v.emi);
  crud('categories', v.category);

  app.delete('/api/expenses/:id', h(async (req, res) => {
    await col.expenses.deleteOne({ _id: v.id(req.params.id) });
    res.status(204).end();
  }));

  app.delete('/api/emis/:id', h(async (req, res) => {
    await col.emis.deleteOne({ _id: v.id(req.params.id) });
    res.status(204).end();
  }));

  app.delete('/api/categories/:id', h(async (req, res) => {
    const catId = v.id(req.params.id);
    if (await col.expenses.findOne({ categoryId: catId }, { projection: { _id: 1 } })) {
      return res.status(409).json({ error: 'This category has expenses — set its limit instead of deleting it.' });
    }
    await col.categories.deleteOne({ _id: catId });
    res.status(204).end();
  }));

  /** Mark (or unmark) an EMI as paid for a month. Done in one atomic update so two devices can't double-count. */
  app.post('/api/emis/:id/pay', h(async (req, res) => {
    const emiId = v.id(req.params.id);
    const month = v.month(req.body && req.body.month);
    const paid = !!(req.body && req.body.paid);
    if (paid) {
      await col.emis.updateOne(
        { _id: emiId, payments: { $ne: month }, $expr: { $lt: ['$paidMonths', '$totalMonths'] } },
        { $push: { payments: month }, $inc: { paidMonths: 1 } },
      );
    } else {
      await col.emis.updateOne({ _id: emiId, payments: month }, [
        { $set: { payments: { $setDifference: ['$payments', [month]] }, paidMonths: { $max: [0, { $subtract: ['$paidMonths', 1] }] } } },
      ]);
    }
    const doc = await col.emis.findOne({ _id: emiId });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(fromDoc(doc));
  }));

  /** Replace everything with a backup (also used to move old browser-only data into the database). */
  app.post('/api/import', h(async (req, res) => {
    const data = v.backup(req.body);
    if (!data.categories.length) data.categories = DEFAULT_CATEGORIES;
    await Promise.all([col.categories.deleteMany({}), col.expenses.deleteMany({}), col.emis.deleteMany({})]);
    await col.settings.replaceOne({ _id: SETTINGS_ID }, data.settings, { upsert: true });
    if (data.categories.length) await col.categories.insertMany(data.categories.map(toDoc));
    if (data.expenses.length) await col.expenses.insertMany(data.expenses.map(toDoc));
    if (data.emis.length) await col.emis.insertMany(data.emis.map(toDoc));
    res.json({ ok: true, expenses: data.expenses.length, emis: data.emis.length });
  }));

  app.delete('/api/data', h(async (req, res) => {
    await Promise.all(Object.values(col).map((c) => c.deleteMany({})));
    await ensureInitialized(db);
    res.status(204).end();
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  /* ---------- website ---------- */
  app.use(express.static(publicDir, { index: 'index.html', maxAge: 0 }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status === 400 || err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: err.message || 'Bad request' });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Too large' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}

module.exports = { createApp, ensureInitialized, ensureIndexes, DEFAULT_CATEGORIES };

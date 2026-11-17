'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { checkConfig, explainDbError } = require('../server/startup');

const good = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/',
  APP_PASSWORD: 'long-enough',
  SESSION_SECRET: '0123456789abcdef0123',
};

test('valid config has no problems', () => {
  assert.deepEqual(checkConfig(good), []);
});

test('each config mistake gets its own clear message', () => {
  const cases = [
    [{ MONGODB_URI: '' }, /MONGODB_URI is not set/],
    [{ MONGODB_URI: '"mongodb+srv://u:p@x/"' }, /must start with "mongodb\+srv:\/\/"/],
    [{ MONGODB_URI: 'mongodb+srv://user:<db_password>@x.mongodb.net/' }, /<password>" placeholder/],
    [{ APP_PASSWORD: '' }, /APP_PASSWORD is not set/],
    [{ APP_PASSWORD: 'short' }, /APP_PASSWORD is too short/],
    [{ SESSION_SECRET: undefined }, /SESSION_SECRET is not set/],
    [{ SESSION_SECRET: 'tiny' }, /SESSION_SECRET is too short/],
  ];
  for (const [override, expected] of cases) {
    const problems = checkConfig({ ...good, ...override });
    assert.equal(problems.length, 1, JSON.stringify(override));
    assert.match(problems[0], expected);
  }
});

test('all problems are reported together', () => {
  assert.equal(checkConfig({}).length, 3);
});

test('database errors are explained without echoing the raw error', () => {
  const secretMsg = 'bad auth : authentication failed for mongodb+srv://me:TopSecret@host';
  const cases = [
    [{ name: 'MongoServerError', code: 8000, message: secretMsg }, /rejected the username or password/],
    [{ name: 'MongoAPIError', message: 'querySrv ENOTFOUND _mongodb._tcp.nope.mongodb.net' }, /could not be found/],
    [{ name: 'MongoParseError', message: 'Invalid scheme' }, /not a valid connection string/],
    [{ name: 'MongoServerSelectionError', message: 'Server selection timed out after 10000 ms' }, /Network Access/],
    [{ name: 'Error', message: 'something odd' }, /could not connect to MongoDB/],
  ];
  for (const [err, expected] of cases) {
    const text = explainDbError(err);
    assert.match(text, expected);
    assert.doesNotMatch(text, /TopSecret/);
  }
});

test('Vercel handler shows setup problems on screen (503) and never leaks secrets', async () => {
  // Unreachable database + short password: both problems in one place.
  process.env.MONGODB_URI = 'mongodb://admin:TopSecret99@127.0.0.1:1/?serverSelectionTimeoutMS=1500';
  process.env.APP_PASSWORD = 'short';
  process.env.SESSION_SECRET = 'TopSecretSessionValue123';
  delete require.cache[require.resolve('../api/index.js')];
  const handler = require('../api/index.js');
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 1) Config problem is reported before even trying the database.
    let res = await fetch(base + '/api/health');
    let body = await res.json();
    assert.equal(res.status, 503);
    assert.deepEqual(body.setupProblems, ['APP_PASSWORD is too short — use at least 8 characters.']);

    // 2) Fix the password: now the unreachable database is explained (and it retries, not cached).
    process.env.APP_PASSWORD = 'long-enough-now';
    res = await fetch(base + '/api/session');
    const raw = await res.text();
    body = JSON.parse(raw);
    assert.equal(res.status, 503);
    assert.match(body.setupProblems[0], /Can't reach your MongoDB cluster/);
    assert.doesNotMatch(raw, /TopSecret/);
  } finally {
    server.close();
  }
});

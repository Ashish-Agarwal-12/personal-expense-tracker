'use strict';

/** Runs api/index.js the way Vercel does: a plain Node (req, res) handler, configured only by env vars. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mem, server, base;

before(async () => {
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mem.getUri();
  process.env.MONGODB_DB = 'vercel_test';
  process.env.APP_PASSWORD = 'vercel-test-password';
  process.env.SESSION_SECRET = 'vercel-test-secret-123456';
  process.env.VERCEL = '1';
  const handler = require('../api/index.js');
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  const { connect } = require('../server/db');
  const { client } = await connect(process.env.MONGODB_URI);
  await client.close();
  await mem.stop();
});

test('function connects to MongoDB and seeds a fresh database', async () => {
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);

  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'vercel-test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /; Secure/, 'cookies are Secure on Vercel');

  const data = await (await fetch(base + '/api/data', { headers: { Cookie: cookie.split(';')[0] } })).json();
  assert.equal(data.categories.length, 8);
});

test('function does not serve the website (Vercel static hosting does)', async () => {
  assert.equal((await fetch(base + '/index.html')).status, 404);
});

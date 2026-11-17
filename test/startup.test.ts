import { afterAll, describe, expect, test } from 'vitest';
import * as health from '@/app/api/health/route';
import * as session from '@/app/api/session/route';
import { createAuth } from '@/lib/server/auth';
import { resetContextForTests } from '@/lib/server/db';
import { checkConfig, explainDbError } from '@/lib/server/startup';
import { call } from './helpers';

const good = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/',
  APP_PASSWORD: 'long-enough',
  SESSION_SECRET: '0123456789abcdef0123',
};

afterAll(() => resetContextForTests());

describe('checkConfig', () => {
  test('valid config has no problems', () => {
    expect(checkConfig(good)).toEqual([]);
  });

  test.each([
    [{ MONGODB_URI: '' }, /MONGODB_URI is not set/],
    [{ MONGODB_URI: '"mongodb+srv://u:p@x/"' }, /must start with "mongodb\+srv:\/\/"/],
    [{ MONGODB_URI: 'mongodb+srv://user:<db_password>@x.mongodb.net/' }, /<password>" placeholder/],
    [{ APP_PASSWORD: '' }, /APP_PASSWORD is not set/],
    [{ APP_PASSWORD: 'short' }, /APP_PASSWORD is too short/],
    [{ SESSION_SECRET: undefined }, /SESSION_SECRET is not set/],
    [{ SESSION_SECRET: 'tiny' }, /SESSION_SECRET is too short/],
  ])('%j → clear message', (override, expected) => {
    const problems = checkConfig({ ...good, ...override });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(expected);
  });

  test('all problems are reported together', () => {
    expect(checkConfig({})).toHaveLength(3);
  });
});

test('database errors are explained without echoing the raw error', () => {
  const secretMsg = 'bad auth : authentication failed for mongodb+srv://me:TopSecret@host';
  const cases: [object, RegExp][] = [
    [{ name: 'MongoServerError', code: 8000, message: secretMsg }, /rejected the username or password/],
    [{ name: 'MongoAPIError', message: 'querySrv ENOTFOUND _mongodb._tcp.nope.mongodb.net' }, /could not be found/],
    [{ name: 'MongoParseError', message: 'Invalid scheme' }, /not a valid connection string/],
    [{ name: 'MongoServerSelectionError', message: 'Server selection timed out after 10000 ms' }, /Network Access/],
    [{ name: 'Error', message: 'something odd' }, /could not connect to MongoDB/],
  ];
  for (const [err, expected] of cases) {
    const text = explainDbError(err);
    expect(text).toMatch(expected);
    expect(text).not.toMatch(/TopSecret/);
  }
});

test('session cookie is marked Secure in production mode', () => {
  const auth = createAuth({ password: 'long-enough', secret: '0123456789abcdef0123', secureCookies: true });
  expect(auth.sessionCookie()).toMatch(/; Secure/);
});

test('API shows setup problems (503), retries after a fix, and never leaks secrets', async () => {
  process.env.MONGODB_URI = 'mongodb://admin:TopSecret99@127.0.0.1:1/';
  process.env.APP_PASSWORD = 'short';
  process.env.SESSION_SECRET = 'TopSecretSessionValue123';

  // 1) Config problem is reported before even trying the database.
  let r = await call(health.GET);
  expect(r.status).toBe(503);
  expect(r.body.setupProblems).toEqual(['APP_PASSWORD is too short — use at least 8 characters.']);

  // 2) Fix the password: now the unreachable database is explained (failure wasn't cached).
  process.env.APP_PASSWORD = 'long-enough-now';
  r = await call(session.GET);
  expect(r.status).toBe(503);
  expect(r.body.setupProblems[0]).toMatch(/Can't reach your MongoDB cluster/);
  expect(JSON.stringify(r.body)).not.toMatch(/TopSecret/);
});

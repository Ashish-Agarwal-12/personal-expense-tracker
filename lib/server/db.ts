import { MongoClient, type Db } from 'mongodb';
import { createAuth, createLoginLimiter, type Auth, type LoginLimiter } from './auth';
import { checkConfig, explainDbError } from './startup';
import { ensureIndexes, ensureInitialized, loginAttempts } from './store';

/** Thrown when the server can't start; `problems` are safe, plain-English messages for the website. */
export class SetupError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join(' '));
  }
}

export interface ServerContext {
  client: MongoClient;
  db: Db;
  auth: Auth;
  limiter: LoginLimiter;
}

// Kept on globalThis so a warm serverless instance (and `next dev` hot reloads) reuse one connection.
const g = globalThis as typeof globalThis & { __trackerCtx?: Promise<ServerContext> };

const isDev = () => process.env.NODE_ENV === 'development';

async function resolveUri(): Promise<string> {
  const uri = (process.env.MONGODB_URI || '').trim();
  if (uri) return uri;
  // Local development without a database: a throwaway in-memory MongoDB.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  console.warn('⚠️  MONGODB_URI not set — using a TEMPORARY in-memory database. Data is lost when the server stops.');
  return mem.getUri();
}

async function build(): Promise<ServerContext> {
  const env = { ...process.env };
  if (isDev()) {
    if (!env.APP_PASSWORD) {
      env.APP_PASSWORD = 'dev-password';
      console.warn('⚠️  APP_PASSWORD not set — local login password is "dev-password".');
    }
    env.SESSION_SECRET ||= 'dev-only-session-secret-change-me';
  }

  const problems = checkConfig(env, { requireUri: !isDev() });
  if (problems.length) throw new SetupError(problems);

  let client: MongoClient;
  let db: Db;
  try {
    client = new MongoClient(await resolveUri(), { serverSelectionTimeoutMS: 10_000, maxPoolSize: 5 });
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'expense_tracker');
    await ensureInitialized(db);
    await ensureIndexes(db);
  } catch (err) {
    const e = err as Error;
    console.error('MongoDB connection failed:', e.name, e.message);
    throw new SetupError([explainDbError(err)]);
  }

  return {
    client,
    db,
    auth: createAuth({
      password: env.APP_PASSWORD!,
      secret: env.SESSION_SECRET!,
      secureCookies: process.env.NODE_ENV === 'production',
    }),
    limiter: createLoginLimiter(loginAttempts(db)),
  };
}

/** The shared server context. A failed start is not cached, so fixing a setting takes effect on the next request. */
export function getContext(): Promise<ServerContext> {
  if (!g.__trackerCtx) {
    g.__trackerCtx = build().catch((err) => {
      g.__trackerCtx = undefined;
      throw err;
    });
  }
  return g.__trackerCtx;
}

/** Tests only: forget the cached connection. */
export async function resetContextForTests(): Promise<void> {
  const ctx = await g.__trackerCtx?.catch(() => undefined);
  g.__trackerCtx = undefined;
  await ctx?.client.close();
}

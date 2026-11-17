'use strict';

const { MongoClient } = require('mongodb');
const { createApp, ensureInitialized, ensureIndexes } = require('./app');

const PORT = Number(process.env.PORT) || 5173;
const isProd = process.env.NODE_ENV === 'production';

async function getMongoUri() {
  if (process.env.MONGODB_URI) return { uri: process.env.MONGODB_URI };
  if (isProd) throw new Error('MONGODB_URI is not set');
  // Local development without a database: spin up a throwaway in-memory MongoDB.
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  console.warn('⚠️  MONGODB_URI not set — using a TEMPORARY in-memory database. Data is lost when the server stops.');
  return { uri: mem.getUri(), mem };
}

async function main() {
  const password = process.env.APP_PASSWORD || (isProd ? '' : 'dev-password');
  const secret = process.env.SESSION_SECRET || (isProd ? '' : 'dev-only-session-secret-change-me');
  if (!process.env.APP_PASSWORD && !isProd) console.warn('⚠️  APP_PASSWORD not set — local login password is "dev-password".');

  const { uri, mem } = await getMongoUri();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'expense_tracker');
  await ensureInitialized(db);
  await ensureIndexes(db);

  const app = createApp({ db, password, secret, secureCookies: isProd });
  const server = app.listen(PORT, () => console.log(`Debt-Free Tracker running at http://localhost:${PORT}`));

  const shutdown = async () => {
    server.close();
    await client.close();
    if (mem) await mem.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

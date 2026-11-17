'use strict';

/** Local development server: `npm run dev`. In production the app runs as a Vercel Function (api/index.js). */
const { createApp } = require('./app');
const { connect } = require('./db');

const PORT = Number(process.env.PORT) || 5173;

async function getMongoUri() {
  if (process.env.MONGODB_URI) return { uri: process.env.MONGODB_URI };
  // No database configured: spin up a throwaway in-memory MongoDB.
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mem = await MongoMemoryServer.create();
  console.warn('⚠️  MONGODB_URI not set — using a TEMPORARY in-memory database. Data is lost when the server stops.');
  return { uri: mem.getUri(), mem };
}

async function main() {
  const password = process.env.APP_PASSWORD || 'dev-password';
  const secret = process.env.SESSION_SECRET || 'dev-only-session-secret-change-me';
  if (!process.env.APP_PASSWORD) console.warn('⚠️  APP_PASSWORD not set — local login password is "dev-password".');

  const { uri, mem } = await getMongoUri();
  const { client, db } = await connect(uri);

  const app = createApp({ db, password, secret, secureCookies: false });
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

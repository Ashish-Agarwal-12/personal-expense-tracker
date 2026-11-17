'use strict';

const { MongoClient } = require('mongodb');
const { ensureInitialized, ensureIndexes } = require('./app');

/**
 * One shared MongoDB connection per process.
 * On Vercel a warm function instance handles many requests, so we keep the connection
 * in module scope instead of reconnecting on every request.
 */
let cached = null;

function connect(uri, dbName = process.env.MONGODB_DB || 'expense_tracker') {
  if (!uri) return Promise.reject(new Error('MONGODB_URI is not set'));
  if (!cached) {
    cached = (async () => {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 5 });
      await client.connect();
      const db = client.db(dbName);
      await ensureInitialized(db);
      await ensureIndexes(db);
      return { client, db };
    })().catch((err) => {
      cached = null; // let the next request retry instead of caching the failure
      throw err;
    });
  }
  return cached;
}

module.exports = { connect };

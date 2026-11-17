'use strict';

/**
 * Vercel Function: every /api/* request is rewritten here (see vercel.json).
 * The website itself (public/) is served by Vercel's static hosting.
 */
const { createApp } = require('../server/app');
const { connect } = require('../server/db');

let appPromise = null;

async function buildApp() {
  const { db } = await connect(process.env.MONGODB_URI);
  return createApp({
    db,
    password: process.env.APP_PASSWORD,
    secret: process.env.SESSION_SECRET,
    secureCookies: process.env.VERCEL === '1' || process.env.NODE_ENV === 'production',
    serveStatic: false,
  });
}

module.exports = async function handler(req, res) {
  if (!appPromise) appPromise = buildApp().catch((err) => { appPromise = null; throw err; });
  let app;
  try {
    app = await appPromise;
  } catch (err) {
    console.error('Startup failed:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server is not configured correctly — check MONGODB_URI, APP_PASSWORD and SESSION_SECRET in Vercel.' }));
    return;
  }
  return app(req, res);
};

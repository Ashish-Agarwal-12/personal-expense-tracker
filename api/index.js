'use strict';

/**
 * Vercel Function: every /api/* request is rewritten here (see vercel.json).
 * The website itself (public/) is served by Vercel's static hosting.
 */
const { createApp } = require('../server/app');
const { connect } = require('../server/db');
const { checkConfig, explainDbError } = require('../server/startup');

class SetupError extends Error {
  constructor(problems) {
    super(problems.join(' '));
    this.problems = problems;
  }
}

let appPromise = null;

async function buildApp() {
  const problems = checkConfig(process.env);
  if (problems.length) throw new SetupError(problems);
  let db;
  try {
    ({ db } = await connect(process.env.MONGODB_URI.trim()));
  } catch (err) {
    console.error('MongoDB connection failed:', err.name, err.message);
    throw new SetupError([explainDbError(err)]);
  }
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
    const problems = err instanceof SetupError ? err.problems : ['The server failed to start. Check the Vercel function logs.'];
    if (!(err instanceof SetupError)) console.error('Startup failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: 'Server setup problem', setupProblems: problems }));
    return;
  }
  return app(req, res);
};

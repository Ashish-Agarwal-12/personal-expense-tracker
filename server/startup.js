'use strict';

/**
 * Turns server setup problems into plain-English messages that are safe to show on the website.
 * Only fixed messages written here are ever shown — never the raw error, which could include
 * connection details.
 */

/** Problems with the environment variables themselves (checked before connecting to the database). */
function checkConfig(env) {
  const problems = [];
  const uri = (env.MONGODB_URI || '').trim();
  if (!uri) {
    problems.push('MONGODB_URI is not set. Add your Atlas connection string in Vercel → Settings → Environment Variables (tick Production).');
  } else if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    problems.push('MONGODB_URI does not look like a MongoDB connection string — it must start with "mongodb+srv://". Remove any quotes or spaces around it.');
  } else if (/<\s*(db_)?password\s*>/i.test(uri)) {
    problems.push('MONGODB_URI still contains the "<password>" placeholder — replace it with your Atlas database user\'s password.');
  }
  if (!env.APP_PASSWORD) problems.push('APP_PASSWORD is not set. Add the password you want to log in with.');
  else if (env.APP_PASSWORD.length < 8) problems.push('APP_PASSWORD is too short — use at least 8 characters.');
  if (!env.SESSION_SECRET) problems.push('SESSION_SECRET is not set. Add a long random string (see README).');
  else if (env.SESSION_SECRET.length < 16) problems.push('SESSION_SECRET is too short — use at least 16 random characters.');
  return problems;
}

/** Explain why connecting to MongoDB failed. */
function explainDbError(err) {
  const msg = String((err && err.message) || '');
  const name = String((err && err.name) || '');
  if (/bad auth|authentication failed/i.test(msg) || (err && (err.code === 18 || err.code === 8000))) {
    return 'MongoDB rejected the username or password in MONGODB_URI. Check the database user in Atlas → Database Access. If the password has special characters (@ : / ? # %), URL-encode them or pick a password with only letters and numbers.';
  }
  if (/ENOTFOUND|querySrv|ENODATA|EAI_AGAIN/i.test(msg)) {
    return 'The cluster address in MONGODB_URI could not be found. Copy the connection string again from Atlas → Connect → Drivers.';
  }
  if (name === 'MongoParseError' || /Invalid scheme|URI must include hostname|malformed/i.test(msg)) {
    return 'MONGODB_URI is not a valid connection string. Copy it again from Atlas → Connect → Drivers and paste it without quotes.';
  }
  if (name === 'MongoServerSelectionError' || /timed out|ETIMEDOUT|ECONNREFUSED|whitelist|IP address/i.test(msg)) {
    return "Can't reach your MongoDB cluster. In Atlas → Network Access, add 0.0.0.0/0 (Vercel has no fixed IP), and check the cluster isn't paused.";
  }
  return 'The server could not connect to MongoDB. Check MONGODB_URI in Vercel and your Atlas cluster status.';
}

module.exports = { checkConfig, explainDbError };

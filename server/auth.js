'use strict';

const crypto = require('crypto');

/**
 * Single-user password login.
 * The session cookie is `<expiry>.<hmac>`; the HMAC key mixes in a hash of the password,
 * so changing APP_PASSWORD logs out every existing session.
 */

const COOKIE = 'sid';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function createAuth({ password, secret, secureCookies }) {
  if (!password || password.length < 8) throw new Error('APP_PASSWORD must be set and at least 8 characters');
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET must be set and at least 16 characters');

  const passwordHash = sha256(password);
  const key = crypto.createHmac('sha256', secret).update(passwordHash).digest();
  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  function passwordMatches(candidate) {
    if (typeof candidate !== 'string') return false;
    return crypto.timingSafeEqual(sha256(candidate), passwordHash);
  }

  function issue() {
    const exp = String(Date.now() + SESSION_MS);
    return `${exp}.${sign(exp)}`;
  }

  function valid(token) {
    if (typeof token !== 'string') return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    const expected = Buffer.from(sign(exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return false;
    return Number(exp) > Date.now();
  }

  function readCookie(req) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return decodeURIComponent(v.join('='));
    }
    return null;
  }

  const cookieAttrs = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  function setSession(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=${issue()}; Max-Age=${SESSION_MS / 1000}; ${cookieAttrs}`);
  }

  function clearSession(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieAttrs}`);
  }

  const isAuthed = (req) => valid(readCookie(req));

  function requireAuth(req, res, next) {
    if (isAuthed(req)) return next();
    res.status(401).json({ error: 'Please log in' });
  }

  return { passwordMatches, setSession, clearSession, isAuthed, requireAuth };
}

/**
 * Login attempt limiter: `max` failures per IP per window.
 * Stored in MongoDB (collection `login_attempts`, auto-expired by a TTL index) so the limit
 * holds across all serverless instances, not just the one that saw the attempts.
 */
function createLoginLimiter(collection, { max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  return {
    async blocked(ip) {
      const h = await collection.findOne({ _id: ip, expireAt: { $gt: new Date() } });
      return !!h && h.count >= max;
    },
    async fail(ip) {
      const now = new Date();
      const r = await collection.updateOne({ _id: ip, expireAt: { $gt: now } }, { $inc: { count: 1 } });
      if (!r.matchedCount) {
        await collection.replaceOne({ _id: ip }, { count: 1, expireAt: new Date(now.getTime() + windowMs) }, { upsert: true });
      }
    },
    async reset(ip) {
      await collection.deleteOne({ _id: ip });
    },
  };
}

module.exports = { createAuth, createLoginLimiter };

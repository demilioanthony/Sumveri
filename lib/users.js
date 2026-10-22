// Accounts and sessions. Passwords are hashed with scrypt; sessions use random 256-bit tokens
// that are stored only as SHA-256 hashes.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SESSION_SECONDS = 7 * 24 * 3600;
const N = 16384;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${h.toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [alg, n, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = await scrypt(pw, Buffer.from(salt, 'hex'), 64, { N: +n });
  const want = Buffer.from(hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}

function createUsers(store) {
  let dummy; // so an unknown email takes as long to reject as a wrong password
  const dummyHash = () => (dummy = dummy || hashPassword('not-a-real-password'));

  function startSession(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    store.putSession(sha(token), { userId: user.id, exp: Date.now() + SESSION_SECONDS * 1000 });
    return token;
  }

  return {
    SESSION_SECONDS,
    async signup({ name, email, password }) {
      email = String(email || '').trim().toLowerCase();
      name = String(name || '').trim().slice(0, 60);
      password = String(password || '');
      if (!EMAIL.test(email) || email.length > 254) return { status: 400, error: 'Enter a valid email address.' };
      if (password.length < 10) return { status: 400, error: 'Use a password with at least 10 characters.' };
      if (password.length > 128) return { status: 400, error: 'That password is too long. Use 128 characters or fewer.' };
      if (store.findUserByEmail(email)) return { status: 409, error: 'An account with that email already exists. Sign in instead.' };
      const user = { id: crypto.randomUUID(), name: name || email.split('@')[0], email, pass: await hashPassword(password), created: new Date().toISOString() };
      try { store.addUser(user); }
      catch (e) {
        if (e.code === 'EMAIL_TAKEN') return { status: 409, error: 'An account with that email already exists. Sign in instead.' };
        throw e;
      }
      return { user: publicUser(user), token: startSession(user) };
    },
    async login({ email, password }) {
      email = String(email || '').trim().toLowerCase();
      password = String(password || '').slice(0, 128);
      const user = store.findUserByEmail(email);
      const ok = await checkPassword(password, user ? user.pass : await dummyHash());
      if (!user || !ok) return { status: 401, error: 'Incorrect email or password.' };
      return { user: publicUser(user), token: startSession(user) };
    },
    userForToken(token) {
      const s = store.getSession(sha(String(token)));
      const u = s && store.findUserById(s.userId);
      return u ? publicUser(u) : null;
    },
    endSession: (token) => store.deleteSession(sha(String(token))),
  };
}

module.exports = { createUsers };

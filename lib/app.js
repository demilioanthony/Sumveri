const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const Finance = require('../public/finance.js');

const PRETTY = {
  INCOME: 'Income', TRANSFER_IN: 'Transfer', TRANSFER_OUT: 'Transfer', LOAN_PAYMENTS: 'Loan payments',
  BANK_FEES: 'Bank fees', ENTERTAINMENT: 'Entertainment', FOOD_AND_DRINK: 'Food and drink', GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Home', MEDICAL: 'Medical', PERSONAL_CARE: 'Personal care', GENERAL_SERVICES: 'Services',
  GOVERNMENT_AND_NON_PROFIT: 'Government and giving', TRANSPORTATION: 'Transport', TRAVEL: 'Travel', RENT_AND_UTILITIES: 'Rent and utilities',
};

/* Builds the web app. Everything it needs is passed in, so tests can use a fake Plaid and a temporary store.
 *  config  from lib/config.js
 *  store, users, plaid  not needed when config.demoOnly is true */
function createApp({ config, store, users, plaid }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const cookieName = config.secure ? '__Host-sid' : 'sid';
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${config.secure ? '; Secure' : ''}`;

  // Hosted: only ever answer over HTTPS. The proxy in front reports the original protocol.
  if (config.hosted) {
    app.use((req, res, next) => {
      if (req.secure || req.path === '/healthz') return next();
      if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(308, config.appUrl + req.originalUrl);
      return res.status(400).json({ error: 'Use https.' });
    });
  }

  app.use(helmet({
    hsts: config.secure ? { maxAge: 15552000 } : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.plaid.com'],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        frameSrc: ['https://cdn.plaid.com'],
        connectSrc: ["'self'", 'https://*.plaid.com'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Some browsers apply this to http://localhost and break it, so it is only on for real https sites.
        'upgrade-insecure-requests': config.secure ? [] : null,
      },
    },
  }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  // What the page needs to know before anyone signs in. Nothing secret.
  app.get('/api/config', (req, res) => res.json({ demoOnly: config.demoOnly, signup: !config.demoOnly && config.allowSignup, env: config.plaidEnv }));

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

  // Only this app's own page may call the API.
  const allowedOrigins = new Set([`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`]);
  if (config.appUrl) allowedOrigins.add(config.appUrl);
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Blocked: request came from another site.' });
    if (req.method !== 'GET' && req.path !== '/logout' && !req.is('application/json')) return res.status(415).json({ error: 'Expected JSON.' });
    next();
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  if (config.demoOnly) {
    // A public demo holds no accounts, keys or bank connections, so every other API route is off.
    app.use('/api', (req, res) => res.status(404).json({ error: 'Not available in the public demo.' }));
  } else {
    mountAccountRoutes(app, { config, store, users, plaid, cookieName, cookieFlags });
  }

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error('Error:', err && err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  });
  return app;
}

function mountAccountRoutes(app, { config, store, users, plaid, cookieName, cookieFlags }) {
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: config.authLimit, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Wait a few minutes and try again.' },
  });

  const readCookie = (req) => {
    for (const p of (req.headers.cookie || '').split(';')) {
      const i = p.indexOf('=');
      if (i > 0 && p.slice(0, i).trim() === cookieName) { try { return decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { return ''; } }
    }
    return '';
  };
  const setSession = (res, token) => res.setHeader('Set-Cookie', `${cookieName}=${token}; ${cookieFlags}; Max-Age=${users.SESSION_SECONDS}`);
  const clearSession = (res) => res.setHeader('Set-Cookie', `${cookieName}=; ${cookieFlags}; Max-Age=0`);

  app.use('/api', (req, res, next) => {
    const t = readCookie(req);
    req.user = t ? users.userForToken(t) : null;
    next();
  });
  const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in.' }));
  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    const pe = err && err.response && err.response.data;
    // Log Plaid's error code and message only. Never log tokens or full responses.
    console.error('Error:', pe ? `${pe.error_code}: ${pe.error_message}` : err.message);
    res.status(500).json({ error: pe ? pe.error_message : 'Something went wrong. Check the server window.', code: pe && pe.error_code });
  });

  // ---- Accounts ----
  app.post('/api/signup', authLimiter, wrap(async (req, res) => {
    if (!config.allowSignup) return res.status(403).json({ error: 'New accounts are turned off on this server.' });
    const r = await users.signup(req.body || {});
    if (r.error) return res.status(r.status).json({ error: r.error });
    setSession(res, r.token);
    res.json({ user: r.user });
  }));
  app.post('/api/login', authLimiter, wrap(async (req, res) => {
    const r = await users.login(req.body || {});
    if (r.error) return res.status(r.status).json({ error: r.error });
    setSession(res, r.token);
    res.json({ user: r.user });
  }));
  app.post('/api/logout', (req, res) => {
    const t = readCookie(req);
    if (t) users.endSession(t);
    clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/me', (req, res) => (req.user ? res.json({ user: req.user }) : res.status(401).json({ error: 'Not signed in.' })));

  // ---- Bank connections. Every route is scoped to the signed-in user. ----
  app.get('/api/status', requireAuth, (req, res) => {
    const items = store.getItems(req.user.id);
    res.json({ env: config.plaidEnv, connected: items.length > 0, banks: items.map((i) => i.institution) });
  });

  app.post('/api/create_link_token', requireAuth, wrap(async (req, res) => {
    const r = await plaid.linkTokenCreate({
      user: { client_user_id: req.user.id },
      client_name: 'Sumveri',
      products: ['transactions'],
      transactions: { days_requested: 730 },
      country_codes: ['US'],
      language: 'en',
    });
    res.json({ link_token: r.data.link_token });
  }));

  app.post('/api/exchange_public_token', requireAuth, wrap(async (req, res) => {
    const { public_token, institution } = req.body || {};
    if (typeof public_token !== 'string' || !public_token.startsWith('public-')) return res.status(400).json({ error: 'Missing public token.' });
    const r = await plaid.itemPublicTokenExchange({ public_token });
    store.addItem({
      userId: req.user.id, item_id: r.data.item_id, access_token: r.data.access_token,
      institution: (institution && String(institution).slice(0, 80)) || 'Bank', cursor: null,
    });
    res.json({ ok: true });
  }));

  async function syncItem(item) {
    let cursor = item.cursor || undefined, more = true, tries = 0, accounts;
    const added = [], modified = [], removed = [];
    while (more) {
      try {
        const r = await plaid.transactionsSync({ access_token: item.access_token, cursor, count: 500 });
        added.push(...r.data.added); modified.push(...r.data.modified); removed.push(...r.data.removed);
        more = r.data.has_more; cursor = r.data.next_cursor;
        if (r.data.accounts) accounts = r.data.accounts;
      } catch (err) {
        const code = err.response && err.response.data && err.response.data.error_code;
        if (code === 'PRODUCT_NOT_READY' && tries++ < 6) { await new Promise((ok) => setTimeout(ok, 2000)); continue; }
        throw err;
      }
    }
    store.applySync(item.item_id, { added, modified, removed, cursor, hasCredit: accounts ? accounts.some((a) => a.type === 'credit') : undefined });
  }

  app.get('/api/transactions', requireAuth, wrap(async (req, res) => {
    for (const item of store.getItems(req.user.id)) await syncItem(item);
    const cardLinked = store.getItems(req.user.id).some((i) => i.hasCredit);
    const kinds = store.getKinds(req.user.id);
    const out = store.getTransactions(req.user.id).map((t) => {
      const pfc = t.personal_finance_category || {};
      const transfer = Finance.isTransferCategory(pfc.primary, pfc.detailed, cardLinked);
      return {
        id: t.transaction_id,
        date: t.date,
        desc: t.merchant_name || t.name || 'Transaction',
        cat: transfer ? 'Transfer' : PRETTY[pfc.primary] || 'Other',
        // Plaid reports money out as positive. Sumveri shows money in as positive.
        amt: -t.amount,
        pending: !!t.pending,
        transfer,
        kind: kinds[t.transaction_id],
      };
    });
    res.json({ transactions: out });
  }));

  // Correct how one transaction is counted. Only the signed-in user's own transactions can be changed.
  app.post('/api/classify', requireAuth, wrap(async (req, res) => {
    const { id, kind } = req.body || {};
    if (typeof id !== 'string' || id.length > 100) return res.status(400).json({ error: 'Missing transaction.' });
    if (kind !== null && !Finance.KINDS.includes(kind)) return res.status(400).json({ error: 'Choose income, expense or transfer.' });
    if (!store.setKind(req.user.id, id, kind)) return res.status(404).json({ error: 'Transaction not found.' });
    res.json({ ok: true });
  }));

  app.post('/api/disconnect', requireAuth, wrap(async (req, res) => {
    for (const item of store.getItems(req.user.id)) {
      try { await plaid.itemRemove({ access_token: item.access_token }); } catch (e) { /* already gone */ }
    }
    store.clearUser(req.user.id);
    res.json({ ok: true });
  }));
}

module.exports = { createApp };

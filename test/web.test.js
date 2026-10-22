const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const PW = 'a-long-test-password';
const tx = (id, amount, extra) => Object.assign({ transaction_id: id, date: '2026-10-05', name: id, amount, pending: false, personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'X' } }, extra || {});

async function signUp(srv, email, name) {
  const c = srv.client();
  const r = await c.post('/api/signup', { email, password: PW, name });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return c;
}
async function connect(c, who) {
  assert.equal((await c.post('/api/exchange_public_token', { public_token: 'public-' + who, institution: who + ' Bank' })).status, 200);
}

// ---------- sign in and sign out ----------
test('sign up, sign in and sign out', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const c = srv.client();

  assert.equal((await c.get('/api/me')).status, 401, 'not signed in at first');
  const up = await c.post('/api/signup', { name: 'Demi', email: 'Demi@Example.com', password: PW });
  assert.equal(up.status, 200);
  assert.equal(up.json.user.email, 'demi@example.com', 'email is stored lowercase');
  assert.equal(up.json.user.pass, undefined, 'the password hash is never sent to the page');
  assert.equal((await c.get('/api/me')).json.user.name, 'Demi');

  const out = await c.post('/api/logout');
  assert.equal(out.status, 200);
  assert.equal((await c.get('/api/me')).status, 401);

  assert.equal((await c.post('/api/login', { email: 'demi@example.com', password: PW })).status, 200);
  assert.equal((await c.get('/api/me')).status, 200);
});

test('the session cookie is HttpOnly and SameSite=Strict', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const r = await srv.client().post('/api/signup', { email: 'a@example.com', password: PW });
  assert.match(r.setCookie, /^sid=/);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Strict/);
  assert.doesNotMatch(r.setCookie, /Secure/, 'plain http on your own computer cannot use Secure cookies');
});

test('a session cookie stops working after sign out, even if someone kept a copy', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const c = await signUp(srv, 'a@example.com');
  const stolen = c.cookie;
  await c.post('/api/logout');
  const thief = srv.client();
  thief.cookie = stolen;
  assert.equal((await thief.get('/api/status')).status, 401);
});

test('wrong passwords, unknown emails and bad input are rejected with clear messages', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  await signUp(srv, 'a@example.com');
  const c = srv.client();
  const wrong = await c.post('/api/login', { email: 'a@example.com', password: 'not the password' });
  const unknown = await c.post('/api/login', { email: 'nobody@example.com', password: PW });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.json.error, unknown.json.error, 'does not reveal which emails have accounts');
  assert.equal((await c.post('/api/signup', { email: 'A@EXAMPLE.COM', password: PW })).status, 409);
  assert.equal((await c.post('/api/signup', { email: 'not-an-email', password: PW })).status, 400);
  assert.equal((await c.post('/api/signup', { email: 'b@example.com', password: 'short' })).status, 400);
  assert.equal((await c.post('/api/signup', { email: 'b@example.com', password: 'x'.repeat(200) })).status, 400);
  assert.equal((await c.post('/api/login', {})).status, 401);
  assert.equal((await c.post('/api/login', { email: { $ne: '' }, password: { $ne: '' } })).status, 401, 'objects are not accepted as credentials');
});

test('repeated sign-in attempts are rate limited', async (t) => {
  const srv = await startServer({ config: { authLimit: 4 } });
  t.after(srv.close);
  const c = srv.client();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await c.post('/api/login', { email: 'a@example.com', password: 'wrong-password-' + i })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 429, 429]);
});

test('requests from other websites are blocked', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const c = srv.client();
  const evil = await c.post('/api/signup', { email: 'a@example.com', password: PW }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const own = await c.post('/api/signup', { email: 'a@example.com', password: PW }, { Origin: `http://localhost:${srv.port}` });
  assert.equal(own.status, 200);
  const form = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  assert.equal(form.status, 415, 'a plain form post is refused');
});

test('malformed JSON gets a clean error, not a stack trace', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const r = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Invalid request.' });
});

// ---------- one person can never see another person's data ----------
test('every bank route needs a signed-in user', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const c = srv.client();
  for (const [m, url] of [['get', '/api/status'], ['get', '/api/transactions'], ['post', '/api/create_link_token'], ['post', '/api/exchange_public_token'], ['post', '/api/disconnect']]) {
    assert.equal((await c[m](url)).status, 401, m + ' ' + url);
  }
  const forged = srv.client();
  forged.cookie = 'sid=' + 'A'.repeat(43);
  assert.equal((await forged.get('/api/transactions')).status, 401);
});

test('one user cannot see, change or delete another user\'s banks and transactions', async (t) => {
  const bank = {
    'access-alice': { added: [tx('alice-1', 11.11, { name: 'ALICE PRIVATE PURCHASE' })], accounts: [{ type: 'depository' }] },
    'access-bob': { added: [tx('bob-1', 22.22, { name: 'BOB PRIVATE PURCHASE' })], accounts: [{ type: 'depository' }] },
  };
  const srv = await startServer({ bank });
  t.after(srv.close);
  const alice = await signUp(srv, 'alice@example.com', 'Alice');
  const bob = await signUp(srv, 'bob@example.com', 'Bob');
  await connect(alice, 'alice');

  // Bob has connected nothing, so he sees nothing of Alice's.
  assert.deepEqual((await bob.get('/api/status')).json, { env: 'sandbox', connected: false, banks: [] });
  assert.deepEqual((await bob.get('/api/transactions')).json.transactions, []);

  await connect(bob, 'bob');
  const a = (await alice.get('/api/transactions')).json.transactions;
  const b = (await bob.get('/api/transactions')).json.transactions;
  assert.deepEqual(a.map((x) => x.desc), ['ALICE PRIVATE PURCHASE']);
  assert.deepEqual(b.map((x) => x.desc), ['BOB PRIVATE PURCHASE']);
  assert.deepEqual((await alice.get('/api/status')).json.banks, ['alice Bank']);
  assert.deepEqual((await bob.get('/api/status')).json.banks, ['bob Bank']);

  // Bob disconnecting removes only Bob's connection, at Plaid and in the store.
  assert.equal((await bob.post('/api/disconnect')).status, 200);
  assert.deepEqual(srv.plaid.removed, ['access-bob']);
  assert.equal((await bob.get('/api/transactions')).json.transactions.length, 0);
  assert.equal((await alice.get('/api/transactions')).json.transactions.length, 1);
  assert.equal((await alice.get('/api/status')).json.connected, true);

  // Alice signing out and Bob signing in does not expose Alice's data on the same browser.
  await alice.post('/api/logout');
  assert.equal((await alice.get('/api/transactions')).status, 401);
});

test('a user\'s access tokens and other users\' details never appear in any response', async (t) => {
  const bank = { 'access-alice': { added: [tx('a1', 5)], accounts: [] } };
  const srv = await startServer({ bank });
  t.after(srv.close);
  const alice = await signUp(srv, 'alice@example.com');
  const bob = await signUp(srv, 'bob@example.com');
  await connect(alice, 'alice');
  const seen = [];
  for (const [who, url] of [[alice, '/api/me'], [alice, '/api/status'], [alice, '/api/transactions'], [bob, '/api/me'], [bob, '/api/status'], [bob, '/api/transactions']]) {
    const r = await who.get(url);
    seen.push(JSON.stringify(r.json));
  }
  const all = seen.join('\n');
  assert.ok(!all.includes('access-alice'), 'access token leaked');
  assert.ok(!all.includes('scrypt$'), 'password hash leaked');
  assert.ok(!seen.slice(3).join('').includes('alice@example.com'), "Bob's responses mention Alice");
});

// ---------- transfers coming from the bank ----------
test('bank transfers are flagged, and card payments only when the card is linked', async (t) => {
  const rows = [
    tx('pay', -2000, { name: 'Employer', personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' } }),
    tx('sav', 500, { name: 'To savings', personal_finance_category: { primary: 'TRANSFER_OUT', detailed: 'TRANSFER_OUT_SAVINGS' } }),
    tx('card', 300, { name: 'Card payment', personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' } }),
    tx('pend', 12, { name: 'Coffee', pending: true }),
  ];
  const srv = await startServer({ bank: {
    'access-checkingonly': { added: rows, accounts: [{ type: 'depository' }] },
    'access-withcard': { added: rows, accounts: [{ type: 'depository' }, { type: 'credit' }] },
  } });
  t.after(srv.close);

  const solo = await signUp(srv, 'solo@example.com');
  await connect(solo, 'checkingonly');
  const s = (await solo.get('/api/transactions')).json.transactions;
  const by = (list, id) => list.find((x) => x.desc === id);
  assert.equal(by(s, 'To savings').transfer, true);
  assert.equal(by(s, 'To savings').cat, 'Transfer');
  assert.equal(by(s, 'Card payment').transfer, false, 'without the card linked, the payment is real spending');
  assert.equal(by(s, 'Employer').amt, 2000, 'money in is positive');
  assert.equal(by(s, 'Coffee').pending, true);

  const both = await signUp(srv, 'both@example.com');
  await connect(both, 'withcard');
  const w = (await both.get('/api/transactions')).json.transactions;
  assert.equal(by(w, 'Card payment').transfer, true, 'with the card linked, the card\'s own purchases are the spending');
});

// ---------- hosting ----------
test('hosted: plain http is sent to https, and cookies and headers are locked down', async (t) => {
  const srv = await startServer({ config: { hosted: true, secure: true, appUrl: 'https://sumveri.example.com', trustProxy: 1 } });
  t.after(srv.close);
  const c = srv.client();

  const redirect = await c.get('/api/config', { 'X-Forwarded-Proto': 'http' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://sumveri.example.com/api/config');
  assert.equal((await c.post('/api/login', {}, { 'X-Forwarded-Proto': 'http' })).status, 400, 'no sign-ins over http');
  assert.equal((await c.get('/healthz', { 'X-Forwarded-Proto': 'http' })).status, 200, 'health checks work without https');

  const ok = await c.get('/api/config', { 'X-Forwarded-Proto': 'https' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('strict-transport-security'), /max-age=\d+/);
  assert.match(ok.headers.get('content-security-policy'), /upgrade-insecure-requests/);

  const up = await c.post('/api/signup', { email: 'a@example.com', password: PW }, { 'X-Forwarded-Proto': 'https', Origin: 'https://sumveri.example.com' });
  assert.equal(up.status, 200);
  assert.match(up.setCookie, /^__Host-sid=/);
  assert.match(up.setCookie, /; Secure/);
  assert.match(up.setCookie, /HttpOnly/);
  assert.match(up.setCookie, /SameSite=Strict/);
  assert.equal((await c.get('/api/me', { 'X-Forwarded-Proto': 'https' })).status, 200);
});

test('locally: no HSTS and no upgrade-insecure-requests, which break http://localhost in some browsers', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const r = await srv.client().get('/api/config');
  assert.equal(r.headers.get('strict-transport-security'), null);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('sign-ups can be closed, and the page is told', async (t) => {
  const srv = await startServer({ config: { allowSignup: false } });
  t.after(srv.close);
  const c = srv.client();
  assert.equal((await c.get('/api/config')).json.signup, false);
  const r = await c.post('/api/signup', { email: 'a@example.com', password: PW });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /turned off/);
});

test('public demo mode: the page loads, and every account and bank route is off', async (t) => {
  const srv = await startServer({ demoOnly: true });
  t.after(srv.close);
  const c = srv.client();
  assert.deepEqual((await c.get('/api/config')).json, { demoOnly: true, signup: false, env: 'sandbox' });
  assert.equal((await c.get('/healthz')).status, 200);
  const page = await fetch(srv.base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Sumveri<\/title>/);
  for (const [m, url] of [['post', '/api/signup'], ['post', '/api/login'], ['get', '/api/me'], ['get', '/api/transactions'], ['post', '/api/create_link_token'], ['post', '/api/exchange_public_token']]) {
    assert.equal((await c[m](url)).status, 404, m + ' ' + url);
  }
});

test('the app serves the shared finance code to the browser, and no server files', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  assert.equal((await fetch(srv.base + '/finance.js')).status, 200);
  for (const p of ['/server.js', '/lib/app.js', '/lib/store.js', '/.env', '/data/sumveri.enc', '/package.json']) {
    const r = await fetch(srv.base + p);
    assert.notEqual(r.status, 200, p + ' must not be served');
  }
});

test('two simultaneous sign-ups for one email over HTTP create one account', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const a = srv.client(), b = srv.client();
  const [ra, rb] = await Promise.all([
    a.post('/api/signup', { email: 'race@example.com', password: PW, name: 'A' }),
    b.post('/api/signup', { email: 'race@example.com', password: PW + '2', name: 'B' }),
  ]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
  const winner = ra.status === 200 ? a : b, loser = ra.status === 200 ? b : a;
  assert.equal((await winner.get('/api/me')).status, 200);
  assert.equal((await loser.get('/api/me')).status, 401, 'the request that lost is not signed in');
});

test('correcting a transaction is saved for that user, and nobody else can touch it', async (t) => {
  const bank = {
    'access-alice': { added: [tx('wire-1', -1200, { name: 'Wire transfer from client', personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'X' } })], accounts: [{ type: 'depository' }] },
    'access-bob': { added: [tx('bob-1', 5)], accounts: [{ type: 'depository' }] },
  };
  const srv = await startServer({ bank });
  t.after(srv.close);
  const alice = await signUp(srv, 'alice@example.com', 'Alice');
  const bob = await signUp(srv, 'bob@example.com', 'Bob');
  await connect(alice, 'alice');
  await connect(bob, 'bob');

  let a = (await alice.get('/api/transactions')).json.transactions;
  assert.equal(a[0].transfer, true);
  assert.equal(a[0].kind, undefined);

  assert.equal((await alice.post('/api/classify', { id: 'wire-1', kind: 'income' })).status, 200);
  a = (await alice.get('/api/transactions')).json.transactions;
  assert.equal(a[0].kind, 'income', 'the correction is remembered');

  // Bob can neither change nor see it
  assert.equal((await bob.post('/api/classify', { id: 'wire-1', kind: 'expense' })).status, 404);
  assert.equal((await alice.get('/api/transactions')).json.transactions[0].kind, 'income');
  assert.equal((await bob.get('/api/transactions')).json.transactions[0].kind, undefined);

  // bad input
  assert.equal((await alice.post('/api/classify', { id: 'wire-1', kind: 'gift' })).status, 400);
  assert.equal((await alice.post('/api/classify', { kind: 'income' })).status, 400);
  assert.equal((await alice.post('/api/classify', { id: 'does-not-exist', kind: 'income' })).status, 404);

  // null puts it back to automatic
  assert.equal((await alice.post('/api/classify', { id: 'wire-1', kind: null })).status, 200);
  assert.equal((await alice.get('/api/transactions')).json.transactions[0].kind, undefined);

  // needs sign-in
  assert.equal((await srv.client().post('/api/classify', { id: 'wire-1', kind: 'income' })).status, 401);
});

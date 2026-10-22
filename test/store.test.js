const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createStore } = require('../lib/store');
const { createUsers } = require('../lib/users');
const { randomKey, tmpDir } = require('./helpers');

test('saved data is encrypted: no readable email, token or merchant in the file', async () => {
  const dir = tmpDir(), key = randomKey();
  const store = createStore({ dir, hexKey: key });
  const users = createUsers(store);
  await users.signup({ email: 'secret.person@example.com', password: 'correct horse battery' });
  store.addItem({ userId: 'u', item_id: 'i', access_token: 'access-production-SECRETTOKEN', institution: 'First Bank', cursor: null });
  store.applySync('i', { added: [{ transaction_id: 't', amount: 5, name: 'UNIQUE MERCHANT NAME' }], modified: [], removed: [], cursor: 'c' });
  const raw = fs.readFileSync(store.file).toString('latin1');
  for (const secret of ['secret.person', 'SECRETTOKEN', 'UNIQUE MERCHANT', 'First Bank', 'correct horse']) assert.ok(!raw.includes(secret), secret + ' is readable in the file');
});

test('data survives a restart, and only the right key can open it', () => {
  const dir = tmpDir(), key = randomKey();
  const a = createStore({ dir, hexKey: key });
  a.addItem({ userId: 'u', item_id: 'i', access_token: 'x', institution: 'Bank', cursor: 'abc' });
  const b = createStore({ dir, hexKey: key });
  assert.equal(b.getItems('u')[0].cursor, 'abc');
  assert.throws(() => createStore({ dir, hexKey: randomKey() }), /Could not decrypt/);
  assert.throws(() => createStore({ dir: tmpDir(), hexKey: 'short' }), /64 hex/);
});

test('a tampered file is rejected, not half-read', () => {
  const dir = tmpDir(), key = randomKey();
  const s = createStore({ dir, hexKey: key });
  s.addItem({ userId: 'u', item_id: 'i', access_token: 'x', institution: 'Bank', cursor: null });
  const buf = fs.readFileSync(s.file);
  buf[buf.length - 3] ^= 0xff;
  fs.writeFileSync(s.file, buf);
  assert.throws(() => createStore({ dir, hexKey: key }), /Could not decrypt/);
});

test('the store file is private to its owner', { skip: process.platform === 'win32' }, () => {
  const s = createStore({ dir: tmpDir(), hexKey: randomKey() });
  assert.equal(fs.statSync(s.file).mode & 0o077, 0);
});

test('bank data is scoped to one user, and disconnecting removes only that user', () => {
  const store = createStore({ dir: tmpDir(), hexKey: randomKey() });
  store.addItem({ userId: 'A', item_id: 'iA', access_token: 'a', institution: 'Bank A', cursor: null });
  store.addItem({ userId: 'B', item_id: 'iB', access_token: 'b', institution: 'Bank B', cursor: null });
  store.applySync('iA', { added: [{ transaction_id: 'tA', amount: 1 }], modified: [], removed: [], cursor: 'c' });
  store.applySync('iB', { added: [{ transaction_id: 'tB', amount: 2 }], modified: [], removed: [], cursor: 'c' });
  assert.deepEqual(store.getTransactions('A').map((t) => t.transaction_id), ['tA']);
  assert.deepEqual(store.getTransactions('B').map((t) => t.transaction_id), ['tB']);
  assert.deepEqual(store.getItems('A').map((i) => i.institution), ['Bank A']);
  assert.deepEqual(store.getTransactions('nobody'), []);
  store.clearUser('A');
  assert.equal(store.getTransactions('A').length, 0);
  assert.equal(store.getTransactions('B').length, 1);
});

test('passwords are hashed with a unique salt, and session tokens are stored only as hashes', async () => {
  const store = createStore({ dir: tmpDir(), hexKey: randomKey() });
  const users = createUsers(store);
  const a = await users.signup({ email: 'a@example.com', password: 'the same password' });
  const b = await users.signup({ email: 'b@example.com', password: 'the same password' });
  const ua = store.findUserByEmail('a@example.com'), ub = store.findUserByEmail('b@example.com');
  assert.match(ua.pass, /^scrypt\$/);
  assert.ok(!ua.pass.includes('the same password'));
  assert.notEqual(ua.pass, ub.pass);
  assert.equal(store.getSession(a.token), null, 'the raw token is not a key in the store');
  assert.equal(users.userForToken(a.token).email, 'a@example.com');
  assert.equal(users.userForToken(b.token).email, 'b@example.com');
  assert.equal(users.userForToken('not-a-token'), null);
  users.endSession(a.token);
  assert.equal(users.userForToken(a.token), null);
});

test('expired sessions stop working', async () => {
  const store = createStore({ dir: tmpDir(), hexKey: randomKey() });
  const users = createUsers(store);
  const { token } = await users.signup({ email: 'a@example.com', password: 'a long password' });
  const realNow = Date.now;
  Date.now = () => realNow() + 8 * 24 * 3600 * 1000;
  try { assert.equal(users.userForToken(token), null); } finally { Date.now = realNow; }
});

test('the store itself refuses a second account with the same email', () => {
  const store = createStore({ dir: tmpDir(), hexKey: randomKey() });
  store.addUser({ id: '1', email: 'a@example.com', name: 'A', pass: 'x' });
  assert.throws(() => store.addUser({ id: '2', email: 'a@example.com', name: 'B', pass: 'y' }), { code: 'EMAIL_TAKEN' });
  assert.equal(store.findUserByEmail('a@example.com').id, '1');
});

test('two sign-ups for the same email at once create exactly one account', async () => {
  const dir = tmpDir(), key = randomKey();
  const store = createStore({ dir, hexKey: key });
  const users = createUsers(store);
  const results = await Promise.all([
    users.signup({ email: 'Same@Example.com', password: 'first-long-password', name: 'One' }),
    users.signup({ email: 'same@example.com', password: 'second-long-password', name: 'Two' }),
    users.signup({ email: 'same@example.com ', password: 'third-long-password', name: 'Three' }),
  ]);
  assert.equal(results.filter((r) => r.user).length, 1, 'exactly one succeeds');
  assert.deepEqual(results.filter((r) => !r.user).map((r) => r.status), [409, 409]);
  // and what was saved to disk has one account too
  const reopened = createStore({ dir, hexKey: key });
  const winner = results.find((r) => r.user).user;
  assert.equal(reopened.findUserByEmail('same@example.com').id, winner.id);
});

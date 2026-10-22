const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../lib/config');
const { randomKey } = require('./helpers');

const good = () => ({ PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret', ENCRYPTION_KEY: randomKey() });

test('running on your own computer needs only the Plaid keys and an encryption key', () => {
  const c = loadConfig(good());
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.hosted, false);
  assert.equal(c.port, 3000);
  assert.equal(c.allowSignup, true);
  assert.equal(c.secure, false);
  assert.equal(c.plaidEnv, 'sandbox');
  assert.match(c.dataDir, /data$/);
});

test('missing or malformed secrets stop the server from starting', () => {
  assert.throws(() => loadConfig({}), /PLAID_CLIENT_ID and PLAID_SECRET/);
  assert.throws(() => loadConfig(Object.assign(good(), { ENCRYPTION_KEY: 'abc' })), /ENCRYPTION_KEY/);
  assert.throws(() => loadConfig(Object.assign(good(), { PLAID_ENV: 'development' })), /PLAID_ENV/);
  assert.throws(() => loadConfig(Object.assign(good(), { PORT: 'abc' })), /PORT/);
  assert.throws(() => loadConfig(Object.assign(good(), { APP_URL: 'not a url' })), /APP_URL/);
});

test('hosting requires an https address and a trusted proxy', () => {
  const hosted = { HOST: '0.0.0.0' };
  assert.throws(() => loadConfig(Object.assign(good(), hosted)), /APP_URL/);
  assert.throws(() => loadConfig(Object.assign(good(), hosted, { APP_URL: 'http://example.com', TRUST_PROXY: '1' })), /https/);
  assert.throws(() => loadConfig(Object.assign(good(), hosted, { APP_URL: 'https://example.com' })), /TRUST_PROXY/);
  assert.throws(() => loadConfig(Object.assign(good(), hosted, { APP_URL: 'https://example.com', TRUST_PROXY: 'yes' })), /TRUST_PROXY/);
  const ok = loadConfig(Object.assign(good(), hosted, { APP_URL: 'https://example.com/ignored/path', TRUST_PROXY: '1', DATA_DIR: '/var/data' }));
  assert.equal(ok.hosted, true);
  assert.equal(ok.secure, true);
  assert.equal(ok.appUrl, 'https://example.com');
  assert.equal(ok.trustProxy, 1);
  assert.equal(ok.dataDir, '/var/data');
});

test('new sign-ups are off by default when hosted, and can be turned on deliberately', () => {
  const hosted = Object.assign(good(), { HOST: '0.0.0.0', APP_URL: 'https://example.com', TRUST_PROXY: '1' });
  assert.equal(loadConfig(hosted).allowSignup, false);
  assert.equal(loadConfig(Object.assign({}, hosted, { ALLOW_SIGNUP: 'true' })).allowSignup, true);
  assert.equal(loadConfig(Object.assign(good(), { ALLOW_SIGNUP: 'false' })).allowSignup, false);
});

test('a public demo needs no secrets at all', () => {
  const c = loadConfig({ DEMO_ONLY: 'true', HOST: '0.0.0.0', APP_URL: 'https://demo.example.com', TRUST_PROXY: '1' });
  assert.equal(c.demoOnly, true);
  assert.equal(c.encryptionKey, undefined);
  assert.throws(() => loadConfig({ DEMO_ONLY: 'true', HOST: '0.0.0.0' }), /APP_URL/, 'even a demo must be https when public');
});

// Shared test helpers. Not a test file.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('../lib/app');
const { createStore } = require('../lib/store');
const { createUsers } = require('../lib/users');

const randomKey = () => crypto.randomBytes(32).toString('hex');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sumveri-test-'));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

// A stand-in for Plaid. `bank` maps an access token to the transactions and accounts it should return.
function fakePlaid(bank) {
  const removed = [];
  return {
    removed,
    async linkTokenCreate() { return { data: { link_token: 'link-sandbox-test' } }; },
    async itemPublicTokenExchange({ public_token }) {
      const id = public_token.replace(/^public-/, '');
      return { data: { item_id: 'item-' + id, access_token: 'access-' + id } };
    },
    async transactionsSync({ access_token, cursor }) {
      const b = bank[access_token] || { added: [], accounts: [] };
      return { data: { added: cursor ? [] : b.added, modified: [], removed: [], has_more: false, next_cursor: 'cursor-1', accounts: b.accounts || [] } };
    },
    async itemRemove({ access_token }) { removed.push(access_token); return { data: {} }; },
  };
}

function baseConfig(over) {
  return Object.assign({
    demoOnly: false, host: '127.0.0.1', hosted: false, port: 0, appUrl: '', trustProxy: false, secure: false,
    plaidEnv: 'sandbox', allowSignup: true, authLimit: 1000,
  }, over);
}

// Starts the real web app on a free port with a temporary encrypted store.
async function startServer({ config = {}, bank = {}, demoOnly = false } = {}) {
  const port = await freePort();
  const cfg = baseConfig(Object.assign({ port, demoOnly }, config));
  let store = null, users = null, plaid = null;
  if (!demoOnly) {
    store = createStore({ dir: tmpDir(), hexKey: randomKey() });
    users = createUsers(store);
    plaid = fakePlaid(bank);
  }
  const app = createApp({ config: cfg, store, users, plaid });
  const server = await new Promise((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${port}`;

  // A tiny browser: remembers one cookie.
  function client() {
    let cookie = '';
    const api = {
      get cookie() { return cookie; },
      set cookie(v) { cookie = v; },
      async call(method, url, body, headers) {
        const res = await fetch(base + url, {
          method, redirect: 'manual',
          headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, headers || {}),
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const set = res.headers.get('set-cookie');
        if (set) { const pair = set.split(';')[0]; cookie = /=$/.test(pair) ? '' : pair; }
        let json = null;
        try { json = await res.clone().json(); } catch (e) { /* not JSON */ }
        return { status: res.status, json, headers: res.headers, setCookie: set };
      },
      get: (url, headers) => api.call('GET', url, undefined, headers),
      post: (url, body, headers) => api.call('POST', url, body === undefined ? {} : body, headers),
    };
    return api;
  }
  return { base, port, config: cfg, store, users, plaid, client, close: () => new Promise((r) => { server.close(r); server.closeAllConnections && server.closeAllConnections(); }) };
}

module.exports = { randomKey, tmpDir, freePort, fakePlaid, baseConfig, startServer };

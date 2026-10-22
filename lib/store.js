// Encrypted storage for accounts, sessions, bank connections and transactions.
// Everything is written to one file, sumveri.enc, using AES-256-GCM. The key lives in the environment, not next to the data.
// One server process owns this file. Do not run two copies against the same folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore({ dir, hexKey }) {
  if (!/^[0-9a-f]{64}$/i.test(hexKey || '')) throw new Error('ENCRYPTION_KEY must be 64 hex characters.');
  const key = Buffer.from(hexKey, 'hex');
  const file = path.join(dir, 'sumveri.enc');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const fresh = () => ({ users: [], sessions: {}, items: [], transactions: {}, kinds: {} });
  let state = fresh();

  function encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  }
  function decrypt(buf) {
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  }
  function save() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, encrypt(state), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  if (fs.existsSync(file)) {
    try { state = Object.assign(fresh(), decrypt(fs.readFileSync(file))); }
    catch (e) { throw new Error('Could not decrypt ' + file + '. Is ENCRYPTION_KEY the same one you used before?'); }
  } else {
    save(); // fails now, not later, if the folder is not writable
  }

  const itemIds = (userId) => new Set(state.items.filter((i) => i.userId === userId).map((i) => i.item_id));

  return {
    file,
    // Accounts
    findUserByEmail: (email) => state.users.find((u) => u.email === email) || null,
    findUserById: (id) => state.users.find((u) => u.id === id) || null,
    // The uniqueness check and the insert happen in the same synchronous step, so two sign-ups for one email can't both
    // succeed, however their requests interleave. Callers handle the EMAIL_TAKEN error.
    addUser(user) {
      if (state.users.some((u) => u.email === user.email)) {
        const e = new Error('An account with that email already exists.');
        e.code = 'EMAIL_TAKEN';
        throw e;
      }
      state.users.push(user);
      save();
    },
    // Sessions, keyed by a hash of the cookie token
    putSession(hash, s) {
      const now = Date.now();
      for (const h of Object.keys(state.sessions)) if (state.sessions[h].exp < now) delete state.sessions[h];
      state.sessions[hash] = s; save();
    },
    getSession(hash) {
      const s = state.sessions[hash];
      if (!s) return null;
      if (s.exp < Date.now()) { delete state.sessions[hash]; save(); return null; }
      return s;
    },
    deleteSession(hash) { if (state.sessions[hash]) { delete state.sessions[hash]; save(); } },
    // Bank data. Every read is scoped to one user.
    getItems: (userId) => state.items.filter((i) => i.userId === userId),
    addItem(item) {
      state.items = state.items.filter((i) => i.item_id !== item.item_id).concat(item);
      save();
    },
    applySync(itemId, { added, modified, removed, cursor, hasCredit }) {
      for (const t of added.concat(modified)) { t.item_id = itemId; state.transactions[t.transaction_id] = t; }
      for (const r of removed) delete state.transactions[r.transaction_id];
      const it = state.items.find((i) => i.item_id === itemId);
      if (it) {
        it.cursor = cursor;
        if (hasCredit !== undefined) it.hasCredit = !!hasCredit;
      }
      save();
    },
    getTransactions(userId) {
      const ids = itemIds(userId);
      return Object.values(state.transactions).filter((t) => ids.has(t.item_id));
    },
    // Corrections to how a transaction is counted (income, expense or transfer), per user.
    getKinds: (userId) => Object.assign({}, state.kinds[userId]),
    // Returns false when the transaction does not belong to this user. kind null removes the correction.
    setKind(userId, txId, kind) {
      const ids = itemIds(userId);
      const t = state.transactions[txId];
      if (!t || !ids.has(t.item_id)) return false;
      const mine = state.kinds[userId] || (state.kinds[userId] = {});
      if (kind) mine[txId] = kind; else delete mine[txId];
      save();
      return true;
    },
    clearUser(userId) {
      delete state.kinds[userId];
      const ids = itemIds(userId);
      state.items = state.items.filter((i) => i.userId !== userId);
      for (const id of Object.keys(state.transactions)) if (ids.has(state.transactions[id].item_id)) delete state.transactions[id];
      save();
    },
  };
}

module.exports = { createStore };

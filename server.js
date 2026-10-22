require('dotenv').config({ quiet: true });
const { loadConfig } = require('./lib/config');
const { createApp } = require('./lib/app');

let config;
try { config = loadConfig(process.env); }
catch (e) { console.error('\nSetup problem:\n' + e.message + '\n\nSee README.md (running locally) or docs/HOSTING.md (hosting).\n'); process.exit(1); }

let store = null, users = null, plaid = null;
if (!config.demoOnly) {
  const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
  const { createStore } = require('./lib/store');
  const { createUsers } = require('./lib/users');
  try { store = createStore({ dir: config.dataDir, hexKey: config.encryptionKey }); }
  catch (e) { console.error('\nSetup problem: ' + e.message + '\n'); process.exit(1); }
  users = createUsers(store);
  plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[config.plaidEnv],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': config.plaidClientId, 'PLAID-SECRET': config.plaidSecret } },
  }));
}

const app = createApp({ config, store, users, plaid });
// Your own computer by default. Set HOST=0.0.0.0 only when hosting (see docs/HOSTING.md).
app.listen(config.port, config.host, () => {
  const where = config.hosted ? config.appUrl : `http://localhost:${config.port}`;
  const mode = config.demoOnly ? 'public demo, no accounts' : `${config.plaidEnv} mode`;
  console.log(`\nSumveri is running (${mode}).\nOpen ${where}\n`);
});

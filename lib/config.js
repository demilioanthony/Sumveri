// Reads settings from the environment and refuses to start with an unsafe or incomplete setup.
const path = require('path');

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

function loadConfig(env) {
  const errors = [];
  const demoOnly = env.DEMO_ONLY === 'true';
  const host = env.HOST || '127.0.0.1';
  const hosted = !LOCAL_HOSTS.includes(host);
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT must be a number from 0 to 65535.');

  let appUrl = '';
  if (env.APP_URL) {
    try { appUrl = new URL(env.APP_URL).origin; }
    catch (e) { errors.push('APP_URL is not a valid address. Example: https://sumveri.example.com'); }
  }
  let trustProxy = false;
  if (env.TRUST_PROXY) {
    trustProxy = Number(env.TRUST_PROXY);
    if (!Number.isInteger(trustProxy) || trustProxy < 1) errors.push('TRUST_PROXY must be a whole number of proxies, such as 1.');
  }
  if (hosted) {
    if (!appUrl.startsWith('https://')) errors.push('Hosting (HOST=' + host + ') needs APP_URL set to your public https:// address.');
    if (!trustProxy) errors.push('Hosting needs TRUST_PROXY=1 when a proxy in front of the app handles HTTPS. Without it, every visitor looks like the same address and HTTPS cannot be checked.');
  }

  const plaidEnv = env.PLAID_ENV || 'sandbox';
  if (!demoOnly) {
    if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) errors.push('PLAID_CLIENT_ID and PLAID_SECRET are missing.');
    if (!['sandbox', 'production'].includes(plaidEnv)) errors.push('PLAID_ENV must be "sandbox" or "production".');
    if (!/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY || '')) errors.push('ENCRYPTION_KEY must be 64 hex characters. Run: npm run make-key');
  }
  if (errors.length) throw new Error(errors.map((e) => '- ' + e).join('\n'));

  return {
    demoOnly, host, hosted, port, appUrl, trustProxy,
    secure: appUrl.startsWith('https://'),
    plaidEnv,
    plaidClientId: env.PLAID_CLIENT_ID,
    plaidSecret: env.PLAID_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
    // New accounts are on by default on your own computer and off by default when hosted.
    allowSignup: env.ALLOW_SIGNUP ? env.ALLOW_SIGNUP === 'true' : !hosted,
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(__dirname, '..', 'data'),
    authLimit: 20,
  };
}

module.exports = { loadConfig };

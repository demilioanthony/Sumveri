# Hosting Sumveri

Sumveri runs on your own computer by default (`127.0.0.1` only). Hosting is a deliberate switch: the server refuses to start on a public address until HTTPS and proxy settings are in place.

## Two ways to host

**1. Public demo (recommended for a portfolio).** Set `DEMO_ONLY=true`. The server serves the app with sample data only. It needs no Plaid keys, no encryption key and stores nothing. Account and bank routes return 404, so visitors cannot create accounts or connect banks. Anyone can open it and click around safely.

**2. Full app with real accounts.** Needs persistent storage, a strong `ENCRYPTION_KEY`, Plaid keys and HTTPS. Read "Before real users" below first.

You can also copy the `public/` folder to any static host. With no server behind it, the page detects that and runs the demo.

## Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `HOST` | hosting | `0.0.0.0` to accept outside connections. Any non-local value turns on hosted checks. |
| `PORT` | always | Default 3000. Many hosts set this for you. |
| `APP_URL` | hosting | Your public address, `https://...` only. Used for the origin allow-list and secure cookies. |
| `TRUST_PROXY` | hosting | `1` when one proxy (your host's load balancer) sits in front. Required, so HTTPS and visitor addresses are read correctly. |
| `DEMO_ONLY` | public demo | `true` for sample data only. Removes the need for the three values below. |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | full app | `sandbox` or `production`. |
| `ENCRYPTION_KEY` | full app | 64 hex characters (`npm run make-key`). Set it in the host's secret settings, never in the repo. |
| `DATA_DIR` | full app | Folder for the encrypted `sumveri.enc` file. Must be on a persistent disk. |
| `ALLOW_SIGNUP` | full app | Defaults to `false` when hosted. Set `true` to let anyone register. |

## What hosting changes

- **HTTPS.** Terminate HTTPS at your host or proxy. In hosted mode the app redirects plain HTTP to HTTPS, sends HSTS, and uses a `__Host-sid` cookie marked Secure.
- **Persistent storage.** Everything lives in one encrypted file in `DATA_DIR`. Many hosts wipe the disk on every deploy; mount a persistent volume or you will lose all accounts. Back the file up, and keep a copy of the key somewhere separate: without the key the file cannot be read.
- **One instance only.** The file store has no locking across processes. Run exactly one copy of the server.
- **Health check.** `GET /healthz` returns 200 if the server is up.
- **Demo restrictions.** In `DEMO_ONLY` mode no data is read or written, and the only routes are the static files, `/healthz` and `/api/config`.

## Before real users

Honest list of what this project does not have yet: password reset, email verification, two-factor sign-in, account deletion, per-user encryption keys, and multi-instance support. Plaid Production access also needs an approved application, a privacy policy and Plaid's review. Until those exist, keep `ALLOW_SIGNUP=false` on a hosted copy, or use the public demo.

Not provided: a Dockerfile or platform config. None has been tested here, so none is included.

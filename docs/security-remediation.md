# Security Remediation — Secrets and Financial Data in Git History

> Status: **OPEN** as of 2026-06-11. The working tree no longer tracks these
> files, but they remain in git history on `origin` until the steps below are
> completed. Do them in order.

## What was exposed

Committed and pushed to the private GitHub repo `dataweston/Local-Budget`:

- `.env` — production Plaid secret, Square access token + application secret,
  database connection strings, `NEXTAUTH_SECRET`
- `imports/sofi/*.pdf` — real SoFi bank statements
- `ledger-pending-transactions-detail.json` — transaction data
- `tmp-query.js`

## Step 1 — Rotate every credential (do this FIRST)

History rewriting without rotation leaves you exposed; rotation without
rewriting still works. Rotate first.

1. **Plaid**: Dashboard → Team Settings → Keys → rotate the production secret.
2. **Square**: Developer Dashboard → your app → Credentials → replace the
   access token; OAuth → rotate the application secret.
3. **Database**: reset the Postgres password / connection string in the
   Vercel (Prisma Postgres) dashboard.
4. **NextAuth**: `openssl rand -base64 32` → new `NEXTAUTH_SECRET`
   (this signs sessions; rotating logs everyone out, which is fine).
5. Put the new values in **Vercel → Project → Settings → Environment
   Variables**, and update the local `.env` (now untracked). The
   local-effort-app sidecar reads `c:/Users/user/Local Budget/.env` from disk,
   so keep the local file current until those consumers move to the
   integration API.

## Step 2 — Rewrite history

After rotation, from a fresh clone:

```bash
pip install git-filter-repo
git clone https://github.com/dataweston/Local-Budget.git lb-rewrite
cd lb-rewrite
git filter-repo \
  --invert-paths \
  --path .env \
  --path imports \
  --path ledger-pending-transactions-detail.json \
  --path tmp-query.js
git remote add origin https://github.com/dataweston/Local-Budget.git
git push --force --all origin
git push --force --tags origin
```

Then re-clone or `git fetch && git reset --hard origin/main` in the working
copy. GitHub support can purge cached views of the old commits if desired
(Settings → "remove cached views" request, or contact support).

## Step 3 — Prevent recurrence

- CI runs gitleaks on every push (`.github/workflows/ci.yml`).
- `.gitignore` now covers `.env`, `imports/`, `uploads/`, `ledger-*.json`,
  `tmp-*.js`.
- New machine-auth env vars are documented in `.env.example` with
  placeholders only.

/**
 * Load .env.local / .env into process.env for standalone scripts.
 *
 * Prisma and tsx only auto-load `.env`, but this repo keeps DATABASE_URL in
 * `.env.local` — without this, every `npm run <script>` needs the URL exported
 * by hand (and `export` doesn't even exist in PowerShell). Import this first.
 * Real environment variables always win over file values.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

for (const file of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (key in process.env) continue;
    const quoted =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"));
    process.env[key] = quoted ? raw.slice(1, -1) : raw;
  }
}

import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { PrismaClient, TransactionStatus, TransactionType } from '@prisma/client';
import { getAmazonCategoryTargets, getAmazonRoutingCategoryId } from '../src/lib/amazon-routing';
import { getVenmoBankRouting } from '../src/lib/venmo-routing';

type ParsedArgs = {
  accountId?: string;
  dryRun: boolean;
  files: string[];
};

type CsvRow = Record<string, string>;

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { dryRun: false, files: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--account-id') {
      out.accountId = argv[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith('--account-id=')) {
      out.accountId = arg.slice('--account-id='.length);
      continue;
    }
    out.files.push(arg);
  }

  // npm on some shells strips unknown flags; support positional fallback:
  //   npm run import:csv -- <accountId> <file1.csv> [file2.csv ...] [dry-run]
  if (!out.accountId && out.files.length >= 2) {
    out.accountId = out.files[0];
    out.files = out.files.slice(1);
  }

  const dryAliases = new Set(['dry-run', 'dryrun', '--dryrun']);
  out.files = out.files.filter((f) => {
    if (dryAliases.has(f.toLowerCase())) {
      out.dryRun = true;
      return false;
    }
    return true;
  });

  return out;
}

function usage() {
  console.log(
    [
      'Usage:',
      '  npm run import:csv -- --account-id <ACCOUNT_ID> <file1.csv|folder|glob> [more files...] [--dry-run]',
      '',
      'Notes:',
      '  - Auto-detects common Date/Description/Amount headers.',
      '  - Accepts individual files, folders (all .csv), or simple globs like imports/*.csv.',
      '  - Amount sign convention assumes bank CSVs: negative = expense, positive = income.',
      '  - Uses stable CSV-based external IDs so re-importing the same rows will skip duplicates.',
    ].join('\n')
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((x) => x.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    if (ch === '\r') {
      continue;
    }
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((x) => x.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findHeaderIndex(headers: string[], names: string[]): number {
  const normalized = headers.map(normalizeHeader);
  const wanted = names.map(normalizeHeader);

  for (const target of wanted) {
    const idx = normalized.indexOf(target);
    if (idx >= 0) return idx;
  }
  for (const target of wanted) {
    const idx = normalized.findIndex((h) => h.includes(target));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseMoney(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;

  const isParenNegative = value.startsWith('(') && value.endsWith(')');
  const stripped = value
    .replace(/[,$\s]/g, '')
    .replace(/[()]/g, '');

  if (!stripped) return null;
  const parsed = Number.parseFloat(stripped);
  if (Number.isNaN(parsed)) return null;
  return isParenNegative ? -parsed : parsed;
}

function parseDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const m = value.match(us);
  if (m) {
    const month = Number.parseInt(m[1], 10);
    const day = Number.parseInt(m[2], 10);
    let year = Number.parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }

  return null;
}

function toRows(filePath: string): { headers: string[]; rows: CsvRow[] } {
  const content = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const matrix = parseCsv(content);
  if (matrix.length < 2) {
    throw new Error(`No data rows found in ${filePath}`);
  }

  const headers = matrix[0];
  const rows: CsvRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const rowCells = matrix[i];
    const row: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (rowCells[c] ?? '').trim();
    }
    rows.push(row);
  }

  return { headers, rows };
}

function canonicalRow(row: CsvRow): string {
  const keys = Object.keys(row).sort((a, b) => a.localeCompare(b));
  return keys.map((k) => `${k}=${row[k] ?? ''}`).join('|');
}

function hasWildcard(input: string): boolean {
  return input.includes('*') || input.includes('?');
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regex, 'i');
}

function expandInputPaths(inputs: string[]): string[] {
  const expanded: string[] = [];

  for (const input of inputs) {
    const resolved = path.resolve(process.cwd(), input);

    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      const files = readdirSync(resolved)
        .filter((f) => f.toLowerCase().endsWith('.csv'))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => path.join(resolved, f));
      expanded.push(...files);
      continue;
    }

    if (hasWildcard(input)) {
      const dirPart = path.dirname(input);
      const basePart = path.basename(input);
      const dir = path.resolve(process.cwd(), dirPart === '.' ? '' : dirPart);

      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        throw new Error(`Glob directory not found: ${dir}`);
      }

      const pattern = wildcardToRegex(basePart);
      const files = readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.csv') && pattern.test(f))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => path.join(dir, f));
      expanded.push(...files);
      continue;
    }

    expanded.push(resolved);
  }

  return Array.from(new Set(expanded));
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    if (!args.accountId || args.files.length === 0) {
      usage();
      const accounts = await prisma.financialAccount.findMany({
        select: { id: true, name: true, institution: true, type: true },
        orderBy: [{ institution: 'asc' }, { name: 'asc' }],
      });
      if (accounts.length > 0) {
        console.log('\nAvailable account IDs:');
        for (const a of accounts) {
          console.log(`  ${a.id}  |  ${a.name} (${a.type})  |  ${a.institution ?? 'Unknown institution'}`);
        }
      }
      process.exit(1);
    }

    const account = await prisma.financialAccount.findUnique({
      where: { id: args.accountId },
      select: { id: true, name: true, userId: true },
    });

    if (!account) {
      throw new Error(`Account not found: ${args.accountId}`);
    }
    const amazonTargets = await getAmazonCategoryTargets(prisma, account.userId);

    const importFiles = expandInputPaths(args.files);
    if (importFiles.length === 0) {
      throw new Error('No CSV files found from the provided inputs.');
    }

    let totalParsed = 0;
    let totalSkipped = 0;
    let totalInserted = 0;

    for (const inputFile of importFiles) {
      const filePath = path.resolve(process.cwd(), inputFile);
      const { headers, rows } = toRows(filePath);

      const dateIdx = findHeaderIndex(headers, [
        'date',
        'posted date',
        'post date',
        'posting date',
        'transaction date',
      ]);
      const descriptionIdx = findHeaderIndex(headers, [
        'description',
        'details',
        'memo',
        'merchant',
        'name',
        'transaction',
      ]);
      const amountIdx = findHeaderIndex(headers, ['amount', 'amount usd', 'transaction amount']);
      const debitIdx = findHeaderIndex(headers, ['debit', 'withdrawal']);
      const creditIdx = findHeaderIndex(headers, ['credit', 'deposit']);

      if (dateIdx < 0 || descriptionIdx < 0 || (amountIdx < 0 && debitIdx < 0 && creditIdx < 0)) {
        throw new Error(
          [
            `Could not detect required columns in ${inputFile}.`,
            `Detected headers: ${headers.join(', ')}`,
            'Need Date + Description + (Amount OR Debit/Credit).',
          ].join('\n')
        );
      }

      const dateHeader = headers[dateIdx];
      const descriptionHeader = headers[descriptionIdx];
      const amountHeader = amountIdx >= 0 ? headers[amountIdx] : null;
      const debitHeader = debitIdx >= 0 ? headers[debitIdx] : null;
      const creditHeader = creditIdx >= 0 ? headers[creditIdx] : null;

      const toCreate: Array<{
        accountId: string;
        amount: number;
        type: TransactionType;
        status: TransactionStatus;
        date: Date;
        description: string;
        merchantName?: string;
        externalId: string;
        isReviewed: boolean;
      }> = [];

      let parsedForFile = 0;
      let skippedForFile = 0;

      for (const row of rows) {
        const rawDate = row[dateHeader] ?? '';
        const rawDescription = row[descriptionHeader] ?? '';
        const date = parseDate(rawDate);
        const description = rawDescription.trim();

        let signedAmount: number | null = null;
        if (amountHeader) {
          signedAmount = parseMoney(row[amountHeader] ?? '');
        } else {
          const debit = debitHeader ? parseMoney(row[debitHeader] ?? '') : null;
          const credit = creditHeader ? parseMoney(row[creditHeader] ?? '') : null;
          const debitVal = debit ? Math.abs(debit) : 0;
          const creditVal = credit ? Math.abs(credit) : 0;
          if (debitVal > 0 || creditVal > 0) {
            signedAmount = creditVal - debitVal;
          }
        }

        if (!date || !description || signedAmount === null || signedAmount === 0) {
          skippedForFile++;
          continue;
        }

        const amountAbs = Math.abs(signedAmount);
        const venmoRouting = getVenmoBankRouting({
          description,
          merchantName: description,
        });
        const type = venmoRouting?.type ?? (signedAmount < 0 ? 'EXPENSE' : 'INCOME');
        const amazonCategoryId =
          type === 'EXPENSE'
            ? getAmazonRoutingCategoryId(
                { description, merchantName: description },
                amazonTargets
              )
            : null;

        const digest = createHash('sha1')
          .update([
            account.id,
            date.toISOString().slice(0, 10),
            description,
            amountAbs.toFixed(4),
            canonicalRow(row),
          ].join('|'))
          .digest('hex');

        toCreate.push({
          accountId: account.id,
          amount: amountAbs,
          type,
          status: 'POSTED',
          date,
          description: description.slice(0, 500),
          merchantName: description.slice(0, 200),
          ...(venmoRouting
            ? { classification: venmoRouting.classification }
            : amazonCategoryId
              ? { categoryId: amazonCategoryId }
              : {}),
          externalId: `csv:${digest}`,
          isReviewed: false,
        });
        parsedForFile++;
      }

      let insertedForFile = 0;
      if (!args.dryRun && toCreate.length > 0) {
        const result = await prisma.transaction.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
        insertedForFile = result.count;
      } else if (args.dryRun) {
        insertedForFile = toCreate.length;
      }

      totalParsed += parsedForFile;
      totalSkipped += skippedForFile;
      totalInserted += insertedForFile;

      console.log(
        [
          '',
          `File: ${path.relative(process.cwd(), filePath) || filePath}`,
          `  parsed:   ${parsedForFile}`,
          `  skipped:  ${skippedForFile}`,
          `  ${args.dryRun ? 'would insert' : 'inserted'}: ${insertedForFile}`,
        ].join('\n')
      );
    }

    console.log(
      [
        '',
        `Account: ${account.name} (${account.id})`,
        `Total parsed: ${totalParsed}`,
        `Total skipped: ${totalSkipped}`,
        `Total ${args.dryRun ? 'would insert' : 'inserted'}: ${totalInserted}`,
        args.dryRun
          ? 'Dry run only. Re-run without --dry-run to persist.'
          : 'Import complete.',
      ].join('\n')
    );
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

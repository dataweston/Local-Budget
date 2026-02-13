import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { PrismaClient, TransactionStatus, TransactionType } from '@prisma/client';
import { getAmazonCategoryTargets, getAmazonRoutingCategoryId } from '../src/lib/amazon-routing';

const pdfParse = require('pdf-parse') as (
  dataBuffer: Buffer
) => Promise<{ text: string; numpages: number }>;

type ParsedArgs = {
  accountId?: string;
  dryRun: boolean;
  yearHint?: number;
  files: string[];
};

type ParsedStatementRow = {
  date: Date;
  description: string;
  amountAbs: number;
  sign: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';
  rawLine: string;
  balance?: number;
};

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

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
    if (arg === '--year' || arg === '--year-hint') {
      const val = Number.parseInt(argv[i + 1] ?? '', 10);
      if (!Number.isNaN(val)) out.yearHint = val;
      i++;
      continue;
    }
    if (arg.startsWith('--year=')) {
      const val = Number.parseInt(arg.slice('--year='.length), 10);
      if (!Number.isNaN(val)) out.yearHint = val;
      continue;
    }
    if (arg.startsWith('--year-hint=')) {
      const val = Number.parseInt(arg.slice('--year-hint='.length), 10);
      if (!Number.isNaN(val)) out.yearHint = val;
      continue;
    }
    out.files.push(arg);
  }

  // Positional fallback for shell/npm compatibility:
  // npm run import:pdf -- <accountId> <file.pdf|glob> [dry-run]
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
      '  npm run import:pdf -- --account-id <ACCOUNT_ID> <file.pdf|folder|glob> [more files...] [--year 2025] [--dry-run]',
      '',
      'Examples:',
      '  npm run import:pdf -- cmk4ma62e0003uaxyqm3qeo5h .\\imports\\sofi\\*.pdf dry-run',
      '  npm run import:pdf -- --account-id cmk4ma62e0003uaxyqm3qeo5h .\\imports\\sofi --year 2025',
      '',
      'Notes:',
      '  - Designed for text-based bank PDFs (not scanned image-only PDFs).',
      '  - Parses rows with date + description + amount, and infers signs from symbols/keywords/balance deltas.',
      '  - Uses stable PDF-based external IDs so re-importing the same files skips duplicates.',
    ].join('\n')
  );
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
        .filter((f) => f.toLowerCase().endsWith('.pdf'))
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
        .filter((f) => f.toLowerCase().endsWith('.pdf') && pattern.test(f))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => path.join(dir, f));
      expanded.push(...files);
      continue;
    }

    expanded.push(resolved);
  }

  return Array.from(new Set(expanded));
}

function parseDateToken(rawDate: string, fallbackYear: number): Date | null {
  const value = rawDate.trim();
  if (!value) return null;

  const monthName = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})$/i;
  const withYear = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const noYear = /^(\d{1,2})\/(\d{1,2})$/;

  const monthNameMatch = value.match(monthName);
  if (monthNameMatch) {
    const monthMap: Record<string, number> = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      sept: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const mon = monthMap[monthNameMatch[1].toLowerCase()];
    const day = Number.parseInt(monthNameMatch[2], 10);
    const year = Number.parseInt(monthNameMatch[3], 10);
    if (Number.isInteger(mon) && !Number.isNaN(day) && !Number.isNaN(year)) {
      return new Date(Date.UTC(year, mon, day));
    }
  }

  const withYearMatch = value.match(withYear);
  if (withYearMatch) {
    const month = Number.parseInt(withYearMatch[1], 10);
    const day = Number.parseInt(withYearMatch[2], 10);
    let year = Number.parseInt(withYearMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const noYearMatch = value.match(noYear);
  if (noYearMatch) {
    const month = Number.parseInt(noYearMatch[1], 10);
    const day = Number.parseInt(noYearMatch[2], 10);
    return new Date(Date.UTC(fallbackYear, month - 1, day));
  }

  return null;
}

function parseMoney(raw: string): { value: number; explicitSign: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasNegativeSymbol = trimmed.includes('-');
  const isParenNegative = trimmed.startsWith('(') && trimmed.endsWith(')');

  const stripped = trimmed
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, '');

  if (!stripped) return null;

  const numeric = Number.parseFloat(stripped);
  if (Number.isNaN(numeric)) return null;

  const explicitSign = hasNegativeSymbol || isParenNegative;
  const signed = hasNegativeSymbol || isParenNegative ? -Math.abs(numeric) : Math.abs(numeric);
  return { value: signed, explicitSign };
}

function inferStatementYear(text: string, yearHint?: number): number {
  if (yearHint) return yearHint;

  // Prefer statement period end year when present.
  const rangeRegex = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:-|to)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  const match = rangeRegex.exec(text);
  if (match) {
    const end = match[2];
    const m = end.match(/\/(\d{2,4})$/);
    if (m) {
      let y = Number.parseInt(m[1], 10);
      if (y < 100) y += 2000;
      if (!Number.isNaN(y)) return y;
    }
  }

  const years = Array.from(text.matchAll(/\b20\d{2}\b/g))
    .map((m) => Number.parseInt(m[0], 10))
    .filter((n) => !Number.isNaN(n));
  if (years.length > 0) return Math.max(...years);

  return new Date().getFullYear();
}

function sanitizeLine(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function isHeaderOrNoise(line: string): boolean {
  const l = line.toLowerCase();
  if (!l) return true;
  if (l.includes('statement period')) return true;
  if (l.includes('beginning balance')) return true;
  if (l.includes('ending balance')) return true;
  if (l.includes('account number')) return true;
  if (l.includes('member fdic')) return true;
  if (l.startsWith('page ')) return true;
  if (l.includes('date description')) return true;
  if (l.includes('transactions') && l.length < 40) return true;
  return false;
}

function normalizeDescription(desc: string): string {
  return desc
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePdfRows(text: string, yearHint?: number): ParsedStatementRow[] {
  const rows: ParsedStatementRow[] = [];
  const fallbackYear = inferStatementYear(text, yearHint);
  const lines = text.split(/\r?\n/).map(sanitizeLine).filter(Boolean);

  // Strategy 1: SoFi-style blocks:
  // "Oct 30, 2025Debit Card..." + later line with "-$20.00$64.54"
  const monthStartRegex =
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i;
  const amountOnlyLineRegex = /^[\s\-$(),.\d]+$/;
  const moneyRegex = /(?:\(\s*)?-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})(?:\s*\))?/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeaderOrNoise(line)) continue;

    const monthMatch = line.match(monthStartRegex);
    if (!monthMatch) continue;

    const dateToken = monthMatch[0];
    const date = parseDateToken(dateToken, fallbackYear);
    if (!date) continue;

    const rawBlock: string[] = [line];
    const descParts: string[] = [];
    const lineRemainder = line.slice(dateToken.length).trim();
    if (lineRemainder) descParts.push(lineRemainder);

    let amountToken: string | null = null;
    let balanceToken: string | null = null;

    let j = i + 1;
    while (j < lines.length && !monthStartRegex.test(lines[j])) {
      const nextLine = lines[j];
      rawBlock.push(nextLine);
      const lower = nextLine.toLowerCase();

      if (lower.startsWith('transaction id:')) {
        j++;
        continue;
      }

      const moneyTokens = nextLine.match(moneyRegex) ?? [];
      if (moneyTokens.length > 0 && amountOnlyLineRegex.test(nextLine)) {
        amountToken = moneyTokens[0] ?? null;
        balanceToken = moneyTokens.length >= 2 ? moneyTokens[1] : null;
        j++;
        break;
      }

      // Continuation lines for long descriptions.
      if (!isHeaderOrNoise(nextLine)) {
        descParts.push(nextLine);
      }
      j++;
    }

    if (!amountToken) {
      i = j - 1;
      continue;
    }

    const parsedAmount = parseMoney(amountToken);
    if (!parsedAmount) {
      i = j - 1;
      continue;
    }

    const parsedBalance = balanceToken ? parseMoney(balanceToken) : null;
    const description = normalizeDescription(descParts.join(' '));
    if (!description) {
      i = j - 1;
      continue;
    }

    // Ignore statement summary/header rows (not real transactions).
    if (
      /\bcurrent balance\b/i.test(description) ||
      /\bbeginning balance\b/i.test(description) ||
      /\bending balance\b/i.test(description)
    ) {
      i = j - 1;
      continue;
    }

    rows.push({
      date,
      description: description.slice(0, 500),
      amountAbs: Math.abs(parsedAmount.value),
      // For SoFi statements, positive values are credits, negatives are debits.
      sign: parsedAmount.value < 0 ? 'NEGATIVE' : 'POSITIVE',
      rawLine: rawBlock.join(' | '),
      balance: parsedBalance ? Math.abs(parsedBalance.value) : undefined,
    });

    i = j - 1;
  }

  if (rows.length > 0) {
    return rows;
  }

  // Strategy 2: generic inline rows (MM/DD + amount on same line).
  const inlineRows: ParsedStatementRow[] = [];
  const dateAtStart = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.+)$/;

  for (const line of lines) {
    if (isHeaderOrNoise(line)) continue;

    const dateMatch = line.match(dateAtStart);
    if (!dateMatch) continue;

    const dateToken = dateMatch[1];
    const rest = dateMatch[2];
    const date = parseDateToken(dateToken, fallbackYear);
    if (!date) continue;

    const amountTokens = rest.match(moneyRegex) ?? [];
    if (amountTokens.length === 0) continue;

    // Typical statement row: "... <txn amount> <running balance>"
    // If 2+ amounts, prefer right-most amount before the final balance column.
    const candidateTokens =
      amountTokens.length >= 2 ? amountTokens.slice(0, amountTokens.length - 1) : amountTokens;
    const chosenAmountToken = candidateTokens[candidateTokens.length - 1];
    const parsedAmount = parseMoney(chosenAmountToken);
    if (!parsedAmount) continue;

    const descriptionOnly = normalizeDescription(
      rest.replace(moneyRegex, ' ').replace(/\s+/g, ' ')
    );
    if (!descriptionOnly) continue;

    const maybeBalanceToken = amountTokens.length >= 2 ? amountTokens[amountTokens.length - 1] : null;
    const parsedBalance = maybeBalanceToken ? parseMoney(maybeBalanceToken) : null;

    inlineRows.push({
      date,
      description: descriptionOnly.slice(0, 500),
      amountAbs: Math.abs(parsedAmount.value),
      sign: parsedAmount.explicitSign
        ? parsedAmount.value < 0
          ? 'NEGATIVE'
          : 'POSITIVE'
        : 'UNKNOWN',
      rawLine: line,
      balance: parsedBalance ? Math.abs(parsedBalance.value) : undefined,
    });
  }

  // Infer sign for rows missing explicit +/-.
  // Strategy order: keyword hints -> adjacent-balance delta.
  const positiveHints = [
    'deposit',
    'credit',
    'interest',
    'refund',
    'reversal',
    'payroll',
    'transfer in',
  ];
  const negativeHints = [
    'purchase',
    'debit',
    'withdrawal',
    'payment',
    'bill pay',
    'check',
    'fee',
    'transfer out',
    'ach',
  ];

  for (let i = 0; i < inlineRows.length; i++) {
    const row = inlineRows[i];
    if (row.sign !== 'UNKNOWN') continue;

    const lower = row.description.toLowerCase();
    if (positiveHints.some((k) => lower.includes(k))) {
      row.sign = 'POSITIVE';
      continue;
    }
    if (negativeHints.some((k) => lower.includes(k))) {
      row.sign = 'NEGATIVE';
      continue;
    }

    const prev = inlineRows[i - 1];
    if (prev?.balance !== undefined && row.balance !== undefined) {
      const delta = row.balance - prev.balance;
      const tol = 0.02;
      if (Math.abs(Math.abs(delta) - row.amountAbs) <= tol) {
        row.sign = delta >= 0 ? 'POSITIVE' : 'NEGATIVE';
      }
    }
  }

  return inlineRows;
}

function buildExternalId(
  accountId: string,
  filePath: string,
  row: ParsedStatementRow
): string {
  const digest = createHash('sha1')
    .update(
      [
        accountId,
        path.basename(filePath).toLowerCase(),
        row.date.toISOString().slice(0, 10),
        row.description,
        row.amountAbs.toFixed(4),
        row.rawLine,
      ].join('|')
    )
    .digest('hex');
  return `pdf:${digest}`;
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
          console.log(
            `  ${a.id}  |  ${a.name} (${a.type})  |  ${a.institution ?? 'Unknown institution'}`
          );
        }
      }
      process.exit(1);
    }

    const account = await prisma.financialAccount.findUnique({
      where: { id: args.accountId },
      select: { id: true, name: true, userId: true },
    });
    if (!account) throw new Error(`Account not found: ${args.accountId}`);
    const amazonTargets = await getAmazonCategoryTargets(prisma, account.userId);

    const importFiles = expandInputPaths(args.files);
    if (importFiles.length === 0) {
      throw new Error('No PDF files found from the provided inputs.');
    }

    let totalParsed = 0;
    let totalSkipped = 0;
    let totalSkippedExisting = 0;
    let totalUnknownSign = 0;
    let totalInserted = 0;

    for (const inputFile of importFiles) {
      const filePath = path.resolve(process.cwd(), inputFile);
      const pdfBuffer = readFileSync(filePath);
      const parsed = await pdfParse(pdfBuffer);
      const rows = parsePdfRows(parsed.text, args.yearHint);

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
        metadata: {
          source: 'pdf-import';
          sourceFile: string;
          rawLine: string;
        };
      }> = [];

      let parsedForFile = 0;
      let skippedForFile = 0;
      let skippedExistingForFile = 0;
      let unknownSignForFile = 0;

      // Skip rows that already exist from Plaid/manual import to avoid duplicate transactions.
      const existingBuckets = new Map<
        string,
        Array<{ descriptionNorm: string; used: boolean }>
      >();
      if (rows.length > 0) {
        const sortedDates = rows.map((r) => r.date).sort((a, b) => a.getTime() - b.getTime());
        const minDate = sortedDates[0];
        const maxDate = sortedDates[sortedDates.length - 1];
        const existingInRange = await prisma.transaction.findMany({
          where: {
            accountId: account.id,
            date: { gte: minDate, lte: maxDate },
          },
          select: {
            date: true,
            amount: true,
            description: true,
          },
        });
        for (const tx of existingInRange) {
          const key = [
            tx.date.toISOString().slice(0, 10),
            Math.abs(Number(tx.amount)).toFixed(2),
          ].join('|');
          const bucket = existingBuckets.get(key) ?? [];
          bucket.push({
            descriptionNorm: normalizeForMatch(tx.description),
            used: false,
          });
          existingBuckets.set(key, bucket);
        }
      }

      for (const row of rows) {
        if (!row.description || !row.date || row.amountAbs <= 0) {
          skippedForFile++;
          continue;
        }

        if (row.sign === 'UNKNOWN') {
          // Conservative default for ambiguous statement rows.
          row.sign = 'NEGATIVE';
          unknownSignForFile++;
        }

        const rowDateAmtKey = [
          row.date.toISOString().slice(0, 10),
          row.amountAbs.toFixed(2),
        ].join('|');
        const rowDescNorm = normalizeForMatch(row.description);
        const candidates = existingBuckets.get(rowDateAmtKey) ?? [];

        const duplicateCandidate = candidates.find((c) => {
          if (c.used) return false;
          if (c.descriptionNorm === rowDescNorm) return true;
          if (c.descriptionNorm.includes(rowDescNorm)) return true;
          if (rowDescNorm.includes(c.descriptionNorm)) return true;
          return false;
        });

        if (duplicateCandidate) {
          duplicateCandidate.used = true;
          skippedExistingForFile++;
          continue;
        }

        toCreate.push({
          accountId: account.id,
          amount: row.amountAbs,
          type: row.sign === 'NEGATIVE' ? 'EXPENSE' : 'INCOME',
          status: 'POSTED',
          date: row.date,
          description: row.description.slice(0, 500),
          merchantName: row.description.slice(0, 200),
          ...(row.sign === 'NEGATIVE'
            ? (() => {
                const categoryId = getAmazonRoutingCategoryId(
                  { description: row.description, merchantName: row.description },
                  amazonTargets
                );
                return categoryId ? { categoryId } : {};
              })()
            : {}),
          externalId: buildExternalId(account.id, filePath, row),
          isReviewed: false,
          metadata: {
            source: 'pdf-import',
            sourceFile: path.basename(filePath),
            rawLine: row.rawLine,
          },
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
      totalSkippedExisting += skippedExistingForFile;
      totalUnknownSign += unknownSignForFile;
      totalInserted += insertedForFile;

      console.log(
        [
          '',
          `File: ${path.relative(process.cwd(), filePath) || filePath}`,
          `  pages: ${parsed.numpages}`,
          `  parsed: ${parsedForFile}`,
          `  skipped: ${skippedForFile}`,
          `  skipped-existing: ${skippedExistingForFile}`,
          `  unknown-sign defaults (set to EXPENSE): ${unknownSignForFile}`,
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
        `Total skipped-existing: ${totalSkippedExisting}`,
        `Total unknown-sign defaults: ${totalUnknownSign}`,
        `Total ${args.dryRun ? 'would insert' : 'inserted'}: ${totalInserted}`,
        args.dryRun
          ? 'Dry run only. Re-run without --dry-run to persist.'
          : 'PDF import complete.',
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

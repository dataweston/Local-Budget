import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { PrismaClient, AccountType, TransactionStatus, TransactionType } from '@prisma/client';

type ParsedArgs = {
  inputs: string[];
  anchorAccountId?: string;
  venmoAccountId?: string;
  maxDayGap: number;
  apply: boolean;
  reportPath: string;
};

type VenmoStatementEntry = {
  statementId: string;
  statementDateTime: Date;
  statementDate: Date;
  type: string;
  status: string;
  note: string;
  from: string;
  to: string;
  amountTotalSigned: number;
  amountFeeSigned: number;
  fundingSource: string;
  destination: string;
  sourceFile: string;
};

type CanonicalImportRow = {
  externalId: string;
  accountId: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  date: Date;
  description: string;
  merchantName: string;
  classification: 'INCOME' | 'PERSONAL' | 'TRANSFER';
  categoryId: string | null;
  metadata: Record<string, unknown>;
};

type BankCandidate = {
  id: string;
  accountId: string;
  amount: number;
  type: TransactionType;
  date: Date;
  description: string;
  merchantName: string | null;
  classification: string | null;
  categoryId: string | null;
  metadata: unknown;
};

type MatchedPair = {
  canonicalTxId: string;
  canonicalExternalId: string;
  statementId: string;
  canonicalType: TransactionType;
  canonicalDate: Date;
  canonicalAmount: number;
  bankTx: BankCandidate;
  dayDiff: number;
  amountDiff: number;
  score: number;
  reason: string;
};

const DEFAULT_INPUT = path.join('imports', 'sofi', 'Your Orders_files', 'VenmoStatement_*.csv');
const DEFAULT_REPORT = path.join('imports', 'sofi', 'venmo-sync-report.csv');

function usage() {
  console.log(
    [
      'Usage:',
      '  npx tsx scripts/sync-venmo-statements.ts [--apply] [--anchor-account-id <id>] [--venmo-account-id <id>] [--max-day-gap 3] [--report <path>] [glob|file|folder]',
      '',
      'Notes:',
      '  - Imports Venmo statement rows as canonical transactions into a Venmo Wallet account.',
      '  - Reconciles matching bank-side Venmo duplicates and converts those bank rows to TRANSFER.',
      '  - Dry-run by default. Add --apply to persist.',
    ].join('\n')
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    inputs: [DEFAULT_INPUT],
    maxDayGap: 3,
    apply: false,
    reportPath: DEFAULT_REPORT,
  };

  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--apply') {
      out.apply = true;
      continue;
    }
    if (arg === '--anchor-account-id') {
      out.anchorAccountId = argv[i + 1] ?? undefined;
      i++;
      continue;
    }
    if (arg.startsWith('--anchor-account-id=')) {
      out.anchorAccountId = arg.slice('--anchor-account-id='.length);
      continue;
    }
    if (arg === '--venmo-account-id') {
      out.venmoAccountId = argv[i + 1] ?? undefined;
      i++;
      continue;
    }
    if (arg.startsWith('--venmo-account-id=')) {
      out.venmoAccountId = arg.slice('--venmo-account-id='.length);
      continue;
    }
    if (arg === '--max-day-gap') {
      const v = Number.parseInt(argv[i + 1] ?? '', 10);
      if (!Number.isNaN(v) && v >= 0) out.maxDayGap = v;
      i++;
      continue;
    }
    if (arg.startsWith('--max-day-gap=')) {
      const v = Number.parseInt(arg.slice('--max-day-gap='.length), 10);
      if (!Number.isNaN(v) && v >= 0) out.maxDayGap = v;
      continue;
    }
    if (arg === '--report') {
      out.reportPath = argv[i + 1] ?? out.reportPath;
      i++;
      continue;
    }
    if (arg.startsWith('--report=')) {
      out.reportPath = arg.slice('--report='.length);
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length > 0) out.inputs = positionals;
  return out;
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
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
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

function parseSignedMoney(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const noSpaces = trimmed.replace(/\s+/g, '');
  const sign = noSpaces.includes('-') ? -1 : 1;
  const numeric = noSpaces.replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  const value = Number.parseFloat(numeric);
  if (Number.isNaN(value)) return null;
  return sign * value;
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(toUtcDay(a).getTime() - toUtcDay(b).getTime()) / 86_400_000);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

function tokenMatches(entry: VenmoStatementEntry, candidate: BankCandidate): number {
  const stop = new Set(['venmo', 'catherine', 'olsen', 'and', 'the', 'for', 'with']);
  const baseTokens = tokenize(`${entry.from} ${entry.to} ${entry.note}`).filter((t) => !stop.has(t));
  const text = `${candidate.description} ${candidate.merchantName ?? ''}`.toLowerCase();
  let count = 0;
  for (const token of Array.from(new Set(baseTokens))) {
    if (text.includes(token)) count++;
  }
  return count;
}

function parseVenmoStatementFile(filePath: string): VenmoStatementEntry[] {
  const content = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const matrix = parseCsv(content);
  if (matrix.length === 0) return [];

  let headerIndex = -1;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i].map(normalizeHeader);
    if (row.includes('id') && row.includes('datetime') && row.includes('amounttotal')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) return [];

  const headers = matrix[headerIndex];
  const headerMap = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    headerMap.set(normalizeHeader(headers[i]), i);
  }

  function getCell(row: string[], header: string): string {
    const idx = headerMap.get(normalizeHeader(header));
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
  }

  const out: VenmoStatementEntry[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i];
    const statementId = getCell(row, 'ID');
    const dt = getCell(row, 'Datetime');
    const amountRaw = getCell(row, 'Amount (total)');
    if (!statementId || !dt || !amountRaw) continue;

    const statementDateTime = new Date(dt);
    if (Number.isNaN(statementDateTime.getTime())) continue;

    const amountTotalSigned = parseSignedMoney(amountRaw);
    const amountFeeSigned = parseSignedMoney(getCell(row, 'Amount (fee)')) ?? 0;
    if (amountTotalSigned === null) continue;

    out.push({
      statementId,
      statementDateTime,
      statementDate: toUtcDay(statementDateTime),
      type: getCell(row, 'Type'),
      status: getCell(row, 'Status'),
      note: getCell(row, 'Note'),
      from: getCell(row, 'From'),
      to: getCell(row, 'To'),
      amountTotalSigned,
      amountFeeSigned,
      fundingSource: getCell(row, 'Funding Source'),
      destination: getCell(row, 'Destination'),
      sourceFile: path.basename(filePath),
    });
  }

  return out;
}

function venmoEntryToType(entry: VenmoStatementEntry): TransactionType {
  if (entry.type.toLowerCase().includes('transfer')) return 'TRANSFER';
  return entry.amountTotalSigned >= 0 ? 'INCOME' : 'EXPENSE';
}

function escapeCsv(v: string | number | null | undefined): string {
  const text = v == null ? '' : String(v);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const csvFiles = expandInputPaths(args.inputs)
      .filter((f) => path.basename(f).toLowerCase().startsWith('venmostatement_'))
      .sort((a, b) => a.localeCompare(b));
    if (csvFiles.length === 0) throw new Error('No Venmo statement CSV files found.');

    const entries = csvFiles.flatMap((f) => parseVenmoStatementFile(f));
    const completed = entries.filter((e) => e.status.toLowerCase() === 'complete');
    if (completed.length === 0) throw new Error('No complete Venmo statement rows found.');

    let userId: string | null = null;
    if (args.venmoAccountId) {
      const acct = await prisma.financialAccount.findUnique({
        where: { id: args.venmoAccountId },
        select: { userId: true },
      });
      userId = acct?.userId ?? null;
    }
    if (!userId && args.anchorAccountId) {
      const acct = await prisma.financialAccount.findUnique({
        where: { id: args.anchorAccountId },
        select: { userId: true },
      });
      userId = acct?.userId ?? null;
    }
    if (!userId) {
      const users = await prisma.user.findMany({ select: { id: true }, take: 2 });
      if (users.length !== 1) {
        throw new Error('Unable to infer user. Pass --anchor-account-id or --venmo-account-id.');
      }
      userId = users[0].id;
    }

    let venmoAccount = args.venmoAccountId
      ? await prisma.financialAccount.findFirst({ where: { id: args.venmoAccountId, userId } })
      : await prisma.financialAccount.findFirst({
          where: {
            userId,
            OR: [
              { name: { contains: 'venmo', mode: 'insensitive' } },
              { institution: { contains: 'venmo', mode: 'insensitive' } },
            ],
          },
        });

    if (!venmoAccount && args.apply) {
      venmoAccount = await prisma.financialAccount.create({
        data: {
          userId,
          name: 'Venmo Wallet',
          institution: 'Venmo',
          type: AccountType.OTHER,
          currency: 'USD',
          isActive: true,
          currentBalance: 0,
          providerData: { venmoWallet: true },
        },
      });
    }
    if (!venmoAccount) {
      throw new Error('No Venmo Wallet account found. Re-run with --apply to create one.');
    }

    const transferCategory = await prisma.category.findFirst({
      where: { userId, defaultClassification: 'TRANSFER' },
      select: { id: true },
    });
    const preferredBankAccounts = await prisma.financialAccount.findMany({
      where: {
        userId,
        id: { not: venmoAccount.id },
        OR: [
          { name: { equals: 'SoFi Checking', mode: 'insensitive' } },
          { name: { equals: 'TOTAL CHECKING', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true },
    });
    const fallbackBankAccounts = await prisma.financialAccount.findMany({
      where: {
        userId,
        id: { not: venmoAccount.id },
        type: { in: [AccountType.CHECKING, AccountType.SAVINGS] },
      },
      select: { id: true, name: true },
    });
    const bankScopeAccounts =
      preferredBankAccounts.length > 0 ? preferredBankAccounts : fallbackBankAccounts;
    const bankScopeAccountIds = bankScopeAccounts.map((a) => a.id);

    const canonicalRows: CanonicalImportRow[] = [];
    for (const entry of completed) {
      const txType = venmoEntryToType(entry);
      const status: TransactionStatus = entry.status.toLowerCase() === 'complete' ? 'POSTED' : 'PENDING';
      const description = txType === 'TRANSFER'
        ? `Venmo ${entry.type}${entry.destination ? ` ${entry.destination}` : ''}`
        : `Venmo ${entry.type}: ${entry.from || 'Unknown'} -> ${entry.to || 'Unknown'}${entry.note ? ` | ${entry.note}` : ''}`;

      const metadata = {
        venmoStatementEntry: {
          source: 'venmo-statement-csv',
          statementId: entry.statementId,
          statementDateTime: entry.statementDateTime.toISOString(),
          type: entry.type,
          status: entry.status,
          note: entry.note,
          from: entry.from,
          to: entry.to,
          amountTotalSigned: Number(entry.amountTotalSigned.toFixed(2)),
          amountFeeSigned: Number(entry.amountFeeSigned.toFixed(2)),
          fundingSource: entry.fundingSource,
          destination: entry.destination,
          sourceFile: entry.sourceFile,
        },
      };

      canonicalRows.push({
        externalId: `venmo-statement-main:${entry.statementId}`,
        accountId: venmoAccount.id,
        amount: Math.abs(entry.amountTotalSigned),
        type: txType,
        status,
        date: entry.statementDateTime,
        description,
        merchantName: 'Venmo',
        classification: txType === 'TRANSFER' ? 'TRANSFER' : txType === 'INCOME' ? 'INCOME' : 'PERSONAL',
        categoryId: txType === 'TRANSFER' ? transferCategory?.id ?? null : null,
        metadata,
      });

      if (Math.abs(entry.amountFeeSigned) > 0.0001) {
        const feeType: TransactionType = entry.amountFeeSigned < 0 ? 'EXPENSE' : 'INCOME';
        canonicalRows.push({
          externalId: `venmo-statement-fee:${entry.statementId}`,
          accountId: venmoAccount.id,
          amount: Math.abs(entry.amountFeeSigned),
          type: feeType,
          status,
          date: entry.statementDateTime,
          description: `Venmo ${entry.type} fee`,
          merchantName: 'Venmo',
          classification: feeType === 'INCOME' ? 'INCOME' : 'PERSONAL',
          categoryId: null,
          metadata: {
            venmoStatementEntry: {
              source: 'venmo-statement-csv',
              statementId: entry.statementId,
              statementDateTime: entry.statementDateTime.toISOString(),
              type: entry.type,
              status: entry.status,
              note: entry.note,
              from: entry.from,
              to: entry.to,
              amountTotalSigned: Number(entry.amountTotalSigned.toFixed(2)),
              amountFeeSigned: Number(entry.amountFeeSigned.toFixed(2)),
              fundingSource: entry.fundingSource,
              destination: entry.destination,
              sourceFile: entry.sourceFile,
              isFeeTransaction: true,
            },
          },
        });
      }
    }

    const existing = await prisma.transaction.findMany({
      where: {
        accountId: venmoAccount.id,
        externalId: { in: canonicalRows.map((r) => r.externalId) },
      },
      select: { id: true, externalId: true },
    });
    const existingByExternalId = new Map(existing.map((x) => [x.externalId ?? '', x.id]));

    let created = 0;
    let updated = 0;
    if (args.apply) {
      for (const row of canonicalRows) {
        const existingId = existingByExternalId.get(row.externalId);
        if (!existingId) {
          await prisma.transaction.create({ data: row as any });
          created++;
        } else {
          await prisma.transaction.update({
            where: { id: existingId },
            data: {
              amount: row.amount,
              type: row.type,
              status: row.status,
              date: row.date,
              description: row.description,
              merchantName: row.merchantName,
              classification: row.classification,
              categoryId: row.categoryId,
              metadata: row.metadata as any,
            },
          });
          updated++;
        }
      }
    } else {
      created = canonicalRows.filter((r) => !existingByExternalId.has(r.externalId)).length;
      updated = canonicalRows.length - created;
    }

    const mainRows = canonicalRows.filter((r) => r.externalId.startsWith('venmo-statement-main:'));
    const statementByExternalId = new Map(mainRows.map((r) => [r.externalId, r]));

    const minDate = new Date(Math.min(...mainRows.map((r) => toUtcDay(r.date).getTime())) - args.maxDayGap * 86_400_000);
    const maxDate = new Date(Math.max(...mainRows.map((r) => toUtcDay(r.date).getTime())) + args.maxDayGap * 86_400_000);

    const bankRowsRaw = await prisma.transaction.findMany({
      where: {
        account: { userId },
        accountId: { in: bankScopeAccountIds },
        date: { gte: minDate, lte: maxDate },
      },
      select: {
        id: true,
        accountId: true,
        amount: true,
        type: true,
        date: true,
        description: true,
        merchantName: true,
        classification: true,
        categoryId: true,
        metadata: true,
      },
      orderBy: { date: 'asc' },
    });

    const bankRows: BankCandidate[] = bankRowsRaw.map((r) => ({
      ...r,
      amount: Math.abs(Number(r.amount)),
      classification: r.classification as string | null,
    }));

    const usedBankTxIds = new Set<string>();
    const matchedPairs: MatchedPair[] = [];

    const persistedMain = args.apply
      ? await prisma.transaction.findMany({
          where: {
            accountId: venmoAccount.id,
            externalId: { in: mainRows.map((r) => r.externalId) },
          },
          select: { id: true, externalId: true, type: true, amount: true, date: true },
        })
      : mainRows.map((r) => ({
          id: `dry-${r.externalId}`,
          externalId: r.externalId,
          type: r.type,
          amount: r.amount,
          date: r.date,
        }));

    for (const canonical of persistedMain) {
      const source = statementByExternalId.get(canonical.externalId ?? '');
      if (!source) continue;
      const entryType = source.metadata.venmoStatementEntry as Record<string, unknown>;
      const venmoType = String(entryType.type ?? '');
      const amountTotalSigned = Number(entryType.amountTotalSigned ?? 0);

      if (canonical.type === 'INCOME' && !venmoType.toLowerCase().includes('transfer')) {
        continue;
      }

      const expectedTypes: TransactionType[] = [];
      let reason = '';
      if (canonical.type === 'EXPENSE') {
        expectedTypes.push('EXPENSE', 'TRANSFER');
        reason = 'expense-duplicate';
      } else if (canonical.type === 'TRANSFER') {
        if (amountTotalSigned < 0) {
          expectedTypes.push('INCOME', 'TRANSFER');
          reason = 'venmo-to-bank-transfer';
        } else {
          expectedTypes.push('EXPENSE', 'TRANSFER');
          reason = 'bank-to-venmo-transfer';
        }
      }

      const candidates = bankRows
        .filter((b) => !usedBankTxIds.has(b.id))
        .filter((b) => expectedTypes.includes(b.type))
        .map((b) => {
          const dayDiff = daysBetween(b.date, canonical.date);
          const amountDiff = Math.abs(b.amount - Math.abs(Number(canonical.amount)));
          const text = `${b.description} ${b.merchantName ?? ''}`.toLowerCase();
          const hasVenmoText = text.includes('venmo');
          const hasTransferText = /transfer|ach|xfer|p2p|external|deposit|withdrawal|instant/.test(text);
          const nameMatch = tokenMatches(
            {
              statementId: String(entryType.statementId ?? ''),
              statementDateTime: canonical.date,
              statementDate: toUtcDay(canonical.date),
              type: venmoType,
              status: String(entryType.status ?? ''),
              note: String(entryType.note ?? ''),
              from: String(entryType.from ?? ''),
              to: String(entryType.to ?? ''),
              amountTotalSigned,
              amountFeeSigned: Number(entryType.amountFeeSigned ?? 0),
              fundingSource: String(entryType.fundingSource ?? ''),
              destination: String(entryType.destination ?? ''),
              sourceFile: String(entryType.sourceFile ?? ''),
            },
            b
          );
          const score =
            nameMatch * 80 +
            (hasVenmoText ? 35 : 0) +
            (hasTransferText ? 15 : 0) -
            dayDiff * 12 -
            amountDiff * 1000;
          return { b, dayDiff, amountDiff, hasVenmoText, hasTransferText, nameMatch, score };
        })
        .filter((x) => x.dayDiff <= args.maxDayGap && x.amountDiff <= 0.02)
        .filter((x) => {
          if (canonical.type === 'EXPENSE') return x.hasVenmoText || x.nameMatch > 0;
          return x.hasVenmoText || x.hasTransferText;
        })
        .sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff || a.amountDiff - b.amountDiff);

      if (candidates.length === 0) continue;
      const best = candidates[0];
      const second = candidates[1];
      const scoreGap = second ? best.score - second.score : 999;
      if (best.dayDiff > 2 && scoreGap < 10) continue;

      usedBankTxIds.add(best.b.id);
      matchedPairs.push({
        canonicalTxId: canonical.id,
        canonicalExternalId: canonical.externalId ?? '',
        statementId: String(entryType.statementId ?? ''),
        canonicalType: canonical.type,
        canonicalDate: canonical.date,
        canonicalAmount: Math.abs(Number(canonical.amount)),
        bankTx: best.b,
        dayDiff: best.dayDiff,
        amountDiff: Number(best.amountDiff.toFixed(2)),
        score: Number(best.score.toFixed(2)),
        reason,
      });
    }

    let convertedBankToTransfer = 0;
    let normalizedBankVenmoToTransfer = 0;
    if (args.apply && matchedPairs.length > 0) {
      for (const m of matchedPairs) {
        const prevMeta =
          m.bankTx.metadata && typeof m.bankTx.metadata === 'object' && !Array.isArray(m.bankTx.metadata)
            ? (m.bankTx.metadata as Record<string, unknown>)
            : {};
        const nextMeta = {
          ...prevMeta,
          venmoReconciliation: {
            source: 'venmo-statement-sync',
            statementId: m.statementId,
            canonicalTransactionId: m.canonicalTxId,
            canonicalExternalId: m.canonicalExternalId,
            reason: m.reason,
            dayDiff: m.dayDiff,
            amountDiff: m.amountDiff,
            reconciledAt: new Date().toISOString(),
            previousType: m.bankTx.type,
            previousClassification: m.bankTx.classification,
          },
        };

        await prisma.transaction.update({
          where: { id: m.bankTx.id },
          data: {
            type: 'TRANSFER',
            classification: 'TRANSFER',
            categoryId: transferCategory?.id ?? m.bankTx.categoryId,
            metadata: nextMeta,
            isReviewed: true,
          },
        });

        const canonical = await prisma.transaction.findUnique({
          where: { id: m.canonicalTxId },
          select: { metadata: true },
        });
        const canonicalPrevMeta =
          canonical?.metadata && typeof canonical.metadata === 'object' && !Array.isArray(canonical.metadata)
            ? (canonical.metadata as Record<string, unknown>)
            : {};
        await prisma.transaction.update({
          where: { id: m.canonicalTxId },
          data: {
            metadata: {
              ...canonicalPrevMeta,
              venmoReconciliation: {
                source: 'venmo-statement-sync',
                matchedBankTransactionId: m.bankTx.id,
                matchedBankAccountId: m.bankTx.accountId,
                reason: m.reason,
                dayDiff: m.dayDiff,
                amountDiff: m.amountDiff,
                reconciledAt: new Date().toISOString(),
              },
            },
          },
        });

        await prisma.transactionLink.upsert({
          where: {
            fromId_toId_linkType: {
              fromId: m.canonicalTxId,
              toId: m.bankTx.id,
              linkType: 'TRANSFER',
            },
          },
          update: {
            amount: m.canonicalAmount,
            notes: 'Auto-linked by venmo statement sync',
          },
          create: {
            fromId: m.canonicalTxId,
            toId: m.bankTx.id,
            linkType: 'TRANSFER',
            amount: m.canonicalAmount,
            notes: 'Auto-linked by venmo statement sync',
          },
        });

        convertedBankToTransfer++;
      }
    }
    if (args.apply) {
      const bankVenmoRows = await prisma.transaction.findMany({
        where: {
          account: { userId },
          accountId: { in: bankScopeAccountIds },
          OR: [
            { description: { contains: 'venmo', mode: 'insensitive' } },
            { merchantName: { contains: 'venmo', mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          type: true,
          classification: true,
          categoryId: true,
          metadata: true,
        },
      });
      for (const row of bankVenmoRows) {
        if (row.type === 'TRANSFER' && row.classification === 'TRANSFER') continue;
        const prevMeta =
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : {};
        await prisma.transaction.update({
          where: { id: row.id },
          data: {
            type: 'TRANSFER',
            classification: 'TRANSFER',
            categoryId: transferCategory?.id ?? row.categoryId,
            metadata: {
              ...prevMeta,
              venmoReconciliation: {
                source: 'venmo-statement-sync',
                reason: 'bank-venmo-normalized-to-transfer',
                normalizedAt: new Date().toISOString(),
              },
            },
            isReviewed: true,
          },
        });
        normalizedBankVenmoToTransfer++;
      }
    }

    const reportPath = path.resolve(process.cwd(), args.reportPath);
    const reportLines = [
      [
        'statement_id',
        'canonical_external_id',
        'canonical_type',
        'canonical_amount',
        'canonical_date',
        'matched_bank_tx_id',
        'matched_bank_type_before',
        'matched_bank_description',
        'matched_bank_amount',
        'day_diff',
        'amount_diff',
        'score',
        'reason',
      ].join(','),
    ];
    for (const m of matchedPairs) {
      reportLines.push(
        [
          escapeCsv(m.statementId),
          escapeCsv(m.canonicalExternalId),
          escapeCsv(m.canonicalType),
          escapeCsv(m.canonicalAmount.toFixed(2)),
          escapeCsv(m.canonicalDate.toISOString()),
          escapeCsv(m.bankTx.id),
          escapeCsv(m.bankTx.type),
          escapeCsv(m.bankTx.description),
          escapeCsv(m.bankTx.amount.toFixed(2)),
          escapeCsv(m.dayDiff),
          escapeCsv(m.amountDiff),
          escapeCsv(m.score),
          escapeCsv(m.reason),
        ].join(',')
      );
    }
    writeFileSync(reportPath, reportLines.join('\n') + '\n', 'utf8');

    const unmatchedStatementIds = new Set(
      mainRows
        .map((r) => r.externalId.replace('venmo-statement-main:', ''))
        .filter((id) => !matchedPairs.some((m) => m.statementId === id))
    );

    console.log(
      [
        '',
        `User: ${userId}`,
        `Venmo account: ${venmoAccount.name} (${venmoAccount.id})`,
        `Bank scope accounts: ${bankScopeAccounts.map((a) => `${a.name} (${a.id})`).join(', ')}`,
        `CSV files: ${csvFiles.length}`,
        `Rows parsed (all): ${entries.length}`,
        `Rows parsed (complete): ${completed.length}`,
        `Canonical rows prepared (main + fee): ${canonicalRows.length}`,
        `Will create: ${created}`,
        `Will update: ${updated}`,
        `Matched bank duplicates/transfers: ${matchedPairs.length}`,
        `Unmatched canonical statement rows: ${unmatchedStatementIds.size}`,
        args.apply
          ? `Applied: ${created} created, ${updated} updated, ${convertedBankToTransfer} matched bank tx converted to TRANSFER, ${normalizedBankVenmoToTransfer} bank venmo tx normalized to TRANSFER`
          : 'Dry run only. Re-run with --apply to persist.',
        `Report: ${path.relative(process.cwd(), reportPath) || reportPath}`,
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

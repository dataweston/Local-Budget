import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

type ParsedArgs = {
  inputs: string[];
  maxDayGap: number;
  reportPath: string;
  apply: boolean;
};

type CsvRow = Record<string, string>;

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

type CandidateTx = {
  id: string;
  date: Date;
  amount: number;
  description: string;
  merchantName: string | null;
  classification: string | null;
  metadata: unknown;
};

type EntryMatch = {
  entry: VenmoStatementEntry;
  tx: CandidateTx | null;
  confidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  candidateCount: number;
  dayDiff: number | null;
  amountDiff: number | null;
  tokenMatches: number;
};

const DEFAULT_INPUT = path.join('imports', 'sofi', 'Your Orders_files', 'VenmoStatement_*.csv');

function usage() {
  console.log(
    [
      'Usage:',
      '  npx tsx scripts/crossref-venmo-statements.ts [glob|file|folder] [--apply] [--max-day-gap 7] [--report <path>]',
      '',
      'Examples:',
      '  npx tsx scripts/crossref-venmo-statements.ts',
      '  npx tsx scripts/crossref-venmo-statements.ts "imports/sofi/Your Orders_files/VenmoStatement_*.csv" --apply',
      '',
      'Notes:',
      '  - Matches statement rows to existing Venmo expense transactions in DB.',
      '  - On --apply, writes metadata.venmoStatementMatch and defaults to PERSONAL unless already OPERATING.',
    ].join('\n')
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    inputs: [DEFAULT_INPUT],
    maxDayGap: 7,
    reportPath: path.join('imports', 'sofi', 'venmo-crossref-2025.csv'),
    apply: false,
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

  if (positionals.length > 0) {
    out.inputs = positionals;
  }

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
      field = '';
      rows.push(row);
      row = [];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseVenmoStatementFile(filePath: string): VenmoStatementEntry[] {
  const content = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const matrix = parseCsv(content);
  if (matrix.length === 0) return [];

  let headerIndex = -1;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    const normalized = row.map(normalizeHeader);
    const hasId = normalized.includes('id');
    const hasDatetime = normalized.includes('datetime');
    const hasAmountTotal = normalized.includes('amounttotal');
    if (hasId && hasDatetime && hasAmountTotal) {
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

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function tokenMatches(entry: VenmoStatementEntry, tx: CandidateTx): number {
  const text = `${tx.description} ${tx.merchantName ?? ''}`.toLowerCase();
  const base = `${entry.from} ${entry.to}`.toLowerCase();
  const stop = new Set([
    'catherine',
    'olsen',
    'venmo',
    'localeffort',
    'and',
    'the',
    'for',
    'with',
  ]);
  const tokens = base
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
  let matches = 0;
  for (const t of new Set(tokens)) {
    if (text.includes(t)) matches++;
  }
  return matches;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.map((v) => Number(v.toFixed(2)))));
}

function candidateAmounts(entry: VenmoStatementEntry): number[] {
  const absTotal = Math.abs(entry.amountTotalSigned);
  const absFee = Math.abs(entry.amountFeeSigned);
  const vals = [absTotal];
  if (absFee > 0 && absTotal - absFee > 0) {
    vals.push(absTotal - absFee);
  }
  if (absFee > 0) {
    vals.push(absTotal + absFee);
  }
  return uniqueNumbers(vals);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const csvFiles = expandInputPaths(args.inputs)
      .filter((f) => path.basename(f).toLowerCase().startsWith('venmostatement_'))
      .sort((a, b) => a.localeCompare(b));
    if (csvFiles.length === 0) {
      throw new Error('No Venmo statement CSV files found from inputs.');
    }

    const entries = csvFiles.flatMap((f) => parseVenmoStatementFile(f));
    const completedEntries = entries.filter((e) => e.status.toLowerCase() === 'complete');
    const expenseLikeEntries = completedEntries.filter((e) => e.amountTotalSigned < 0);
    if (expenseLikeEntries.length === 0) {
      throw new Error('No completed negative Venmo rows found in provided files.');
    }

    const minDate = new Date(
      Math.min(...expenseLikeEntries.map((e) => e.statementDate.getTime())) - 7 * 86_400_000
    );
    const maxDate = new Date(
      Math.max(...expenseLikeEntries.map((e) => e.statementDate.getTime())) + 7 * 86_400_000
    );

    const txRows = await prisma.transaction.findMany({
      where: {
        type: 'EXPENSE',
        date: { gte: minDate, lte: maxDate },
        OR: [
          { description: { contains: 'venmo', mode: 'insensitive' } },
          { merchantName: { contains: 'venmo', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        merchantName: true,
        classification: true,
        metadata: true,
      },
      orderBy: [{ date: 'asc' }],
    });

    const txs: CandidateTx[] = txRows.map((t) => ({
      id: t.id,
      date: t.date,
      amount: Math.abs(Number(t.amount)),
      description: t.description,
      merchantName: t.merchantName,
      classification: t.classification,
      metadata: t.metadata,
    }));

    const txByCents = new Map<number, CandidateTx[]>();
    for (const tx of txs) {
      const cents = Math.round(tx.amount * 100);
      const bucket = txByCents.get(cents) ?? [];
      bucket.push(tx);
      txByCents.set(cents, bucket);
    }
    txByCents.forEach((bucket) => bucket.sort((a, b) => a.date.getTime() - b.date.getTime()));

    const usedTxIds = new Set<string>();
    const matches: EntryMatch[] = [];

    const sortedEntries = [...expenseLikeEntries].sort(
      (a, b) => a.statementDateTime.getTime() - b.statementDateTime.getTime()
    );
    for (const entry of sortedEntries) {
      const amtCandidates = candidateAmounts(entry);
      const centsCandidates = uniqueNumbers(amtCandidates).map((x) => Math.round(x * 100));
      const candidateTxs = centsCandidates.flatMap((c) => [
        ...(txByCents.get(c - 1) ?? []),
        ...(txByCents.get(c) ?? []),
        ...(txByCents.get(c + 1) ?? []),
      ]);

      const uniqCandidateMap = new Map<string, CandidateTx>();
      for (const tx of candidateTxs) {
        if (!uniqCandidateMap.has(tx.id)) uniqCandidateMap.set(tx.id, tx);
      }

      const ranked = Array.from(uniqCandidateMap.values())
        .filter((tx) => !usedTxIds.has(tx.id))
        .map((tx) => {
          const dayDiff = daysBetween(tx.date, entry.statementDate);
          const minAmtDiff = Math.min(...amtCandidates.map((a) => Math.abs(a - tx.amount)));
          const nameMatchCount = tokenMatches(entry, tx);
          const score = nameMatchCount * 100 - dayDiff * 10 - minAmtDiff * 1000;
          return { tx, dayDiff, minAmtDiff, nameMatchCount, score };
        })
        .filter((x) => x.dayDiff <= args.maxDayGap && x.minAmtDiff <= 0.02)
        .sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff || a.minAmtDiff - b.minAmtDiff);

      if (ranked.length === 0) {
        matches.push({
          entry,
          tx: null,
          confidence: 'NONE',
          candidateCount: 0,
          dayDiff: null,
          amountDiff: null,
          tokenMatches: 0,
        });
        continue;
      }

      const best = ranked[0];
      usedTxIds.add(best.tx.id);
      let confidence: EntryMatch['confidence'] = 'LOW';
      if (
        best.dayDiff <= 1 &&
        best.minAmtDiff <= 0.01 &&
        (best.nameMatchCount > 0 || ranked.length === 1)
      ) {
        confidence = 'HIGH';
      } else if (best.dayDiff <= 3 && best.minAmtDiff <= 0.01) {
        confidence = 'MEDIUM';
      }

      matches.push({
        entry,
        tx: best.tx,
        confidence,
        candidateCount: ranked.length,
        dayDiff: best.dayDiff,
        amountDiff: Number(best.minAmtDiff.toFixed(2)),
        tokenMatches: best.nameMatchCount,
      });
    }

    const reportPath = path.resolve(process.cwd(), args.reportPath);
    const matchedCount = matches.filter((m) => !!m.tx).length;
    const unmatchedCount = matches.length - matchedCount;
    const highCount = matches.filter((m) => m.confidence === 'HIGH').length;

    const lines: string[] = [
      [
        'statement_id',
        'statement_datetime',
        'type',
        'from',
        'to',
        'note',
        'amount_total',
        'amount_fee',
        'matched_tx_id',
        'matched_tx_date',
        'matched_tx_amount',
        'matched_tx_description',
        'candidate_count',
        'day_diff',
        'amount_diff',
        'token_matches',
        'confidence',
        'source_file',
      ].join(','),
    ];
    for (const m of matches) {
      lines.push(
        [
          csvEscape(m.entry.statementId),
          csvEscape(m.entry.statementDateTime.toISOString()),
          csvEscape(m.entry.type),
          csvEscape(m.entry.from),
          csvEscape(m.entry.to),
          csvEscape(m.entry.note),
          csvEscape(m.entry.amountTotalSigned.toFixed(2)),
          csvEscape(m.entry.amountFeeSigned.toFixed(2)),
          csvEscape(m.tx?.id ?? ''),
          csvEscape(m.tx ? m.tx.date.toISOString().slice(0, 10) : ''),
          csvEscape(m.tx ? m.tx.amount.toFixed(2) : ''),
          csvEscape(m.tx?.description ?? ''),
          csvEscape(m.candidateCount),
          csvEscape(m.dayDiff ?? ''),
          csvEscape(m.amountDiff ?? ''),
          csvEscape(m.tokenMatches),
          csvEscape(m.confidence),
          csvEscape(m.entry.sourceFile),
        ].join(',')
      );
    }
    writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');

    const unmatchedReport = reportPath.replace(/\.csv$/i, '-unmatched.csv');
    const unmatchedLines: string[] = [
      ['statement_id', 'statement_datetime', 'type', 'from', 'to', 'note', 'amount_total', 'amount_fee', 'source_file'].join(','),
    ];
    for (const m of matches.filter((m) => !m.tx)) {
      unmatchedLines.push(
        [
          csvEscape(m.entry.statementId),
          csvEscape(m.entry.statementDateTime.toISOString()),
          csvEscape(m.entry.type),
          csvEscape(m.entry.from),
          csvEscape(m.entry.to),
          csvEscape(m.entry.note),
          csvEscape(m.entry.amountTotalSigned.toFixed(2)),
          csvEscape(m.entry.amountFeeSigned.toFixed(2)),
          csvEscape(m.entry.sourceFile),
        ].join(',')
      );
    }
    writeFileSync(unmatchedReport, unmatchedLines.join('\n') + '\n', 'utf8');

    let appliedUpdates = 0;
    let defaultedPersonal = 0;
    if (args.apply) {
      for (const m of matches) {
        if (!m.tx) continue;
        const prevMeta = isRecord(m.tx.metadata) ? m.tx.metadata : {};
        const nextMeta = {
          ...prevMeta,
          venmoStatementMatch: {
            source: 'venmo-statement-csv',
            statementId: m.entry.statementId,
            statementDateTime: m.entry.statementDateTime.toISOString(),
            type: m.entry.type,
            status: m.entry.status,
            note: m.entry.note,
            from: m.entry.from,
            to: m.entry.to,
            amountTotalSigned: Number(m.entry.amountTotalSigned.toFixed(2)),
            amountFeeSigned: Number(m.entry.amountFeeSigned.toFixed(2)),
            fundingSource: m.entry.fundingSource,
            destination: m.entry.destination,
            sourceFile: m.entry.sourceFile,
            dayDiff: m.dayDiff,
            amountDiff: m.amountDiff,
            candidateCount: m.candidateCount,
            confidence: m.confidence,
            matchedAt: new Date().toISOString(),
          },
        };

        const nextClassification = m.tx.classification === 'OPERATING' ? 'OPERATING' : 'PERSONAL';
        if (nextClassification === 'PERSONAL' && m.tx.classification !== 'PERSONAL') {
          defaultedPersonal++;
        }

        await prisma.transaction.update({
          where: { id: m.tx.id },
          data: {
            metadata: nextMeta,
            classification: nextClassification as any,
          },
        });
        appliedUpdates++;
      }
    }

    console.log(
      [
        '',
        `CSV files: ${csvFiles.length}`,
        `Rows parsed (all): ${entries.length}`,
        `Rows parsed (complete): ${completedEntries.length}`,
        `Rows parsed (expense-like): ${expenseLikeEntries.length}`,
        `Candidate DB Venmo expenses: ${txs.length}`,
        `Matched: ${matchedCount}`,
        `Unmatched: ${unmatchedCount}`,
        `High confidence: ${highCount}`,
        `Report: ${path.relative(process.cwd(), reportPath) || reportPath}`,
        `Unmatched report: ${path.relative(process.cwd(), unmatchedReport) || unmatchedReport}`,
        args.apply
          ? `Applied: ${appliedUpdates} metadata updates, ${defaultedPersonal} set/defaulted to PERSONAL`
          : 'Dry run only. Re-run with --apply to persist metadata + default PERSONAL.',
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


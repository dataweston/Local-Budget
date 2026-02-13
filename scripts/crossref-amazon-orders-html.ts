import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

type ParsedArgs = {
  htmlPath: string;
  year: number;
  maxDayGap: number;
  reportPath: string;
  apply: boolean;
  accountId?: string;
  includeSubscriptions: boolean;
};

type AmazonOrder = {
  orderId: string;
  orderPlaced: Date;
  total: number;
  itemTitles: string[];
};

type CandidateTx = {
  id: string;
  date: Date;
  amount: number;
  description: string;
  merchantName: string | null;
  metadata: unknown;
};

type OrderMatch = {
  order: AmazonOrder;
  tx: CandidateTx | null;
  dayDiff: number | null;
  confidence: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  candidateCount: number;
};

const DEFAULT_HTML_PATH = path.join('imports', 'sofi', 'Your Orders.html');

function usage() {
  console.log(
    [
      'Usage:',
      '  npm run amazon:crossref -- [--html <path>] [--year 2025] [--max-day-gap 21] [--report <path>] [--account-id <id>] [--include-subscriptions] [--apply]',
      '  npx tsx scripts/crossref-amazon-orders-html.ts [--html <path>] [--year 2025] [--apply]',
      '',
      'Examples:',
      '  npm run amazon:crossref',
      '  npm run amazon:crossref:apply',
      '  npx tsx scripts/crossref-amazon-orders-html.ts ".\\imports\\sofi\\Your Orders.html" 2025 --apply',
      '',
      'Notes:',
      '  - Parses saved Amazon "Your Orders" HTML pages.',
      '  - Cross-references with 2025 Amazon/AMZN expense transactions.',
      '  - --apply writes transaction metadata and creates [Amazon] line items for single-item matches.',
    ].join('\n')
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    htmlPath: DEFAULT_HTML_PATH,
    year: 2025,
    maxDayGap: 21,
    reportPath: path.join('imports', 'sofi', 'amazon-crossref-2025.csv'),
    apply: false,
    includeSubscriptions: false,
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
    if (arg === '--include-subscriptions') {
      out.includeSubscriptions = true;
      continue;
    }
    if (arg === '--html') {
      out.htmlPath = argv[i + 1] ?? out.htmlPath;
      i++;
      continue;
    }
    if (arg.startsWith('--html=')) {
      out.htmlPath = arg.slice('--html='.length);
      continue;
    }
    if (arg === '--year') {
      const v = Number.parseInt(argv[i + 1] ?? '', 10);
      if (!Number.isNaN(v)) out.year = v;
      i++;
      continue;
    }
    if (arg.startsWith('--year=')) {
      const v = Number.parseInt(arg.slice('--year='.length), 10);
      if (!Number.isNaN(v)) out.year = v;
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
    if (arg === '--account-id') {
      out.accountId = argv[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith('--account-id=')) {
      out.accountId = arg.slice('--account-id='.length);
      continue;
    }

    positionals.push(arg);
  }

  if (positionals.length >= 1 && out.htmlPath === DEFAULT_HTML_PATH) {
    out.htmlPath = positionals[0];
  }
  if (positionals.length >= 2 && out.year === 2025) {
    const v = Number.parseInt(positionals[1], 10);
    if (!Number.isNaN(v)) out.year = v;
  }

  if (out.reportPath === path.join('imports', 'sofi', 'amazon-crossref-2025.csv')) {
    out.reportPath = path.join('imports', 'sofi', `amazon-crossref-${out.year}.csv`);
  }

  return out;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m: string, name: string) => named[name] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function toUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseOrderDate(raw: string): Date | null {
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return toUtcDay(parsed);
}

function parseMoney(raw: string): number | null {
  const value = raw.replace(/[^0-9.-]/g, '');
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) return null;
  return Math.abs(parsed);
}

function parseAmazonOrders(htmlPath: string): AmazonOrder[] {
  const html = readFileSync(htmlPath, 'utf8');
  const marker = '<div class="order-card js-order-card">';
  const blocks: string[] = [];

  let idx = html.indexOf(marker);
  while (idx !== -1) {
    const next = html.indexOf(marker, idx + marker.length);
    blocks.push(html.slice(idx, next === -1 ? html.length : next));
    idx = next;
  }

  const orders: AmazonOrder[] = [];
  for (const block of blocks) {
    const dateMatch = block.match(
      /Order placed<\/span>[\s\S]*?<span class="a-size-base a-color-secondary aok-break-word">([^<]+)<\/span>/i
    );
    const totalMatch = block.match(
      /<span class="a-color-secondary a-text-caps">Total<\/span>[\s\S]*?<span class="a-size-base a-color-secondary aok-break-word">([^<]+)<\/span>/i
    );
    const orderIdMatch = block.match(
      /<div class="yohtmlc-order-id">[\s\S]*?<span class="a-color-secondary" dir="ltr">([^<]+)<\/span>/i
    );

    if (!dateMatch || !totalMatch || !orderIdMatch) continue;

    const orderDate = parseOrderDate(dateMatch[1]);
    const total = parseMoney(totalMatch[1]);
    if (!orderDate || total === null || total <= 0) continue;

    const titles = Array.from(
      block.matchAll(/<div class="yohtmlc-product-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)
    )
      .map((m) => decodeHtml(m[1]))
      .filter(Boolean);

    const uniqueTitles: string[] = [];
    const seen = new Set<string>();
    for (const t of titles) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueTitles.push(t);
    }

    orders.push({
      orderId: orderIdMatch[1].trim(),
      orderPlaced: orderDate,
      total,
      itemTitles: uniqueTitles,
    });
  }

  return orders;
}

function daysBetween(a: Date, b: Date): number {
  const ms = Math.abs(toUtcDay(a).getTime() - toUtcDay(b).getTime());
  return Math.round(ms / 86_400_000);
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function isSubscriptionLike(tx: CandidateTx): boolean {
  const text = `${tx.description} ${tx.merchantName ?? ''}`.toLowerCase();
  const patterns = [
    'prime video',
    'video channels',
    'amazon prime',
    'audible',
    'music unlimited',
    'kindle',
  ];
  return patterns.some((p) => text.includes(p));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function confidenceFor(dayDiff: number, candidateCount: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (dayDiff <= 3 && candidateCount === 1) return 'HIGH';
  if (dayDiff <= 7 && candidateCount <= 2) return 'HIGH';
  if (dayDiff <= 7) return 'MEDIUM';
  return 'LOW';
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const htmlPath = path.resolve(process.cwd(), args.htmlPath);
    const orders = parseAmazonOrders(htmlPath);

    if (orders.length === 0) {
      throw new Error(
        `No order cards parsed from HTML: ${path.relative(process.cwd(), htmlPath) || htmlPath}`
      );
    }

    const start = new Date(Date.UTC(args.year, 0, 1));
    const end = new Date(Date.UTC(args.year + 1, 0, 1));

    const txRows = await prisma.transaction.findMany({
      where: {
        type: 'EXPENSE',
        ...(args.accountId ? { accountId: args.accountId } : {}),
        date: { gte: start, lt: end },
        OR: [
          { description: { contains: 'amazon', mode: 'insensitive' } },
          { description: { contains: 'amzn', mode: 'insensitive' } },
          { merchantName: { contains: 'amazon', mode: 'insensitive' } },
          { merchantName: { contains: 'amzn', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        date: true,
        amount: true,
        description: true,
        merchantName: true,
        metadata: true,
      },
      orderBy: [{ date: 'asc' }],
    });

    let transactions: CandidateTx[] = txRows.map((t) => ({
      id: t.id,
      date: t.date,
      amount: Math.abs(Number(t.amount)),
      description: t.description,
      merchantName: t.merchantName,
      metadata: t.metadata,
    }));

    const totalAmazonTxBeforeSubscriptionFilter = transactions.length;
    if (!args.includeSubscriptions) {
      transactions = transactions.filter((tx) => !isSubscriptionLike(tx));
    }

    const txByCents = new Map<number, CandidateTx[]>();
    for (const tx of transactions) {
      const cents = toCents(tx.amount);
      const list = txByCents.get(cents) ?? [];
      list.push(tx);
      txByCents.set(cents, list);
    }
    for (const list of txByCents.values()) {
      list.sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    const usedTxIds = new Set<string>();
    const matches: OrderMatch[] = [];

    const sortedOrders = [...orders].sort((a, b) => a.orderPlaced.getTime() - b.orderPlaced.getTime());
    for (const order of sortedOrders) {
      const cents = toCents(order.total);
      const amountCandidates = [
        ...(txByCents.get(cents - 1) ?? []),
        ...(txByCents.get(cents) ?? []),
        ...(txByCents.get(cents + 1) ?? []),
      ];

      const eligible = amountCandidates
        .filter((tx) => !usedTxIds.has(tx.id))
        .map((tx) => ({ tx, dayDiff: daysBetween(tx.date, order.orderPlaced) }))
        .filter((x) => x.dayDiff <= args.maxDayGap)
        .sort((a, b) => a.dayDiff - b.dayDiff || a.tx.date.getTime() - b.tx.date.getTime());

      if (eligible.length === 0) {
        matches.push({
          order,
          tx: null,
          dayDiff: null,
          confidence: 'NONE',
          candidateCount: 0,
        });
        continue;
      }

      const chosen = eligible[0];
      usedTxIds.add(chosen.tx.id);
      matches.push({
        order,
        tx: chosen.tx,
        dayDiff: chosen.dayDiff,
        confidence: confidenceFor(chosen.dayDiff, eligible.length),
        candidateCount: eligible.length,
      });
    }

    const matchedCount = matches.filter((m) => m.tx).length;
    const unmatchedCount = matches.length - matchedCount;
    const singleItemMatched = matches.filter((m) => m.tx && m.order.itemTitles.length === 1).length;
    const highConfidence = matches.filter((m) => m.confidence === 'HIGH').length;

    const reportPath = path.resolve(process.cwd(), args.reportPath);
    mkdirSync(path.dirname(reportPath), { recursive: true });

    const headers = [
      'order_id',
      'order_date',
      'order_total',
      'item_count',
      'item_titles',
      'matched_tx_id',
      'matched_tx_date',
      'matched_tx_amount',
      'matched_tx_description',
      'day_diff',
      'candidate_count',
      'confidence',
    ];
    const lines: string[] = [headers.join(',')];

    for (const m of matches) {
      lines.push(
        [
          csvEscape(m.order.orderId),
          csvEscape(m.order.orderPlaced.toISOString().slice(0, 10)),
          csvEscape(m.order.total.toFixed(2)),
          csvEscape(m.order.itemTitles.length),
          csvEscape(m.order.itemTitles.join(' | ')),
          csvEscape(m.tx?.id ?? ''),
          csvEscape(m.tx ? m.tx.date.toISOString().slice(0, 10) : ''),
          csvEscape(m.tx ? m.tx.amount.toFixed(2) : ''),
          csvEscape(m.tx?.description ?? ''),
          csvEscape(m.dayDiff ?? ''),
          csvEscape(m.candidateCount),
          csvEscape(m.confidence),
        ].join(',')
      );
    }

    writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');

    const unmatchedTx = transactions.filter((tx) => !usedTxIds.has(tx.id));
    const unmatchedTxPath = reportPath.replace(/\.csv$/i, '-unmatched-transactions.csv');
    const txHeaders = ['tx_id', 'date', 'amount', 'description', 'merchant_name'];
    const txLines: string[] = [txHeaders.join(',')];
    for (const tx of unmatchedTx) {
      txLines.push(
        [
          csvEscape(tx.id),
          csvEscape(tx.date.toISOString().slice(0, 10)),
          csvEscape(tx.amount.toFixed(2)),
          csvEscape(tx.description),
          csvEscape(tx.merchantName ?? ''),
        ].join(',')
      );
    }
    writeFileSync(unmatchedTxPath, txLines.join('\n') + '\n', 'utf8');

    let updatedTransactions = 0;
    let createdLineItems = 0;

    if (args.apply) {
      for (const match of matches) {
        if (!match.tx) continue;

        const prevMeta = isRecord(match.tx.metadata) ? match.tx.metadata : {};
        const nextMeta = {
          ...prevMeta,
          amazonOrderMatch: {
            source: 'amazon-orders-html',
            sourceFile: path.basename(htmlPath),
            orderId: match.order.orderId,
            orderPlaced: match.order.orderPlaced.toISOString().slice(0, 10),
            orderTotal: Number(match.order.total.toFixed(2)),
            itemCount: match.order.itemTitles.length,
            itemTitles: match.order.itemTitles,
            dayDiff: match.dayDiff,
            candidateCount: match.candidateCount,
            confidence: match.confidence,
            matchedAt: new Date().toISOString(),
          },
        };

        await prisma.transaction.update({
          where: { id: match.tx.id },
          data: { metadata: nextMeta },
        });
        updatedTransactions++;

        await prisma.lineItem.deleteMany({
          where: {
            transactionId: match.tx.id,
            description: { startsWith: '[Amazon] ' },
          },
        });

        if (match.order.itemTitles.length === 1) {
          const itemTitle = match.order.itemTitles[0].slice(0, 470);
          await prisma.lineItem.create({
            data: {
              transaction: { connect: { id: match.tx.id } },
              description: `[Amazon] ${itemTitle}`,
              quantity: 1,
              unitPrice: match.tx.amount,
              totalPrice: match.tx.amount,
            },
          });
          createdLineItems++;
        }
      }
    }

    console.log(
      [
        '',
        `HTML file: ${path.relative(process.cwd(), htmlPath) || htmlPath}`,
        `Year: ${args.year}`,
        `Orders parsed: ${orders.length}`,
        `Amazon tx candidates (before subscription filter): ${totalAmazonTxBeforeSubscriptionFilter}`,
        `Amazon tx candidates (after filter): ${transactions.length}`,
        `Matched orders: ${matchedCount}`,
        `Unmatched orders: ${unmatchedCount}`,
        `High-confidence matches: ${highConfidence}`,
        `Matched single-item orders: ${singleItemMatched}`,
        `Report written: ${path.relative(process.cwd(), reportPath) || reportPath}`,
        `Unmatched tx report: ${path.relative(process.cwd(), unmatchedTxPath) || unmatchedTxPath}`,
        args.apply
          ? `Applied updates: ${updatedTransactions} transactions metadata, ${createdLineItems} line items`
          : 'Dry run only. Re-run with --apply to write metadata/line items.',
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

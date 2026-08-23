import { createHash } from 'crypto';

export type StripeBalanceRow = {
  externalId: string;
  occurredAt: Date;
  availableAt: Date | null;
  currency: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  reportingCategory: string | null;
  sourceId: string | null;
  description: string | null;
  arithmeticOk: boolean;
  payloadHash: string;
};

export class StripeImportError extends Error {}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim()));
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findColumn(headers: string[], aliases: string[], required = true): number {
  const normalized = headers.map(normalizedHeader);
  const index = aliases.map(normalizedHeader).map((alias) => normalized.indexOf(alias)).find((i) => i >= 0) ?? -1;
  if (required && index < 0) throw new StripeImportError(`missing Stripe column: ${aliases[0]}`);
  return index;
}

function cents(value: string, label: string): number {
  const cleaned = value.trim().replace(/[$,]/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new StripeImportError(`${label} must be a currency amount`);
  }
  return Math.round(Number(cleaned) * 100);
}

function date(value: string, label: string): Date {
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.valueOf())) throw new StripeImportError(`${label} must be a valid date`);
  return parsed;
}

function optional(row: string[], index: number): string | null {
  if (index < 0) return null;
  const value = (row[index] ?? '').trim();
  return value || null;
}

export function parseStripeBalanceCsv(text: string): StripeBalanceRow[] {
  const matrix = parseCsv(text.replace(/^\uFEFF/, ''));
  if (matrix.length < 2) throw new StripeImportError('Stripe balance CSV has no data rows');
  const headers = matrix[0];
  const columns = {
    id: findColumn(headers, ['id', 'balance transaction id']),
    created: findColumn(headers, ['created utc', 'created', 'created date utc']),
    available: findColumn(headers, ['available on utc', 'available on', 'available date utc'], false),
    currency: findColumn(headers, ['currency']),
    gross: findColumn(headers, ['gross']),
    fee: findColumn(headers, ['fee']),
    net: findColumn(headers, ['net']),
    category: findColumn(headers, ['reporting category', 'type'], false),
    source: findColumn(headers, ['source', 'source id'], false),
    description: findColumn(headers, ['description'], false),
  };

  const seen = new Set<string>();
  return matrix.slice(1).map((row, rowOffset) => {
    const externalId = (row[columns.id] ?? '').trim();
    if (!externalId) throw new StripeImportError(`row ${rowOffset + 2} is missing id`);
    if (seen.has(externalId)) throw new StripeImportError(`duplicate Stripe id in file: ${externalId}`);
    seen.add(externalId);
    const grossCents = cents(row[columns.gross] ?? '', `row ${rowOffset + 2} gross`);
    const feeCents = cents(row[columns.fee] ?? '', `row ${rowOffset + 2} fee`);
    const netCents = cents(row[columns.net] ?? '', `row ${rowOffset + 2} net`);
    const arithmeticOk =
      grossCents + feeCents === netCents || grossCents - Math.abs(feeCents) === netCents;
    const stablePayload = {
      externalId,
      created: row[columns.created] ?? '',
      available: optional(row, columns.available),
      currency: (row[columns.currency] ?? '').trim().toUpperCase(),
      grossCents,
      feeCents,
      netCents,
      reportingCategory: optional(row, columns.category),
      sourceId: optional(row, columns.source),
      description: optional(row, columns.description),
    };
    return {
      externalId,
      occurredAt: date(stablePayload.created, `row ${rowOffset + 2} created`),
      availableAt: stablePayload.available ? date(stablePayload.available, `row ${rowOffset + 2} available`) : null,
      currency: stablePayload.currency,
      grossCents,
      feeCents,
      netCents,
      reportingCategory: stablePayload.reportingCategory,
      sourceId: stablePayload.sourceId,
      description: stablePayload.description,
      arithmeticOk,
      payloadHash: createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex'),
    };
  });
}

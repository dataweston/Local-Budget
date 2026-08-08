/**
 * One-off classification repairs from the 2026-08 categorization audit.
 *
 * Owner determinations being applied here:
 *   - Labor (Square Payroll) is a business expense. The category carried no
 *     default classification at all, so every row fell through to the old
 *     PERSONAL fallback and payroll was reported as owner spending.
 *   - Debt defaults to PERSONAL: repayments routed to personal loan sources
 *     (Will, Fallon, Catherine, Capital One) pass through the owner first and
 *     count as founder comp, not business cost.
 *   - The Square Capital loan IS business debt and stays OPERATING.
 *   - Great Ciao was booked as "debt" only because it was a year-old open
 *     invoice; it was a food purchase, so it belongs in Inventory / COGS.
 *
 * Dry run by default. Pass --apply to write.
 */
import './load-env';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Payees that are personal loan sources — money reaching them is founder comp. */
const PERSONAL_LOAN_PAYEES = /(will lange|fallon|catherine|capital one)/i;

/** The business's own financing. Stays a business cost. */
const BUSINESS_DEBT = /square loan/i;

type Change = {
  id: string;
  date: string;
  description: string;
  amount: number;
  /** What the row reported BEFORE this fix (explicit value, else the category
   *  default, else the old PERSONAL fallback). Drives the impact summary. */
  effectiveBefore: string;
  from: string;
  to: string;
  note: string;
};

const BUSINESS = new Set(['COGS', 'OPERATING', 'REIMBURSABLE']);

async function main() {
  const changes: Change[] = [];
  const skipped: Change[] = [];

  const [laborCat, debtCat, inventoryCat] = await Promise.all([
    db.category.findFirst({ where: { name: 'Labor' }, select: { id: true, defaultClassification: true } }),
    db.category.findFirst({ where: { name: 'Debt' }, select: { id: true, defaultClassification: true } }),
    db.category.findFirst({ where: { name: 'Inventory' }, select: { id: true } }),
  ]);
  if (!laborCat || !debtCat || !inventoryCat) {
    throw new Error('Expected Labor, Debt and Inventory categories to exist');
  }

  // ── 1. Labor → business ────────────────────────────────────────────────
  const laborRows = await db.transaction.findMany({
    where: { categoryId: laborCat.id },
    select: { id: true, date: true, description: true, amount: true, classification: true },
  });
  for (const tx of laborRows) {
    if (tx.classification === 'OPERATING') continue;
    changes.push({
      id: tx.id,
      date: tx.date.toISOString().slice(0, 10),
      description: tx.description,
      amount: Number(tx.amount),
      // Labor had no category default, so these fell through to PERSONAL.
      effectiveBefore: tx.classification ?? laborCat.defaultClassification ?? 'PERSONAL',
      from: tx.classification ?? '(none → reported as personal)',
      to: 'OPERATING',
      note: 'Labor is a business expense',
    });
  }

  // ── 2. Debt rows, split by who was actually paid ───────────────────────
  const debtRows = await db.transaction.findMany({
    where: { categoryId: debtCat.id },
    select: {
      id: true, date: true, description: true, merchantName: true,
      amount: true, classification: true,
    },
  });
  for (const tx of debtRows) {
    const text = `${tx.merchantName ?? ''} ${tx.description}`;
    const row = {
      id: tx.id,
      date: tx.date.toISOString().slice(0, 10),
      description: tx.description,
      amount: Number(tx.amount),
      effectiveBefore: tx.classification ?? debtCat.defaultClassification ?? 'PERSONAL',
      from: tx.classification ?? '(none)',
    };

    if (BUSINESS_DEBT.test(text)) {
      if (tx.classification !== 'OPERATING') {
        changes.push({ ...row, to: 'OPERATING', note: 'Square Capital loan is business debt' });
      }
      continue;
    }
    if (/great ciao/i.test(text)) {
      changes.push({
        ...row,
        to: 'COGS',
        note: 'Aged food invoice → recategorize to Inventory, classify COGS',
      });
      continue;
    }
    if (PERSONAL_LOAN_PAYEES.test(text)) {
      if (tx.classification !== 'PERSONAL') {
        changes.push({ ...row, to: 'PERSONAL', note: 'Personal loan source → founder comp' });
      }
      continue;
    }
    // No identifiable payee — the owner has to make this call.
    skipped.push({ ...row, to: '(unchanged)', note: 'No payee in description — needs a human decision' });
  }

  const catChanges: string[] = [];
  if (laborCat.defaultClassification !== 'OPERATING') {
    catChanges.push(`Labor.defaultClassification: ${laborCat.defaultClassification ?? 'null'} → OPERATING`);
  }
  if (debtCat.defaultClassification !== 'PERSONAL') {
    catChanges.push(`Debt.defaultClassification: ${debtCat.defaultClassification ?? 'null'} → PERSONAL`);
  }

  // ── report ─────────────────────────────────────────────────────────────
  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — ${changes.length} transaction change(s)\n`);
  for (const c of changes) {
    console.log(
      `  ${c.date}  ${c.description.slice(0, 44).padEnd(44)} ` +
      `$${c.amount.toFixed(2).padStart(9)}  ${c.from} → ${c.to}\n` +
      `${' '.repeat(14)}${c.note}`
    );
  }
  if (catChanges.length) {
    console.log('\nCategory defaults:');
    for (const c of catChanges) console.log(`  ${c}`);
  }
  if (skipped.length) {
    console.log('\nLeft alone (needs your decision):');
    for (const s of skipped) {
      console.log(`  ${s.date}  ${s.description}  $${s.amount.toFixed(2)}  — ${s.note}`);
    }
  }

  // Impact on the business P&L: compare what each row reported before against
  // what it will report after. Moves within business (e.g. → COGS) are neutral.
  let intoBusiness = 0;
  let outOfBusiness = 0;
  for (const c of changes) {
    const was = BUSINESS.has(c.effectiveBefore);
    const now = BUSINESS.has(c.to);
    if (!was && now) intoBusiness += c.amount;
    if (was && !now) outOfBusiness += c.amount;
  }
  console.log(
    `\nBusiness expense impact:\n` +
    `  moved INTO business:  +$${intoBusiness.toFixed(2)}\n` +
    `  moved OUT to personal: -$${outOfBusiness.toFixed(2)}\n` +
    `  net business expense:  ${(intoBusiness - outOfBusiness >= 0 ? '+' : '-')}$${Math.abs(intoBusiness - outOfBusiness).toFixed(2)}` +
    ` (operating income moves the opposite way)`
  );

  if (!APPLY) {
    console.log('\nNo changes written. Re-run with --apply to commit.\n');
    return;
  }

  await db.$transaction(async (tx) => {
    for (const c of changes) {
      await tx.transaction.update({
        where: { id: c.id },
        data: {
          classification: c.to as 'OPERATING' | 'PERSONAL' | 'COGS',
          isReviewed: true,
          ...(c.note.startsWith('Aged food invoice') && { categoryId: inventoryCat.id }),
        },
      });
    }
    if (laborCat.defaultClassification !== 'OPERATING') {
      await tx.category.update({
        where: { id: laborCat.id },
        data: { defaultClassification: 'OPERATING' },
      });
    }
    if (debtCat.defaultClassification !== 'PERSONAL') {
      await tx.category.update({
        where: { id: debtCat.id },
        data: { defaultClassification: 'PERSONAL' },
      });
    }
  });

  console.log('\nApplied.\n');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());

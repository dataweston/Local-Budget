import { describe, it, expect } from 'vitest';
import {
  getEffectiveClassification,
  blankReport,
  applyPnlLine,
  aggregatePnl,
  derivePnlMetrics,
} from '@/lib/pnl';

describe('getEffectiveClassification', () => {
  it('prefers the explicit transaction classification', () => {
    expect(
      getEffectiveClassification({
        classification: 'COGS',
        type: 'EXPENSE',
        category: { defaultClassification: 'OPERATING' },
      })
    ).toBe('COGS');
  });

  it('falls back to the category default', () => {
    expect(
      getEffectiveClassification({
        classification: null,
        type: 'EXPENSE',
        category: { defaultClassification: 'OPERATING' },
      })
    ).toBe('OPERATING');
  });

  it('falls back to the transaction type for income and transfers', () => {
    expect(getEffectiveClassification({ type: 'INCOME' })).toBe('INCOME');
    expect(getEffectiveClassification({ type: 'TRANSFER' })).toBe('TRANSFER');
  });

  it('defaults to PERSONAL for unclassified expenses', () => {
    expect(getEffectiveClassification({ type: 'EXPENSE' })).toBe('PERSONAL');
    expect(getEffectiveClassification({})).toBe('PERSONAL');
  });
});

describe('applyPnlLine — contra-revenue', () => {
  it('nets EXPENSE-typed INCOME lines (refunds) against revenue, not expenses', () => {
    const report = blankReport(2026);
    applyPnlLine(report, 100, 'INCOME', null, '', { txType: 'INCOME' });
    applyPnlLine(report, 25, 'INCOME', null, '', { txType: 'EXPENSE' }); // refund

    expect(report.revenue).toBe(100);
    expect(report.refunds).toBe(25);
    expect(report.personalExpenses).toBe(0);
    expect(report.operatingExpenses).toBe(0);

    const derived = derivePnlMetrics(report);
    expect(derived.totalRevenue).toBe(75);
  });

  it('shows refunds as a negative category row', () => {
    const report = blankReport(2026);
    applyPnlLine(report, 40, 'INCOME', null, '', { txType: 'EXPENSE' });
    const rows = Array.from(report.byCategory.values());
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Refunds');
    expect(rows[0].amount).toBe(-40);
  });
});

describe('derivePnlMetrics — unified semantics', () => {
  const totals = {
    ...blankReport(2026),
    revenue: 1000,
    refunds: 50,
    reimbursementIncome: 100,
    cogs: 300,
    operatingExpenses: 200,
    reimbursableExpenses: 80,
    personalExpenses: 150,
  };

  it('excludes reimbursables from operating income and personal from business net', () => {
    const d = derivePnlMetrics(totals);
    expect(d.totalRevenue).toBe(1050); // 1000 - 50 + 100
    expect(d.grossProfit).toBe(750);
    expect(d.operatingIncome).toBe(550); // reimbursables NOT subtracted
    expect(d.netBusinessIncome).toBe(550);
    expect(d.netCashFlow).toBe(1050 - (300 + 200 + 150 + 80)); // 320
  });
});

describe('aggregatePnl — splits and tax exclusion', () => {
  it('uses splits when present and excludes TRANSFER splits (collected sales tax)', () => {
    const report = blankReport(2026);
    aggregatePnl(report, [
      {
        amount: 108.5,
        type: 'INCOME',
        classification: null,
        categoryId: null,
        category: null,
        splits: [
          { amount: 100, classification: 'INCOME', category: null },
          { amount: 8.5, classification: 'TRANSFER', category: null }, // sales tax
        ],
      },
    ]);
    expect(report.revenue).toBe(100);
    const derived = derivePnlMetrics(report);
    expect(derived.totalRevenue).toBe(100); // tax never enters revenue
  });
});

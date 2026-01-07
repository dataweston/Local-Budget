// Domain types that extend Prisma types with additional computed fields

import type {
  Entity,
  FinancialAccount,
  Transaction,
  Category,
  Receipt,
  LineItem,
  TransactionLink,
  ClassificationRule,
  Vendor,
  Item,
} from '@prisma/client';

// ============================================================================
// Extended Types with Relations
// ============================================================================

export type EntityWithAccounts = Entity & {
  financialAccounts: FinancialAccount[];
};

export type AccountWithTransactions = FinancialAccount & {
  transactions: Transaction[];
  entity: Entity | null;
};

export type TransactionWithRelations = Transaction & {
  account: FinancialAccount;
  category: Category | null;
  payer: Entity | null;
  incurredBy: Entity | null;
  lineItems: LineItem[];
  receiptLinks: ReceiptLinkWithReceipt[];
  linkedFrom: TransactionLinkWithTransactions[];
  linkedTo: TransactionLinkWithTransactions[];
};

export type ReceiptLinkWithReceipt = {
  id: string;
  receiptId: string;
  transactionId: string;
  matchConfidence: number | null;
  isManual: boolean;
  receipt: Receipt;
};

export type TransactionLinkWithTransactions = TransactionLink & {
  fromTransaction: Transaction;
  toTransaction: Transaction;
};

export type CategoryWithChildren = Category & {
  children: Category[];
  parent: Category | null;
};

export type ReceiptWithLineItems = Receipt & {
  lineItems: LineItem[];
  transactionLinks: {
    id: string;
    transaction: Transaction;
    matchConfidence: number | null;
  }[];
};

export type LineItemWithRelations = LineItem & {
  vendor: Vendor | null;
  item: Item | null;
  transaction: Transaction | null;
  receipt: Receipt | null;
};

// ============================================================================
// Dashboard & Reporting Types
// ============================================================================

export interface CashflowSummary {
  period: string;
  income: number;
  expenses: number;
  net: number;
  byClassification: {
    cogs: number;
    operating: number;
    personal: number;
  };
}

export interface AccountBalance {
  accountId: string;
  accountName: string;
  accountType: string;
  balance: number;
  lastUpdated: Date;
}

export interface CategorySpend {
  categoryId: string;
  categoryName: string;
  icon: string | null;
  amount: number;
  transactionCount: number;
  percentOfTotal: number;
}

export interface VendorSpend {
  vendorId: string | null;
  vendorName: string;
  amount: number;
  transactionCount: number;
  averageTransaction: number;
}

export interface DashboardStats {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyNet: number;
  pendingReceipts: number;
  unreviewedTransactions: number;
  recentTransactions: TransactionWithRelations[];
}

export interface ProfitLoss {
  period: {
    start: Date;
    end: Date;
  };
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  operatingExpenses: number;
  operatingIncome: number;
  operatingMargin: number;
  byCategory: {
    categoryId: string;
    categoryName: string;
    classification: string;
    amount: number;
  }[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Form Types
// ============================================================================

export interface TransactionFormData {
  accountId: string;
  amount: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  date: Date;
  description: string;
  merchantName?: string;
  categoryId?: string;
  classification?: string;
  payerId?: string;
  incurredById?: string;
  notes?: string;
}

export interface ReceiptUpload {
  file: File;
  source: 'upload' | 'email' | 'api';
}

// ============================================================================
// Filter Types
// ============================================================================

export interface DateRange {
  start: Date;
  end: Date;
}

export interface TransactionFilterState {
  search: string;
  accounts: string[];
  categories: string[];
  classifications: string[];
  types: string[];
  entities: string[];
  dateRange: DateRange | null;
  amountRange: {
    min: number | null;
    max: number | null;
  };
  showReviewed: boolean;
  showReconciled: boolean;
}

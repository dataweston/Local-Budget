import { z } from 'zod';

// ============================================================================
// Common Schemas
// ============================================================================

export const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(20),
});

export const dateRangeSchema = z.object({
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

// ============================================================================
// Entity Schemas
// ============================================================================

export const entityTypeEnum = z.enum(['PERSON', 'BUSINESS', 'PROJECT']);

export const createEntitySchema = z.object({
  type: entityTypeEnum,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export const updateEntitySchema = createEntitySchema.partial();

// ============================================================================
// Financial Account Schemas
// ============================================================================

export const accountTypeEnum = z.enum([
  'CHECKING',
  'SAVINGS',
  'CREDIT_CARD',
  'CASH',
  'INVESTMENT',
  'LOAN',
  'OTHER',
]);

export const createAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: accountTypeEnum,
  entityId: z.string().optional(),
  institution: z.string().max(100).optional(),
  accountNumber: z.string().max(4).optional(),
  currentBalance: z.number().default(0),
  currency: z.string().length(3).default('USD'),
});

export const updateAccountSchema = createAccountSchema.partial();

// ============================================================================
// Transaction Schemas
// ============================================================================

export const transactionTypeEnum = z.enum(['INCOME', 'EXPENSE', 'TRANSFER']);
export const transactionStatusEnum = z.enum(['PENDING', 'POSTED', 'CANCELLED']);
export const classificationTypeEnum = z.enum([
  'COGS',
  'OPERATING',
  'PERSONAL',
  'INCOME',
  'TRANSFER',
  'REIMBURSABLE',
  'REIMBURSEMENT',
]);

export const createTransactionSchema = z.object({
  accountId: z.string(),
  amount: z.number(),
  type: transactionTypeEnum,
  status: transactionStatusEnum.default('POSTED'),
  date: z.date(),
  description: z.string().min(1).max(500),
  merchantName: z.string().max(200).optional(),
  categoryId: z.string().optional(),
  classification: classificationTypeEnum.optional(),
  payerId: z.string().optional(),
  incurredById: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial().extend({
  isReviewed: z.boolean().optional(),
  isReconciled: z.boolean().optional(),
  userDescription: z.string().max(500).optional(),
});

export const transactionFiltersSchema = z.object({
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  classification: classificationTypeEnum.optional(),
  type: transactionTypeEnum.optional(),
  status: transactionStatusEnum.optional(),
  entityId: z.string().optional(),
  isReviewed: z.boolean().optional(),
  isReconciled: z.boolean().optional(),
  search: z.string().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
}).merge(dateRangeSchema).merge(paginationSchema);

// ============================================================================
// Category Schemas
// ============================================================================

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  parentId: z.string().optional(),
  defaultClassification: classificationTypeEnum.optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

// ============================================================================
// Receipt Schemas
// ============================================================================

export const receiptStatusEnum = z.enum([
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'REVIEWED',
]);

export const uploadReceiptSchema = z.object({
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  source: z.string().optional(),
});

export const updateReceiptSchema = z.object({
  vendorName: z.string().optional(),
  totalAmount: z.number().optional(),
  receiptDate: z.date().optional(),
  notes: z.string().optional(),
  status: receiptStatusEnum.optional(),
});

export const linkReceiptSchema = z.object({
  receiptId: z.string(),
  transactionId: z.string(),
  isManual: z.boolean().default(true),
});

// ============================================================================
// Classification Rule Schemas
// ============================================================================

export const ruleMatchTypeEnum = z.enum(['EXACT', 'CONTAINS', 'STARTS_WITH', 'REGEX']);

export const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  matchField: z.string(),
  matchType: ruleMatchTypeEnum,
  matchValue: z.string().min(1),
  categoryId: z.string().optional(),
  classification: classificationTypeEnum.optional(),
  incurredById: z.string().optional(),
  priority: z.number().default(0),
});

export const updateRuleSchema = createRuleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ============================================================================
// Transaction Link Schemas
// ============================================================================

export const createTransactionLinkSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  linkType: z.string(),
  amount: z.number().optional(),
  notes: z.string().optional(),
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type UploadReceiptInput = z.infer<typeof uploadReceiptSchema>;
export type UpdateReceiptInput = z.infer<typeof updateReceiptSchema>;
export type LinkReceiptInput = z.infer<typeof linkReceiptSchema>;
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type CreateTransactionLinkInput = z.infer<typeof createTransactionLinkSchema>;

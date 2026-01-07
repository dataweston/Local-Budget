# Local Budget - Agent Development Roadmap

> Last Updated: January 6, 2026
> Current Status: Phase 3 Complete (Rules Engine, Webhooks)

## Project Overview

Local Budget is a personal + small-business finance system built with:
- **Frontend**: Next.js 14, React, Tailwind CSS, shadcn/ui
- **Backend**: tRPC, Prisma ORM
- **Database**: PostgreSQL (Docker)
- **Auth**: NextAuth.js with credentials provider (JWT strategy)

## Current State Assessment

### ✅ Completed (Phase 1)

#### Authentication System
- `src/lib/auth.ts` - NextAuth config with credentials provider, JWT sessions
- `src/app/api/auth/[...nextauth]/route.ts` - Auth API handler
- `src/app/api/auth/register/route.ts` - User registration with default entity + 18 categories
- `src/app/login/page.tsx` - Login form
- `src/app/register/page.tsx` - Registration form
- `src/middleware.ts` - Route protection (protects all routes except /login, /register, /api/auth)
- `src/components/providers/session-provider.tsx` - SessionProvider wrapper

#### Protected tRPC Routers
All routers in `src/server/api/routers/` use `protectedProcedure` and filter by `ctx.session.user.id`:
- `accounts.ts` - Account CRUD with ownership verification
- `transactions.ts` - Transaction CRUD with account ownership checks
- `categories.ts` - Category CRUD
- `entities.ts` - Entity CRUD (PERSON, BUSINESS, PROJECT types)
- `dashboard.ts` - Dashboard aggregation queries
- `receipts.ts` - Receipt management

#### CRUD Form Modals
- `src/components/accounts/AddAccountModal.tsx` - Account creation
- `src/components/transactions/AddTransactionModal.tsx` - Transaction creation
- `src/components/ui/dialog.tsx` - Reusable modal component
- `src/components/ui/select.tsx` - Reusable select component

#### Management Pages
- `src/app/entities/page.tsx` - Full CRUD for entities
- `src/app/categories/page.tsx` - Full CRUD for categories with classification support

#### Navigation
- `src/components/dashboard/header.tsx` - Header with settings dropdown (Entities, Categories, Sign Out)

### 🔄 Phase 2 In Progress

#### ✅ Plaid Integration (Complete)
- `src/lib/plaid.ts` - Plaid client with helper functions:
  - `createLinkToken()` - Generate Plaid Link tokens
  - `exchangePublicToken()` - Exchange public token for access token
  - `getAccountBalances()` - Fetch account balances
  - `syncTransactions()` - Cursor-based transaction sync
  - `getInstitution()` - Fetch institution details
  - `removeItem()` - Disconnect a Plaid item
- `src/app/api/plaid/create-link-token/route.ts` - POST endpoint for link token generation
- `src/app/api/plaid/exchange-token/route.ts` - POST endpoint for token exchange, creates PlaidItem, PlaidAccount, and FinancialAccount records
- `src/app/api/plaid/sync/route.ts` - POST endpoint for cursor-based transaction sync
- `src/components/accounts/PlaidLinkButton.tsx` - UI component using react-plaid-link

#### ✅ Square Integration (Complete)
- `src/lib/square.ts` - Square client with OAuth and banking capabilities:
  - OAuth flow: `getSquareOAuthUrl()`, `exchangeSquareAuthCode()`, `refreshSquareToken()`
  - Banking: `getSquareBankAccounts()`, `getSquareBalance()`
  - Transactions: `listSquarePayments()`, `listSquareOrders()`
  - Type mappings: `mapSquarePayment()`, `mapSquareOrder()`
  - Exported APIs: paymentsApi, ordersApi, customersApi, catalogApi, locationsApi, bankAccountsApi, transactionsApi, oAuthApi
- `src/app/api/square/connect/route.ts` - POST endpoint to initiate OAuth flow
- `src/app/api/square/callback/route.ts` - GET endpoint for OAuth callback
- `src/app/api/square/sync/route.ts` - POST endpoint for syncing Square payments
- `src/components/accounts/SquareConnectButton.tsx` - UI component for OAuth flow
- `src/app/accounts/square-callback/page.tsx` - OAuth callback handler page

#### ✅ Receipt OCR Pipeline (Complete)
- `src/lib/ocr.ts` - Tesseract.js wrapper with:
  - `extractText()` - Raw OCR text extraction
  - `parseReceiptText()` - Regex-based data extraction (vendor, total, tax, date, line items)
  - `processReceiptImage()` - Full pipeline combining extraction and parsing
- `src/app/api/receipts/upload/route.ts` - POST endpoint for receipt upload with OCR processing
- `src/components/receipts/UploadReceiptModal.tsx` - Drag-and-drop upload modal with preview and extracted data review

#### ✅ Accounts Page Enhanced
- `src/components/accounts/accounts-list.tsx` - Updated with:
  - "Connect Account" dropdown menu with Plaid and Square options
  - Integrated PlaidLinkButton and SquareConnectButton
  - Account refresh on successful connection

### 🔄 Partially Complete

#### Dashboard Components
Files exist but may need refinement:
- `src/components/dashboard/dashboard.tsx`
- `src/components/dashboard/stats-cards.tsx`
- `src/components/dashboard/cashflow-chart.tsx`
- `src/components/dashboard/recent-transactions.tsx`
- `src/components/dashboard/accounts-overview.tsx`
- `src/components/dashboard/category-breakdown.tsx`
- `src/components/dashboard/alerts-panel.tsx`

### ✅ Completed (Phase 3)

#### Rules Engine (Complete)
- `src/server/api/routers/rules.ts` - tRPC router with full CRUD:
  - `list` - List all rules with category info
  - `getById` - Get single rule
  - `create` - Create new rule with regex validation
  - `update` - Update existing rule
  - `delete` - Delete rule
  - `toggleActive` - Enable/disable rule
  - `applyRules` - Apply rules to uncategorized transactions (supports dry-run)
  - `suggest` - Get rule suggestions based on transaction patterns
  - `test` - Test a rule pattern against existing transactions
- `src/app/rules/page.tsx` - Full management UI with:
  - Rule list with enable/disable toggles
  - Create/edit modal with pattern testing
  - Rule suggestions based on merchant patterns
  - Apply rules to all uncategorized transactions
  - Priority ordering support

#### Plaid Webhooks (Complete)
- `src/app/api/plaid/webhook/route.ts` - Webhook handler with:
  - Transaction sync events (SYNC_UPDATES_AVAILABLE, INITIAL_UPDATE, etc.)
  - Transaction removal events
  - Item error handling (ERROR, PENDING_EXPIRATION, USER_PERMISSION_REVOKED)
  - Automatic balance updates after sync
  - Webhook signature verification placeholder for production

#### Square Webhooks (Complete)
- `src/app/api/square/webhook/route.ts` - Webhook handler with:
  - Payment events (created, updated, completed)
  - Refund events (created, updated)
  - Order events (created, updated)
  - Bank account events (created, disabled)
  - OAuth revocation handling
  - HMAC-SHA256 signature verification

#### Navigation Update
- `src/components/dashboard/header.tsx` - Added Rules link to settings dropdown

---

## Database Schema Reference

Key models in `prisma/schema.prisma`:

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String?
  // ... has many: entities, accounts, transactions, categories, receipts
}

model Entity {
  type  EntityType  // PERSON, BUSINESS, PROJECT
  // Used for: payer tracking, expense allocation
}

model FinancialAccount {
  type  AccountType  // CHECKING, SAVINGS, CREDIT_CARD, CASH, INVESTMENT, LOAN, OTHER
  // Links to Plaid via plaidAccountId
}

model Transaction {
  classification  ClassificationType?  // COGS, OPERATING, PERSONAL, INCOME, TRANSFER, REIMBURSABLE, REIMBURSEMENT
  // Critical for business expense tracking
}

model Category {
  defaultClassification  ClassificationType?
  // When transaction uses this category, apply this classification
}

model Receipt {
  status  ReceiptStatus  // PENDING, PROCESSING, PROCESSED, FAILED, REVIEWED
  // OCR results stored in ocrRawText, ocrConfidence
}
```

---

## Common Patterns

### Adding a new tRPC router

1. Create router file in `src/server/api/routers/`
2. Use `protectedProcedure` for authenticated routes
3. Always filter by `userId: ctx.session.user.id`
4. Add to `src/server/api/root.ts`

### Adding a new page

1. Create in `src/app/[route]/page.tsx`
2. Use `'use client'` directive for interactive pages
3. Import `Header` from `@/components/dashboard/header`
4. Use `api.[router].[procedure].useQuery/useMutation()`

### Form modals pattern

```tsx
const [open, setOpen] = useState(false);
const mutation = api.something.create.useMutation({
  onSuccess: () => {
    utils.something.list.invalidate();
    setOpen(false);
  },
});
```

---

## Environment Variables Required

```env
# Database
DATABASE_URL="postgresql://..."

# Auth
NEXTAUTH_SECRET="..."
NEXTAUTH_URL="http://localhost:3000"

# Plaid
PLAID_CLIENT_ID="..."
PLAID_SECRET="..."
PLAID_ENV="sandbox"  # or development, production

# Square
SQUARE_APPLICATION_ID="..."
SQUARE_APPLICATION_SECRET="..."
SQUARE_ACCESS_TOKEN="..."  # For server-side API calls (optional if using OAuth)
SQUARE_ENV="sandbox"  # or production
NEXT_PUBLIC_SQUARE_APPLICATION_ID="..."  # For client-side OAuth
```

---

## Running the Project

```bash
# Start PostgreSQL
docker-compose up -d

# Install dependencies
npm install --legacy-peer-deps

# Run migrations
npx prisma migrate dev

# Seed database (optional)
npx prisma db seed

# Start dev server
npm run dev
```

---

## Testing Checklist

Before marking a phase complete:

- [ ] All routes protected (middleware + tRPC procedures)
- [ ] User data isolation (filter by userId)
- [ ] Form validation (Zod schemas)
- [ ] Error handling (try/catch, error toasts)
- [ ] Loading states (Skeleton components)
- [ ] Mobile responsive (test at 375px width)
- [ ] TypeScript clean (`npx tsc --noEmit`)

---

## Known Issues / Tech Debt

1. **Decimal handling**: Prisma Decimal type needs `Number()` conversion in components
2. **Dashboard charts**: Currently showing text-based summaries, could add Chart.js/Recharts
3. **Toaster**: Imported but may need implementation for mutation success/error feedback
4. **Mobile menu**: Header has mobile menu button but no drawer implementation

---

## Contact / Resources

- **Prisma docs**: https://www.prisma.io/docs
- **tRPC docs**: https://trpc.io/docs
- **NextAuth docs**: https://next-auth.js.org
- **Plaid docs**: https://plaid.com/docs
- **Tesseract.js**: https://tesseract.projectnaptha.com

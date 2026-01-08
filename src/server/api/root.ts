import { createTRPCRouter } from './trpc';
import { accountsRouter } from './routers/accounts';
import { transactionsRouter } from './routers/transactions';
import { categoriesRouter } from './routers/categories';
import { entitiesRouter } from './routers/entities';
import { receiptsRouter } from './routers/receipts';
import { dashboardRouter } from './routers/dashboard';
import { rulesRouter } from './routers/rules';
import { transactionLinksRouter } from './routers/transactionLinks';
import { suggestionsRouter } from './routers/suggestions';
import { vendorsRouter } from './routers/vendors';

/**
 * This is the primary router for the Local Budget API.
 *
 * All routers added here will be exposed via /api/trpc
 */
export const appRouter = createTRPCRouter({
  accounts: accountsRouter,
  transactions: transactionsRouter,
  categories: categoriesRouter,
  entities: entitiesRouter,
  receipts: receiptsRouter,
  dashboard: dashboardRouter,
  rules: rulesRouter,
  transactionLinks: transactionLinksRouter,
  suggestions: suggestionsRouter,
  vendors: vendorsRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;

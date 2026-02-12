import { Suspense } from 'react';
import { TransactionsList } from '@/components/transactions/transactions-list';

export default function TransactionsPage() {
  return (
    <main className="min-h-screen bg-background">
      <Suspense>
        <TransactionsList />
      </Suspense>
    </main>
  );
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const accountId = 'cmk7p4w3b0003qitvgkvs6903'; // TOTAL CHECKING
  const categoryId = 'cmlk2fq0s0001ry9kjhun1be2'; // Eastside (defaultClassification: INCOME)

  // Transaction 1: Dec 30 2025, $2600 INCOME, "house account", category: Eastside
  const tx1 = await prisma.transaction.create({
    data: {
      accountId,
      amount: 2600.00,
      type: 'INCOME',
      status: 'POSTED',
      date: new Date('2025-12-30T00:00:00'),
      description: 'house account',
      merchantName: 'house account',
      categoryId,
      classification: 'INCOME',
      isReviewed: true,
    },
  });
  console.log('Created income tx:', tx1.id);

  // Update balance +2600
  await prisma.financialAccount.update({
    where: { id: accountId },
    data: { currentBalance: { increment: 2600.00 } },
  });

  // Transaction 2: Dec 31 2025, $2600 EXPENSE, "house account spent", merchant: Eastside Food Cooperative
  const tx2 = await prisma.transaction.create({
    data: {
      accountId,
      amount: 2600.00,
      type: 'EXPENSE',
      status: 'POSTED',
      date: new Date('2025-12-31T00:00:00'),
      description: 'house account spent',
      merchantName: 'Eastside Food Cooperative',
      categoryId,
      isReviewed: true,
    },
  });
  console.log('Created expense tx:', tx2.id);

  // Update balance -2600
  await prisma.financialAccount.update({
    where: { id: accountId },
    data: { currentBalance: { increment: -2600.00 } },
  });

  console.log('Done. Both transactions added to TOTAL CHECKING.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

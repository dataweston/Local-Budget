import { PrismaClient, EntityType, AccountType, ClassificationType } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo user
  const passwordHash = await hash('demo123', 12);
  const user = await prisma.user.upsert({
    where: { email: 'demo@localbudget.app' },
    update: {},
    create: {
      email: 'demo@localbudget.app',
      name: 'Demo User',
      passwordHash,
    },
  });
  console.log('✅ Created demo user:', user.email);

  // Create entities
  const personalEntity = await prisma.entity.upsert({
    where: { id: 'personal-entity' },
    update: {},
    create: {
      id: 'personal-entity',
      userId: user.id,
      type: EntityType.PERSON,
      name: 'Personal',
      isDefault: true,
    },
  });

  const businessEntity = await prisma.entity.upsert({
    where: { id: 'business-entity' },
    update: {},
    create: {
      id: 'business-entity',
      userId: user.id,
      type: EntityType.BUSINESS,
      name: 'My Business',
      description: 'Small business operations',
    },
  });
  console.log('✅ Created entities');

  // Create default categories
  const categories = [
    // Income
    { name: 'Salary', icon: '💰', defaultClassification: ClassificationType.INCOME },
    { name: 'Business Revenue', icon: '📈', defaultClassification: ClassificationType.INCOME },
    { name: 'Freelance', icon: '💻', defaultClassification: ClassificationType.INCOME },
    { name: 'Reimbursements', icon: '🔄', defaultClassification: ClassificationType.REIMBURSEMENT },
    
    // COGS
    { name: 'Inventory', icon: '📦', defaultClassification: ClassificationType.COGS },
    { name: 'Raw Materials', icon: '🧱', defaultClassification: ClassificationType.COGS },
    { name: 'Shipping (Product)', icon: '🚚', defaultClassification: ClassificationType.COGS },
    
    // Operating Expenses
    { name: 'Rent', icon: '🏢', defaultClassification: ClassificationType.OPERATING },
    { name: 'Utilities', icon: '⚡', defaultClassification: ClassificationType.OPERATING },
    { name: 'Software & Tools', icon: '🔧', defaultClassification: ClassificationType.OPERATING },
    { name: 'Marketing', icon: '📣', defaultClassification: ClassificationType.OPERATING },
    { name: 'Professional Services', icon: '👔', defaultClassification: ClassificationType.OPERATING },
    { name: 'Office Supplies', icon: '📎', defaultClassification: ClassificationType.OPERATING },
    { name: 'Travel (Business)', icon: '✈️', defaultClassification: ClassificationType.OPERATING },
    
    // Personal
    { name: 'Groceries', icon: '🛒', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Dining Out', icon: '🍽️', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Entertainment', icon: '🎬', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Transportation', icon: '🚗', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Healthcare', icon: '🏥', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Shopping', icon: '🛍️', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Subscriptions', icon: '📱', defaultClassification: ClassificationType.PERSONAL },
    { name: 'Home', icon: '🏠', defaultClassification: ClassificationType.PERSONAL },
    
    // Transfer
    { name: 'Transfer', icon: '↔️', defaultClassification: ClassificationType.TRANSFER },
    
    // Uncategorized
    { name: 'Uncategorized', icon: '❓', defaultClassification: null },
  ];

  for (const cat of categories) {
    // Check if category exists (can't use upsert with nullable parentId in compound unique)
    const existing = await prisma.category.findFirst({
      where: { 
        userId: user.id, 
        name: cat.name, 
        parentId: null 
      } 
    });
    
    if (!existing) {
      await prisma.category.create({
        data: {
          userId: user.id,
          name: cat.name,
          icon: cat.icon,
          defaultClassification: cat.defaultClassification,
          isSystem: true,
        },
      });
    }
  }
  console.log('✅ Created default categories');

  // Create sample financial accounts
  const checkingAccount = await prisma.financialAccount.upsert({
    where: { id: 'demo-checking' },
    update: {},
    create: {
      id: 'demo-checking',
      userId: user.id,
      entityId: personalEntity.id,
      name: 'Main Checking',
      type: AccountType.CHECKING,
      institution: 'Demo Bank',
      accountNumber: '4567',
      currentBalance: 5432.10,
    },
  });

  const creditCard = await prisma.financialAccount.upsert({
    where: { id: 'demo-credit' },
    update: {},
    create: {
      id: 'demo-credit',
      userId: user.id,
      name: 'Credit Card',
      type: AccountType.CREDIT_CARD,
      institution: 'Demo Credit Union',
      accountNumber: '8901',
      currentBalance: -1234.56,
    },
  });

  const businessAccount = await prisma.financialAccount.upsert({
    where: { id: 'demo-business' },
    update: {},
    create: {
      id: 'demo-business',
      userId: user.id,
      entityId: businessEntity.id,
      name: 'Business Checking',
      type: AccountType.CHECKING,
      institution: 'Business Bank',
      accountNumber: '2345',
      currentBalance: 12500.00,
    },
  });
  console.log('✅ Created sample accounts');

  // Create sample transactions
  const groceryCat = await prisma.category.findFirst({ 
    where: { userId: user.id, name: 'Groceries' } 
  });
  const diningCat = await prisma.category.findFirst({ 
    where: { userId: user.id, name: 'Dining Out' } 
  });
  const salaryCat = await prisma.category.findFirst({ 
    where: { userId: user.id, name: 'Salary' } 
  });
  const softwareCat = await prisma.category.findFirst({ 
    where: { userId: user.id, name: 'Software & Tools' } 
  });

  const sampleTransactions = [
    {
      accountId: checkingAccount.id,
      amount: 3500.00,
      type: 'INCOME' as const,
      date: new Date('2026-01-01'),
      description: 'Payroll Deposit',
      merchantName: 'ACME Corp',
      categoryId: salaryCat?.id,
      classification: ClassificationType.INCOME,
      payerId: personalEntity.id,
      incurredById: personalEntity.id,
      externalId: 'demo-tx-1',
    },
    {
      accountId: checkingAccount.id,
      amount: -156.78,
      type: 'EXPENSE' as const,
      date: new Date('2026-01-02'),
      description: 'WHOLE FOODS MARKET #123',
      merchantName: 'Whole Foods',
      categoryId: groceryCat?.id,
      classification: ClassificationType.PERSONAL,
      payerId: personalEntity.id,
      incurredById: personalEntity.id,
      externalId: 'demo-tx-2',
    },
    {
      accountId: creditCard.id,
      amount: -45.50,
      type: 'EXPENSE' as const,
      date: new Date('2026-01-03'),
      description: 'RESTAURANT XYZ',
      merchantName: 'Restaurant XYZ',
      categoryId: diningCat?.id,
      classification: ClassificationType.PERSONAL,
      payerId: personalEntity.id,
      incurredById: personalEntity.id,
      externalId: 'demo-tx-3',
    },
    {
      accountId: businessAccount.id,
      amount: -99.00,
      type: 'EXPENSE' as const,
      date: new Date('2026-01-03'),
      description: 'GITHUB.COM',
      merchantName: 'GitHub',
      categoryId: softwareCat?.id,
      classification: ClassificationType.OPERATING,
      payerId: businessEntity.id,
      incurredById: businessEntity.id,
      externalId: 'demo-tx-4',
    },
  ];

  for (const tx of sampleTransactions) {
    await prisma.transaction.upsert({
      where: { accountId_externalId: { accountId: tx.accountId, externalId: tx.externalId! } },
      update: {},
      create: tx,
    });
  }
  console.log('✅ Created sample transactions');

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

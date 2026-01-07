# Local Budget - Setup Guide

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis (for background jobs)
- pnpm, npm, or yarn

### Setup

1. **Install dependencies:**
   ```bash
   cd "Local Budget"
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your database credentials:
   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5432/local_budget"
   NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"
   REDIS_URL="redis://localhost:6379"
   ```

3. **Initialize the database:**
   ```bash
   npm run db:generate    # Generate Prisma client
   npm run db:push        # Push schema to database
   npm run db:seed        # Seed with demo data
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open [http://localhost:3000](http://localhost:3000)**

### Optional: Start Background Workers
```bash
npm run worker
```

---

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/trpc/          # tRPC API endpoint
│   ├── accounts/          # Accounts page
│   ├── receipts/          # Receipts page
│   ├── reports/           # Reports page
│   ├── transactions/      # Transactions page
│   └── page.tsx           # Dashboard
├── components/
│   ├── dashboard/         # Dashboard components
│   ├── accounts/          # Account components
│   ├── receipts/          # Receipt components
│   ├── reports/           # Report components
│   ├── transactions/      # Transaction components
│   └── ui/                # Reusable UI components (shadcn/ui)
├── hooks/                 # React hooks
├── jobs/                  # Background job workers
│   ├── queues.ts         # Queue definitions
│   └── worker.ts         # Worker processes
├── lib/
│   ├── db.ts             # Prisma client
│   ├── schemas.ts        # Zod validation schemas
│   ├── trpc.tsx          # tRPC client provider
│   ├── types.ts          # TypeScript types
│   └── utils.ts          # Utility functions
└── server/
    └── api/
        ├── routers/       # tRPC routers by domain
        │   ├── accounts.ts
        │   ├── categories.ts
        │   ├── dashboard.ts
        │   ├── entities.ts
        │   ├── receipts.ts
        │   └── transactions.ts
        ├── root.ts        # Root router
        └── trpc.ts        # tRPC setup
prisma/
├── schema.prisma          # Database schema
└── seed.ts               # Seed script
```

---

## 🏗️ Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React 18 |
| Styling | Tailwind CSS, shadcn/ui |
| Database | PostgreSQL with Prisma ORM |
| API | tRPC (type-safe end-to-end) |
| State | TanStack Query (React Query) |
| Background Jobs | BullMQ + Redis |
| Charts | Recharts |

### Core Domains

1. **Entities** - People, Businesses, Projects (who owns/incurs expenses)
2. **Financial Accounts** - Bank, Credit, Cash accounts with Plaid integration
3. **Transactions** - All financial events with classification
4. **Categories** - Hierarchical spending categories
5. **Receipts** - Evidence with OCR and transaction linking
6. **Classification Rules** - Automated categorization

### Data Model Highlights

- **Intent Modeling**: Transactions track both `payer` (who paid) and `incurredBy` (who the expense is for)
- **Classification Types**: COGS, Operating, Personal, Income, Transfer, Reimbursable
- **Evidence First**: Receipts are first-class objects that link to transactions
- **Flexible Linking**: Many-to-many relationships between receipts and transactions

---

## 🛠️ Development

### Available Scripts

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

# Database
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema changes
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed database

# Background Jobs
npm run worker       # Start job workers
```

### Adding New Features

1. **Database Changes**: Update `prisma/schema.prisma`, run `db:push`
2. **API Endpoints**: Add router in `src/server/api/routers/`
3. **UI Components**: Add in `src/components/`
4. **Pages**: Add in `src/app/`

---

## 🚢 Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Add environment variables
4. Deploy!

### Environment Variables for Production

```env
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://your-domain.com
REDIS_URL=redis://...
```

---

## 📋 Implementation Roadmap

### Phase 1 — Aggregation & Visibility ✅
- [x] Database schema
- [x] Basic UI components
- [x] Transaction list with filters
- [x] Dashboard with cashflow
- [x] Account management
- [ ] Manual transaction entry
- [ ] Plaid bank sync integration

### Phase 2 — Evidence & Structure
- [x] Receipt data model
- [x] Receipt list UI
- [ ] Receipt upload (file + camera)
- [ ] OCR integration
- [ ] Receipt ↔ Transaction linking

### Phase 3 — Intent Modeling
- [x] Entity system (Person/Business/Project)
- [x] Classification types
- [ ] Reimbursement workflows
- [ ] Split transactions
- [ ] Clean P&L reports

### Phase 4 — Automation & Assistance
- [x] Rules engine schema
- [ ] Rules UI
- [ ] ML-based suggestions
- [ ] Embedded chat agent
- [ ] Exception workflows

### Phase 5 — Margin Intelligence
- [ ] COGS rollups
- [ ] Vendor spend analysis
- [ ] Item-level costing
- [ ] Trend analysis

---

## 🔧 Demo Credentials

After running `npm run db:seed`:

- **Email**: demo@localbudget.app
- **Password**: demo123

---

## 📄 License

MIT

---

Built with ❤️ for people whose money doesn't fit cleanly into existing tools.

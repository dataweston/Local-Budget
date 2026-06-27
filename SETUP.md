# Local Budget - Setup Guide

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- pnpm, npm, or yarn

### Setup

1. **Install dependencies:**
   ```bash
   cd "Local Budget"
   npm install
   ```

2. **Set up environment variables:**

   Create a `.env` file with your credentials:
   ```env
   # Use the pooled and direct URLs from Prisma Console.
   DATABASE_URL="postgres://USER:PASSWORD@pooled.db.prisma.io:5432/postgres?sslmode=require"
   DIRECT_URL="postgres://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require"
   NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"
   NEXTAUTH_URL="http://localhost:3000"

   # Plaid
   PLAID_CLIENT_ID="your-plaid-client-id"
   PLAID_SECRET="your-plaid-secret"
   PLAID_ENV="sandbox"

   # Square
   SQUARE_APPLICATION_ID="your-square-app-id"
   SQUARE_APPLICATION_SECRET="your-square-app-secret"
   SQUARE_ENV="sandbox"
   NEXT_PUBLIC_SQUARE_APPLICATION_ID="your-square-app-id"

   # File Storage
   UPLOAD_DIR="./uploads"
   ```

3. **Initialize the database from committed migrations:**
   ```bash
   npm run db:generate    # Generate Prisma client
   npm run db:deploy      # Apply committed migrations
   npm run db:status      # Verify migration state
   npm run db:seed        # Optional; development/demo databases only
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open [http://localhost:3000](http://localhost:3000)**

---

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes (tRPC, auth, Plaid, Square, receipts)
│   ├── accounts/           # Accounts page + Square callback
│   ├── categories/         # Category management
│   ├── entities/           # Entity management
│   ├── receipts/           # Receipts page
│   ├── reports/            # Reports (P&L, category, entity)
│   ├── rules/              # Classification rules
│   ├── transactions/       # Transactions page
│   ├── login/              # Login page
│   ├── register/           # Registration page
│   └── page.tsx            # Dashboard
├── components/
│   ├── dashboard/          # Dashboard components (stats, charts, header)
│   ├── accounts/           # Account components (Plaid, Square, modals)
│   ├── receipts/           # Receipt components (upload, list)
│   ├── reports/            # Report components
│   ├── transactions/       # Transaction components (list, filters, modals)
│   └── ui/                 # Reusable UI components (shadcn/ui)
├── hooks/                  # React hooks
├── lib/
│   ├── auth.ts            # NextAuth configuration
│   ├── db.ts              # Prisma client
│   ├── ocr.ts             # Tesseract.js receipt OCR
│   ├── plaid.ts           # Plaid API client
│   ├── schemas.ts         # Zod validation schemas
│   ├── square.ts          # Square API client
│   ├── trpc.tsx           # tRPC client provider
│   ├── types.ts           # TypeScript types
│   └── utils.ts           # Utility functions
└── server/
    └── api/
        ├── routers/        # tRPC routers by domain
        │   ├── accounts.ts
        │   ├── categories.ts
        │   ├── dashboard.ts
        │   ├── entities.ts
        │   ├── receipts.ts
        │   ├── rules.ts
        │   └── transactions.ts
        ├── root.ts         # Root router
        └── trpc.ts         # tRPC setup
prisma/
├── schema.prisma           # Database schema
└── seed.ts                # Seed script
```

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React 18 |
| Styling | Tailwind CSS, shadcn/ui |
| Database | PostgreSQL with Prisma ORM |
| API | tRPC (type-safe end-to-end) |
| State | TanStack Query (React Query) |
| Charts | Recharts |
| OCR | Tesseract.js |
| Banking | Plaid, Square |

---

## Available Scripts

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

# Database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Create/apply a migration in development
npm run db:deploy    # Apply committed migrations
npm run db:status    # Check migration state
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed database
```

---

## Deployment

See [Database operations](docs/database-operations.md) for Prisma Postgres
provisioning, production baselining, and sharing the database with another
repository.

### Vercel (Recommended)

1. Push to GitHub
2. Connect repo to Vercel
3. Add environment variables
4. Deploy!

### Environment Variables for Production

```env
DATABASE_URL=postgres://...@pooled.db.prisma.io:5432/postgres?sslmode=require
DIRECT_URL=postgres://...@db.prisma.io:5432/postgres?sslmode=require
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://your-domain.com
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=production
SQUARE_APPLICATION_ID=...
SQUARE_APPLICATION_SECRET=...
SQUARE_ENV=production
```

---

## Demo Credentials

After running `npm run db:seed`:

- **Email**: demo@localbudget.app
- **Password**: demo123

---

## License

MIT

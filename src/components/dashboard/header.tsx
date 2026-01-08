'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  Wallet,
  Receipt,
  BarChart3,
  Settings,
  Plus,
  Bell,
  Search,
  Menu,
  LogOut,
  User,
  Tags,
  Building2,
  ChevronDown,
  Wand2,
  CreditCard,
  FileText,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Header() {
  const { data: session } = useSession();
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const router = useRouter();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Wallet className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold">Local Budget</span>
        </div>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            href="/"
            className="text-sm font-medium text-foreground transition-colors hover:text-primary"
          >
            Dashboard
          </Link>
          <Link
            href="/transactions"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Transactions
          </Link>
          <Link
            href="/accounts"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Accounts
          </Link>
          <Link
            href="/receipts"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <span className="flex items-center gap-1">
              Receipts
              <Receipt className="h-4 w-4" />
            </span>
          </Link>
          <Link
            href="/reports"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <span className="flex items-center gap-1">
              Reports
              <BarChart3 className="h-4 w-4" />
            </span>
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="hidden md:flex relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search transactions..."
              className="w-64 pl-8"
            />
          </div>

          {/* Quick Add */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Quick Add</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/transactions')}>
                <DollarSign className="h-4 w-4 mr-2" />
                Transaction
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/accounts')}>
                <CreditCard className="h-4 w-4 mr-2" />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/receipts')}>
                <FileText className="h-4 w-4 mr-2" />
                Receipt
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground flex items-center justify-center">
                  3
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/transactions')}>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Unreviewed Transactions</span>
                  <span className="text-xs text-muted-foreground">You have transactions that need review</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/receipts')}>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Pending Receipts</span>
                  <span className="text-xs text-muted-foreground">Receipts waiting to be processed</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/accounts')}>
                <span className="text-sm text-muted-foreground">Sync your accounts for latest data</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Settings Dropdown */}
          <div className="relative">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setShowSettingsMenu(!showSettingsMenu)}
            >
              <Settings className="h-5 w-5" />
            </Button>
            {showSettingsMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowSettingsMenu(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 rounded-md border bg-popover p-1 shadow-md z-50">
                  <div className="px-2 py-1.5 text-sm font-medium text-muted-foreground border-b mb-1">
                    {session?.user?.name || session?.user?.email}
                  </div>
                  <Link
                    href="/entities"
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Building2 className="h-4 w-4" />
                    Entities
                  </Link>
                  <Link
                    href="/categories"
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Tags className="h-4 w-4" />
                    Categories
                  </Link>
                  <Link
                    href="/rules"
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                    onClick={() => setShowSettingsMenu(false)}
                  >
                    <Wand2 className="h-4 w-4" />
                    Rules
                  </Link>
                  <div className="border-t mt-1 pt-1">
                    <button
                      onClick={() => signOut({ callbackUrl: '/login' })}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Mobile Menu */}
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

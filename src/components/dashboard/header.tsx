'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { api } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
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
  Home,
  ArrowUpRight,
  ArrowDownRight,
  Store,
  ClipboardCheck,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';

export function Header() {
  const { data: session } = useSession();
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Dynamic notification counts
  const { data: stats } = api.dashboard.stats.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const notificationCount = (stats?.pendingReceipts ?? 0) + (stats?.unreviewedTransactions ?? 0);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: searchResults } = api.transactions.list.useQuery(
    { search: debouncedSearch, limit: 5, page: 1 },
    { enabled: debouncedSearch.length >= 2 }
  );

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchOpen(false);
    } else if (e.key === 'Enter' && searchQuery.length >= 2) {
      setSearchOpen(false);
      router.push(`/transactions?search=${encodeURIComponent(searchQuery)}`);
    }
  }, [searchQuery, router]);

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
          <Link
            href="/vendors"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Vendors
          </Link>
          <Link
            href="/review"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <span className="flex items-center gap-1">
              Review
              <ClipboardCheck className="h-4 w-4" />
            </span>
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="hidden md:flex relative" ref={searchRef}>
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search transactions..."
              className="w-64 pl-8"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(e.target.value.length >= 2);
              }}
              onFocus={() => {
                if (searchQuery.length >= 2) setSearchOpen(true);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            {searchOpen && searchResults?.data && searchResults.data.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md z-50 max-h-80 overflow-y-auto">
                {searchResults.data.map((tx) => {
                  const amount = Number(tx.amount);
                  const isIncome = tx.type === 'INCOME';
                  return (
                    <button
                      key={tx.id}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                      onClick={() => {
                        setSearchOpen(false);
                        router.push(`/transactions?search=${encodeURIComponent(searchQuery)}`);
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isIncome ? (
                          <ArrowUpRight className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5 text-red-600 shrink-0" />
                        )}
                        <span className="truncate">{tx.merchantName || tx.description}</span>
                      </div>
                      <span className={isIncome ? 'text-green-600 font-medium ml-2 shrink-0' : 'text-red-600 font-medium ml-2 shrink-0'}>
                        {isIncome ? '+' : '-'}{formatCurrency(Math.abs(amount))}
                      </span>
                    </button>
                  );
                })}
                <button
                  className="w-full px-3 py-2 text-sm text-primary hover:bg-accent text-center border-t"
                  onClick={() => {
                    setSearchOpen(false);
                    router.push(`/transactions?search=${encodeURIComponent(searchQuery)}`);
                  }}
                >
                  View all results ({searchResults.pagination.total})
                </button>
              </div>
            )}
            {searchOpen && debouncedSearch.length >= 2 && searchResults?.data?.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-md z-50 p-3 text-sm text-muted-foreground text-center">
                No transactions found
              </div>
            )}
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
                {notificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground flex items-center justify-center">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(stats?.unreviewedTransactions ?? 0) > 0 && (
                <DropdownMenuItem onClick={() => router.push('/review')}>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{stats!.unreviewedTransactions} Unreviewed Transaction{stats!.unreviewedTransactions !== 1 ? 's' : ''}</span>
                    <span className="text-xs text-muted-foreground">Transactions that need review</span>
                  </div>
                </DropdownMenuItem>
              )}
              {(stats?.pendingReceipts ?? 0) > 0 && (
                <DropdownMenuItem onClick={() => router.push('/receipts')}>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{stats!.pendingReceipts} Pending Receipt{stats!.pendingReceipts !== 1 ? 's' : ''}</span>
                    <span className="text-xs text-muted-foreground">Receipts waiting to be processed</span>
                  </div>
                </DropdownMenuItem>
              )}
              {notificationCount === 0 && (
                <DropdownMenuItem disabled>
                  <span className="text-sm text-muted-foreground">No notifications</span>
                </DropdownMenuItem>
              )}
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
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-primary" />
                  Local Budget
                </SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-4 mt-6">
                {/* Navigation Links */}
                <div className="flex flex-col gap-2">
                  <Link
                    href="/"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <Home className="h-5 w-5" />
                    <span>Dashboard</span>
                  </Link>
                  <Link
                    href="/transactions"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <DollarSign className="h-5 w-5" />
                    <span>Transactions</span>
                  </Link>
                  <Link
                    href="/accounts"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <CreditCard className="h-5 w-5" />
                    <span>Accounts</span>
                  </Link>
                  <Link
                    href="/receipts"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <Receipt className="h-5 w-5" />
                    <span>Receipts</span>
                  </Link>
                  <Link
                    href="/reports"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <BarChart3 className="h-5 w-5" />
                    <span>Reports</span>
                  </Link>
                  <Link
                    href="/vendors"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <Store className="h-5 w-5" />
                    <span>Vendors</span>
                  </Link>
                  <Link
                    href="/review"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <ClipboardCheck className="h-5 w-5" />
                    <span>Review</span>
                  </Link>
                </div>

                <Separator />

                {/* Settings Links */}
                <div className="flex flex-col gap-2">
                  <Link
                    href="/entities"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <Building2 className="h-5 w-5" />
                    <span>Entities</span>
                  </Link>
                  <Link
                    href="/categories"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <Tags className="h-5 w-5" />
                    <span>Categories</span>
                  </Link>
                  <Link
                    href="/rules"
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent"
                  >
                    <Wand2 className="h-5 w-5" />
                    <span>Rules</span>
                  </Link>
                </div>

                <Separator />

                {/* User Info and Sign Out */}
                <div className="flex flex-col gap-2 mt-auto">
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">
                      {session?.user?.name || 'User'}
                    </div>
                    <div className="text-xs">{session?.user?.email}</div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      signOut({ callbackUrl: '/login' });
                    }}
                    className="justify-start text-destructive hover:text-destructive"
                  >
                    <LogOut className="h-5 w-5 mr-3" />
                    Sign Out
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

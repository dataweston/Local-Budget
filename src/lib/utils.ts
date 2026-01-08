import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Decimal } from '@prisma/client/runtime/library';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Convert Prisma Decimal, number, or string to a plain number
 */
export function toNumber(value: Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return parseFloat(value) || 0;
  // Prisma Decimal type
  return Number(value);
}

export function formatCurrency(
  amount: Decimal | number | string | null | undefined,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  const numAmount = toNumber(amount);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(numAmount);
}

export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', options).format(dateObj);
}

export function formatRelativeDate(date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffInMs = now.getTime() - dateObj.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
  return `${Math.floor(diffInDays / 365)} years ago`;
}

export function classificationColor(classification: string | null): string {
  switch (classification) {
    case 'INCOME':
      return 'text-green-600 bg-green-50';
    case 'COGS':
      return 'text-orange-600 bg-orange-50';
    case 'OPERATING':
      return 'text-blue-600 bg-blue-50';
    case 'PERSONAL':
      return 'text-purple-600 bg-purple-50';
    case 'TRANSFER':
      return 'text-gray-600 bg-gray-50';
    case 'REIMBURSABLE':
      return 'text-yellow-600 bg-yellow-50';
    case 'REIMBURSEMENT':
      return 'text-teal-600 bg-teal-50';
    default:
      return 'text-gray-500 bg-gray-50';
  }
}

export function transactionTypeColor(type: string): string {
  switch (type) {
    case 'INCOME':
      return 'text-green-600';
    case 'EXPENSE':
      return 'text-red-600';
    case 'TRANSFER':
      return 'text-gray-600';
    default:
      return 'text-gray-600';
  }
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

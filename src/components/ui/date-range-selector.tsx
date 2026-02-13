'use client';

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

export type PeriodPreset =
  | 'this-month'
  | 'last-month'
  | 'last-3-months'
  | 'last-6-months'
  | 'calendar-year'
  | 'ytd'
  | 'last-12-months'
  | 'all-time'
  | 'custom';

export interface DateRange {
  startDate: Date;
  endDate: Date;
  label: string;
}

const PRESET_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'last-6-months', label: 'Last 6 Months' },
  { value: 'calendar-year', label: 'Calendar Year' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'last-12-months', label: 'Last 12 Months' },
  { value: 'all-time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

interface PresetOptions {
  year?: number;
}

export function getDateRangeForPreset(
  preset: PeriodPreset,
  options?: PresetOptions
): DateRange {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (preset) {
    case 'this-month':
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1),
        endDate: endOfToday,
        label: 'This Month',
      };
    case 'last-month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { startDate: start, endDate: end, label: 'Last Month' };
    }
    case 'last-3-months':
      return {
        startDate: new Date(now.getFullYear(), now.getMonth() - 2, 1),
        endDate: endOfToday,
        label: 'Last 3 Months',
      };
    case 'last-6-months':
      return {
        startDate: new Date(now.getFullYear(), now.getMonth() - 5, 1),
        endDate: endOfToday,
        label: 'Last 6 Months',
      };
    case 'calendar-year': {
      const year = options?.year ?? now.getFullYear();
      return {
        startDate: new Date(year, 0, 1),
        endDate: new Date(year, 11, 31, 23, 59, 59, 999),
        label: `All of ${year}`,
      };
    }
    case 'ytd':
      return {
        startDate: new Date(now.getFullYear(), 0, 1),
        endDate: endOfToday,
        label: 'Year to Date',
      };
    case 'last-12-months':
      return {
        startDate: new Date(now.getFullYear() - 1, now.getMonth(), 1),
        endDate: endOfToday,
        label: 'Last 12 Months',
      };
    case 'all-time':
      return {
        startDate: new Date(2000, 0, 1),
        endDate: endOfToday,
        label: 'All Time',
      };
    default:
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), 1),
        endDate: endOfToday,
        label: 'Custom',
      };
  }
}

interface DateRangeSelectorProps {
  value: PeriodPreset;
  onChange: (preset: PeriodPreset) => void;
  yearValue?: number;
  onYearChange?: (year: number) => void;
  customStart?: string;
  customEnd?: string;
  onCustomStartChange?: (val: string) => void;
  onCustomEndChange?: (val: string) => void;
  className?: string;
}

export function DateRangeSelector({
  value,
  onChange,
  yearValue,
  onYearChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  className,
}: DateRangeSelectorProps) {
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear; y >= currentYear - 10; y--) {
      years.push(y);
    }
    return years;
  }, []);

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <Select value={value} onValueChange={(v) => onChange(v as PeriodPreset)}>
        <SelectTrigger className="w-[180px] h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESET_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value === 'calendar-year' && (
        <Select
          value={String(yearValue ?? new Date().getFullYear())}
          onValueChange={(v) => onYearChange?.(parseInt(v, 10))}
        >
          <SelectTrigger className="w-[130px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {value === 'custom' && (
        <>
          <Input
            type="date"
            className="h-9 w-[140px]"
            value={customStart ?? ''}
            onChange={(e) => onCustomStartChange?.(e.target.value)}
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            className="h-9 w-[140px]"
            value={customEnd ?? ''}
            onChange={(e) => onCustomEndChange?.(e.target.value)}
          />
        </>
      )}
    </div>
  );
}

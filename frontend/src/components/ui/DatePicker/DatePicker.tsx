import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useMemo, useState } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './DatePicker.css';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse 'YYYY-MM-DD' as a local calendar date (no timezone shift). */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDisplayDate(value: string | null | undefined): string {
  const d = parseIsoDate(value);
  if (!d) return '';
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()}`;
}

function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(year, month, 1 - offset);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export interface DatePickerProps {
  /** ISO date 'YYYY-MM-DD' or empty. */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Visual warning state (e.g. overdue). */
  error?: boolean;
  min?: string | null;
  max?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Calendar date picker: a field-style trigger that opens a month grid popover
 * with Today / Clear shortcuts. Replaces the browser-native date input so the
 * look and behaviour are consistent across the app.
 */
export function DatePicker({
  value,
  onChange,
  ariaLabel,
  placeholder = 'Pick a date',
  disabled = false,
  clearable = true,
  error = false,
  min,
  max,
  size = 'md',
  className,
}: DatePickerProps) {
  const selected = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = selected ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const days = useMemo(() => buildMonthGrid(view.year, view.month), [view]);
  const todayIso = toIsoDate(new Date());
  const selectedIso = selected ? toIsoDate(selected) : null;

  const isDisabledDay = (iso: string) => (min ? iso < min : false) || (max ? iso > max : false);

  const shiftMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const pick = (iso: string | null) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        if (next) {
          const base = parseIsoDate(value) ?? new Date();
          setView({ year: base.getFullYear(), month: base.getMonth() });
        }
        setOpen(next);
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          data-ui="date-picker"
          data-size={size}
          data-error={error ? 'true' : undefined}
          data-empty={selected ? undefined : 'true'}
          className={cn('org-datepicker__trigger', className)}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="calendar" size="sm" />
          <span className="org-datepicker__value">
            {selected ? formatDisplayDate(value) : placeholder}
          </span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="org-datepicker__popup"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="org-datepicker__head">
            <button
              type="button"
              className="org-datepicker__nav"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <Icon name="chevron-left" size="sm" />
            </button>
            <span className="org-datepicker__month">
              {MONTHS[view.month]} {view.year}
            </span>
            <button
              type="button"
              className="org-datepicker__nav"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <Icon name="chevron-right" size="sm" />
            </button>
          </div>
          <div
            className="org-datepicker__grid"
            role="grid"
            aria-label={`${MONTHS[view.month]} ${view.year}`}
          >
            {WEEKDAYS.map((w) => (
              <span key={w} className="org-datepicker__wd" role="columnheader">
                {w}
              </span>
            ))}
            {days.map((d) => {
              const iso = toIsoDate(d);
              const outside = d.getMonth() !== view.month;
              const dis = isDisabledDay(iso);
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  disabled={dis}
                  aria-selected={iso === selectedIso}
                  aria-label={formatDisplayDate(iso)}
                  data-outside={outside ? 'true' : undefined}
                  data-today={iso === todayIso ? 'true' : undefined}
                  data-selected={iso === selectedIso ? 'true' : undefined}
                  data-weekend={d.getDay() === 0 || d.getDay() === 6 ? 'true' : undefined}
                  className="org-datepicker__day"
                  onClick={() => pick(iso)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="org-datepicker__foot">
            <button
              type="button"
              className="org-datepicker__link"
              disabled={isDisabledDay(todayIso)}
              onClick={() => pick(todayIso)}
            >
              Today
            </button>
            {clearable && (
              <button
                type="button"
                className="org-datepicker__link"
                disabled={!selected}
                onClick={() => pick(null)}
              >
                Clear
              </button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

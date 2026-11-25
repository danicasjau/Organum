import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: ReadonlyArray<SelectOption>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  filterable?: boolean;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  ariaLabel?: string;
  className?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  filterable = true,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
  ariaLabel = 'Select option',
  className,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const handleOpenChange = (next: boolean) => {
    if (disabled) return;
    setOpen(next);
    if (next) {
      setQuery('');
      const idx = options.findIndex((o) => o.value === value);
      setActiveIdx(idx >= 0 ? idx : 0);
    }
  };

  const commitIdx = (idx: number) => {
    const opt = filtered[idx];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitIdx(activeIdx);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          data-ui="select"
          data-error={error ? 'true' : undefined}
          data-dirty={dirty ? 'true' : undefined}
          data-force-state={forceState}
          className={cn('org-select', className)}
        >
          <span className="org-select__value">{selected ? selected.label : placeholder}</span>
          <Icon name="chevron-down" size="sm" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={2}
          className="org-select__popup"
          onKeyDown={onKeyDown}
        >
          {filterable && (
            <div className="org-select__search">
              <input
                type="text"
                autoFocus
                value={query}
                placeholder="Filter..."
                aria-label="Filter options"
                className="org-select__filter-input"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIdx(0);
                }}
              />
            </div>
          )}
          <div role="listbox" className="org-select__list">
            {filtered.length === 0 ? (
              <div className="org-select__empty">No matches</div>
            ) : (
              filtered.map((opt, idx) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={opt.value === value}
                  disabled={opt.disabled}
                  data-selected={opt.value === value ? 'true' : undefined}
                  data-active={idx === activeIdx ? 'true' : undefined}
                  className="org-select__option"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => commitIdx(idx)}
                >
                  <span className="org-select__check">
                    {opt.value === value ? <Icon name="check" size="sm" /> : null}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}


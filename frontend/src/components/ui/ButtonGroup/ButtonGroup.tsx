import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './ButtonGroup.css';

export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ButtonGroup({ className, children, ...rest }: ButtonGroupProps) {
  return (
    <div data-ui="button-group" role="group" className={cn('org-btn-group', className)} {...rest}>
      {children}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  disabled = false,
}: SegmentedControlProps<T>) {
  const handleKeyDown = (idx: number, e: KeyboardEvent<HTMLButtonElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    if (!enabled.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (idx + 1) % options.length;
      const opt = options[next];
      if (opt && !opt.disabled) onChange(opt.value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (idx - 1 + options.length) % options.length;
      const opt = options[prev];
      if (opt && !opt.disabled) onChange(opt.value);
    }
  };

  return (
    <div
      data-ui="segmented-control"
      data-size={size}
      role="radiogroup"
      aria-label={ariaLabel}
      className="org-segmented"
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        const isDisabled = disabled || Boolean(opt.disabled);
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={opt.title}
            disabled={isDisabled}
            data-selected={selected ? 'true' : undefined}
            className="org-segmented__item"
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}


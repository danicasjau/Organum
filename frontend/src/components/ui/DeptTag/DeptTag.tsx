import { useRef, type RefObject } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import './DeptTag.css';

/**
 * Department marker: a colored swatch + label. `color` is any CSS color value
 * (typically `var(--series-n)` or a hex picked in Settings).
 */
export function DeptTag({
  color,
  label,
  variant = 'tag',
  className,
}: {
  color: string;
  label: string;
  variant?: 'tag' | 'text' | 'swatch';
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVarRef(ref, '--dept-color', color);
  return (
    <span
      ref={ref}
      data-ui="dept-tag"
      data-variant={variant}
      title={label}
      className={cn('org-dept-tag', className)}
    >
      <span className="org-dept-tag__swatch" aria-hidden="true" />
      {variant !== 'swatch' && <span className="org-dept-tag__label">{label}</span>}
    </span>
  );
}

/** Imperative helper to paint an arbitrary element with a department color var. */
export function useDeptColorVar(
  ref: RefObject<HTMLElement | null>,
  color: string | undefined,
): void {
  useCssVarRef(ref, '--dept-color', color);
}

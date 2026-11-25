import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './Badge.css';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span data-ui="badge" data-tone={tone} className={cn('org-badge', className)}>
      {children}
    </span>
  );
}

export function Tag({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span data-ui="tag" data-tone={tone} className={cn('org-tag', className)}>
      {children}
    </span>
  );
}

export function StatusDot({
  tone = 'neutral',
  label,
  className,
}: {
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-ui="status-dot"
      data-tone={tone}
      role={label ? 'status' : undefined}
      aria-label={label}
      title={label}
      className={cn('org-status-dot', className)}
    />
  );
}


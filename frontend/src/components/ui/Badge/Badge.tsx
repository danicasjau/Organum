import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { PriorityFlag, toPriorityLevel, type PriorityLevel } from '../PriorityFlag/PriorityFlag';
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
  priority,
  children,
  className,
}: {
  tone?: Tone;
  /** v1 priority variant: renders the coloured flag + label (children optional). */
  priority?: PriorityLevel | string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-ui="tag"
      data-tone={tone}
      data-priority={priority !== undefined ? toPriorityLevel(priority) : undefined}
      className={cn('org-tag', className)}
    >
      {priority !== undefined ? <PriorityFlag priority={priority} /> : null}
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


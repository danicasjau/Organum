import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './Typography.css';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  dirty?: boolean;
  muted?: boolean;
  disabled?: boolean;
}

export function Label({ dirty, muted, disabled, className, children, ...rest }: LabelProps) {
  return (
    <label
      data-ui="label"
      data-dirty={dirty ? 'true' : undefined}
      data-muted={muted ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      className={cn('org-label', className)}
      {...rest}
    >
      {children}
    </label>
  );
}

export interface TextProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'muted' | 'accent' | 'danger' | 'success' | 'mono';
  size?: 'sm' | 'md' | 'lg';
  truncate?: boolean;
}

export function Text({
  variant = 'default',
  size = 'md',
  truncate,
  className,
  children,
  ...rest
}: TextProps) {
  return (
    <span
      data-ui="text"
      data-variant={variant}
      data-size={size}
      data-truncate={truncate ? 'true' : undefined}
      className={cn('org-text', className)}
      {...rest}
    >
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd data-ui="kbd" className={cn('org-kbd', className)}>
      {children}
    </kbd>
  );
}

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <div
      data-ui="separator"
      role="separator"
      aria-orientation={orientation}
      data-orientation={orientation}
      className={cn('org-separator', className)}
    />
  );
}


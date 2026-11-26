import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './Button.css';

export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'danger'
  | 'ghost'
  | 'toolbar'
  | 'icon'
  | 'toggle'
  /* v1 accent variants (raised face + 2px bottom accent line) */
  | 'production'
  | 'management'
  | 'settings'
  | 'destructive'
  /* permanently pressed key */
  | 'sunk'
  /* review actions: the one filled button, and the four status keys */
  | 'send'
  | 'approve'
  | 'changes'
  | 'reject'
  | 'hold';

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  error?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  forceState?: 'hover' | 'pressed' | 'focus';
}

export function Button({
  variant = 'default',
  size = 'md',
  pressed,
  error,
  iconLeft,
  iconRight,
  forceState,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const isToggle = variant === 'toggle' || pressed !== undefined;

  return (
    <button
      type={type}
      data-ui="button"
      data-variant={variant}
      data-size={size}
      data-selected={pressed ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      data-force-state={forceState}
      aria-pressed={isToggle ? Boolean(pressed) : undefined}
      className={cn('org-btn', className)}
      {...rest}
    >
      {iconLeft}
      {children && <span className="org-btn__label">{children}</span>}
      {iconRight}
    </button>
  );
}


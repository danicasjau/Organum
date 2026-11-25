import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './Toolbar.css';

export function Toolbar({
  children,
  className,
  ariaLabel = 'Toolbar',
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div data-ui="toolbar" role="toolbar" aria-label={ariaLabel} className={cn('org-toolbar', className)}>
      {children}
    </div>
  );
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="org-toolbar__group">{children}</div>;
}

export function ToolStrip({
  children,
  className,
  ariaLabel = 'Tool strip',
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      data-ui="tool-strip"
      role="toolbar"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className={cn('org-toolstrip', className)}
    >
      {children}
    </div>
  );
}

export function Topbar({
  left,
  right,
  className,
}: {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header data-ui="topbar" className={cn('org-topbar', className)}>
      <div className="org-topbar__left">{left}</div>
      {right && <div className="org-topbar__right">{right}</div>}
    </header>
  );
}

export function BrandWordmark({ label = 'ORGANUM' }: { label?: string }) {
  return (
    <span data-ui="brand-wordmark" className="org-wordmark">
      {label}
    </span>
  );
}

export function StatusBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <footer data-ui="status-bar" role="status" className={cn('org-statusbar', className)}>
      {children}
    </footer>
  );
}

export function StatusBarSegment({
  children,
  grow = false,
  mono = false,
}: {
  children: ReactNode;
  grow?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      data-grow={grow ? 'true' : undefined}
      data-mono={mono ? 'true' : undefined}
      className="org-statusbar__seg"
    >
      {children}
    </div>
  );
}


import { useState, type ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './Panel.css';

export interface PanelProps {
  title?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({
  title,
  collapsible = false,
  defaultOpen = true,
  headerRight,
  children,
  className,
}: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section data-ui="panel" className={cn('org-panel', className)}>
      {title && (
        <header className="org-panel__header">
          {collapsible ? (
            <button
              type="button"
              className="org-panel__toggle"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
              <span className="org-panel__title">{title}</span>
            </button>
          ) : (
            <span className="org-panel__title">{title}</span>
          )}
          {headerRight && <div className="org-panel__actions">{headerRight}</div>}
        </header>
      )}
      {open && (
        <div data-ui-slot="panel-body" className="org-panel__body">
          {children}
        </div>
      )}
    </section>
  );
}

export interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-ui="collapsible-section" className={cn('org-section', className)}>
      <button
        type="button"
        className="org-section__trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
        <span>{title}</span>
      </button>
      {open && <div className="org-section__content">{children}</div>}
    </div>
  );
}


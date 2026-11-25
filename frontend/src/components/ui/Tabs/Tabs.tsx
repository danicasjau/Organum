import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: string;
  closable?: boolean;
  disabled?: boolean;
  content: ReactNode;
}

export interface TabsProps {
  items: ReadonlyArray<TabItem>;
  activeId: string;
  onChange: (id: string) => void;
  onClose?: (id: string) => void;
  className?: string;
}

export function Tabs({ items, activeId, onChange, onClose, className }: TabsProps) {
  const active = items.find((i) => i.id === activeId) ?? items[0];

  const handleKeyDown = (idx: number, e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = items[(idx + 1) % items.length];
      if (next && !next.disabled) onChange(next.id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = items[(idx - 1 + items.length) % items.length];
      if (prev && !prev.disabled) onChange(prev.id);
    }
  };

  return (
    <div data-ui="tabs" className={cn('org-tabs', className)}>
      <div role="tablist" className="org-tabs__list">
        {items.map((item, idx) => {
          const selected = item.id === active?.id;
          return (
            <div key={item.id} className="org-tabs__tab-wrap" data-selected={selected ? 'true' : undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={item.disabled}
                className="org-tabs__tab"
                onClick={() => onChange(item.id)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
              >
                <span>{item.label}</span>
              </button>
              {item.closable && onClose && (
                <button
                  type="button"
                  aria-label={`Close ${item.label}`}
                  className="org-tabs__close"
                  onClick={() => onClose(item.id)}
                >
                  <Icon name="close" size="sm" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div role="tabpanel" className="org-tabs__panel">
        {active?.content}
      </div>
    </div>
  );
}


import { cn } from '../_internal/cn';
import './ViewSwitcher.css';

export interface ViewSwitcherItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface ViewSwitcherProps {
  items: ReadonlyArray<ViewSwitcherItem>;
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function ViewSwitcher({
  items,
  activeId,
  onChange,
  ariaLabel = 'View mode switcher',
  className,
}: ViewSwitcherProps) {
  return (
    <div
      data-ui="view-switcher"
      role="tablist"
      aria-label={ariaLabel}
      className={cn('org-viewswitch', className)}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            data-active={active ? 'true' : undefined}
            className="org-viewswitch__tab"
            onClick={() => onChange(item.id)}
          >
            <span>{item.label}</span>
            {item.count !== undefined && (
              <span className="org-viewswitch__count">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}


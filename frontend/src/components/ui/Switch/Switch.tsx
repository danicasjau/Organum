import { cn } from '../_internal/cn';
import './Switch.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  ariaLabel?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
  ariaLabel,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      data-ui="switch"
      data-checked={checked ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      data-force-state={forceState}
      className={cn('org-switch', className)}
      onClick={() => onChange(!checked)}
    >
      <span className="org-switch__track" aria-hidden="true">
        <span className="org-switch__thumb" />
      </span>
      {label && <span className="org-switch__label">{label}</span>}
    </button>
  );
}


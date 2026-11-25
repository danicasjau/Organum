import { useId } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './Checkbox.css';

export interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  className?: string;
  ariaLabel?: string;
}

export function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  label,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
  className,
  ariaLabel,
}: CheckboxProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      data-ui="checkbox"
      data-disabled={disabled ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      data-force-state={forceState}
      className={cn('org-checkbox', className)}
    >
      <input
        id={id}
        type="checkbox"
        className="org-checkbox__input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="org-checkbox__box" aria-hidden="true">
        {indeterminate ? (
          <Icon name="minus" size="sm" />
        ) : checked ? (
          <Icon name="check" size="sm" />
        ) : null}
      </span>
      {label && <span className="org-checkbox__label">{label}</span>}
    </label>
  );
}


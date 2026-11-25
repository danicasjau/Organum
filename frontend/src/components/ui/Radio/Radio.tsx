import { createContext, useContext, useId } from 'react';
import { cn } from '../_internal/cn';
import './Radio.css';

interface RadioCtx {
  name: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

const RadioContext = createContext<RadioCtx | null>(null);

export interface RadioGroupProps {
  value: string;
  onChange: (val: string) => void;
  name?: string;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  ariaLabel?: string;
  children: React.ReactNode;
  className?: string;
}

export function RadioGroup({
  value,
  onChange,
  name,
  orientation = 'horizontal',
  disabled = false,
  ariaLabel,
  children,
  className,
}: RadioGroupProps) {
  const autoName = useId();
  return (
    <RadioContext.Provider value={{ name: name ?? autoName, value, onChange, disabled }}>
      <div
        data-ui="radio-group"
        role="radiogroup"
        aria-label={ariaLabel}
        data-orientation={orientation}
        className={cn('org-radio-group', className)}
      >
        {children}
      </div>
    </RadioContext.Provider>
  );
}

export interface RadioItemProps {
  value: string;
  label?: string;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
}

export function RadioItem({
  value,
  label,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
}: RadioItemProps) {
  const ctx = useContext(RadioContext);
  const id = useId();
  const isDisabled = disabled || Boolean(ctx?.disabled);
  const checked = ctx ? ctx.value === value : false;

  return (
    <label
      htmlFor={id}
      data-ui="radio"
      data-disabled={isDisabled ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      data-force-state={forceState}
      className="org-radio"
    >
      <input
        id={id}
        type="radio"
        name={ctx?.name}
        value={value}
        checked={checked}
        disabled={isDisabled}
        className="org-radio__input"
        onChange={() => ctx?.onChange(value)}
      />
      <span className="org-radio__circle" aria-hidden="true">
        <span className="org-radio__dot" />
      </span>
      {label && <span className="org-radio__label">{label}</span>}
    </label>
  );
}


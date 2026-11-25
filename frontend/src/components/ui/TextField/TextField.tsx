import { useEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../_internal/cn';
import { Icon } from '../Icon/Icon';
import './TextField.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  error?: boolean | string;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
}

export function TextField({
  error,
  dirty,
  forceState,
  className,
  disabled,
  ...rest
}: TextFieldProps) {
  return (
    <div
      data-ui="text-field"
      data-error={error ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-force-state={forceState}
      className={cn('org-field-wrap', className)}
    >
      <input className="org-field__input" disabled={disabled} {...rest} />
      {error && (
        <span className="org-field__error-icon" title={typeof error === 'string' ? error : 'Error'}>
          <Icon name="alert" size="sm" />
        </span>
      )}
    </div>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  dirty?: boolean;
}

export function TextArea({ error, dirty, className, disabled, ...rest }: TextAreaProps) {
  return (
    <textarea
      data-ui="text-area"
      data-error={error ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      disabled={disabled}
      className={cn('org-textarea', className)}
      {...rest}
    />
  );
}

export function PasswordField({
  error,
  dirty,
  className,
  disabled,
  ...rest
}: Omit<TextFieldProps, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div
      data-ui="password-field"
      data-error={error ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      className={cn('org-field-wrap', className)}
    >
      <input
        type={visible ? 'text' : 'password'}
        className="org-field__input"
        disabled={disabled}
        {...rest}
      />
      <button
        type="button"
        className="org-field__icon-btn"
        aria-label={visible ? 'Hide password' : 'Show password'}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
      >
        <Icon name={visible ? 'eye-off' : 'eye'} size="sm" />
      </button>
    </div>
  );
}

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSearch?: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  matchCount?: string;
  captureCtrlF?: boolean;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  className?: string;
  ariaLabel?: string;
}

export function SearchField({
  value,
  onChange,
  onSearch,
  debounceMs = 200,
  placeholder = 'Search...',
  matchCount,
  captureCtrlF = false,
  disabled = false,
  error = false,
  dirty = false,
  forceState,
  className,
  ariaLabel = 'Search',
}: SearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!onSearch) return;
    const t = window.setTimeout(() => onSearch(value), debounceMs);
    return () => window.clearTimeout(t);
  }, [value, onSearch, debounceMs]);

  useEffect(() => {
    if (!captureCtrlF) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [captureCtrlF]);

  return (
    <div
      data-ui="search-field"
      data-error={error ? 'true' : undefined}
      data-dirty={dirty ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-force-state={forceState}
      className={cn('org-field-wrap', className)}
    >
      <span className="org-field__prefix" aria-hidden="true">
        <Icon name="search" size="sm" />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="org-field__input"
        onChange={(e) => onChange(e.target.value)}
      />
      {matchCount && <span className="org-field__counter">{matchCount}</span>}
      {value && !disabled && (
        <button
          type="button"
          className="org-field__icon-btn"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            onSearch?.('');
          }}
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  );
}


import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../_internal/cn';
import './InlineEdit.css';

export interface InlineEditProps {
  value: string;
  /** Called with the trimmed new value when it differs; throw/reject to keep editing. */
  onCommit: (next: string) => void | Promise<void>;
  ariaLabel: string;
  /** Rendered in display mode instead of the raw value. */
  display?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Validate the draft; return an error message to block the commit. */
  validate?: (draft: string) => string | null;
  className?: string;
  mono?: boolean;
}

/**
 * Click (or Enter / F2 when focused) to edit in place. Enter or blur commits, Escape cancels.
 */
export function InlineEdit({
  value,
  onCommit,
  ariaLabel,
  display,
  placeholder,
  maxLength,
  disabled = false,
  validate,
  className,
  mono = false,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const cancel = () => {
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  const commit = async () => {
    if (committing.current) return;
    const next = draft.trim();
    if (next === value) {
      cancel();
      return;
    }
    const msg = validate?.(next) ?? (next ? null : 'Required');
    if (msg) {
      setError(msg);
      return;
    }
    committing.current = true;
    try {
      await onCommit(next);
      setError(null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      committing.current = false;
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={cn('org-inline-edit__display', mono && 'is-mono', className)}
        aria-label={`${ariaLabel}: ${value || 'empty'} (click to edit)`}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {display ?? (value || <span className="org-inline-edit__ph">{placeholder}</span>)}
      </button>
    );
  }

  return (
    <span className={cn('org-inline-edit', className)} data-error={error ? 'true' : undefined}>
      <input
        ref={inputRef}
        className={cn('org-inline-edit__input', mono && 'is-mono')}
        aria-label={ariaLabel}
        aria-invalid={error ? 'true' : undefined}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => void commit()}
      />
      {error && (
        <span className="org-inline-edit__err" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

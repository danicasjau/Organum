import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import { useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { cn } from '../_internal/cn';
import { evalNumericExpression } from '../_internal/evalMath';
import { useCssVarRef } from '../_internal/useCssVar';
import { Icon } from '../Icon/Icon';
import './NumberField.css';

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  baselineValue?: number;
  mode?: 'int' | 'float';
  min?: number;
  max?: number;
  softMin?: number;
  softMax?: number;
  step?: number;
  precision?: number;
  unit?: string;
  label?: string;
  axisTone?: 'x' | 'y' | 'z' | 'w';
  showSteppers?: boolean;
  disabled?: boolean;
  error?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  onReset?: () => void;
  ariaLabel?: string;
  className?: string;
}

export function NumberField({
  value,
  onChange,
  baselineValue,
  mode = 'float',
  min = -Infinity,
  max = Infinity,
  softMin,
  softMax,
  step,
  precision,
  unit,
  label,
  axisTone,
  showSteppers = false,
  disabled = false,
  error = false,
  forceState,
  onReset,
  ariaLabel,
  className,
}: NumberFieldProps) {
  const effectiveStep = step ?? (mode === 'int' ? 1 : 0.1);
  const effectivePrecision = precision ?? (mode === 'int' ? 0 : 3);

  const clampAndRound = (raw: number): number => {
    const clamped = Math.max(min, Math.min(max, raw));
    if (mode === 'int') return Math.round(clamped);
    const factor = 10 ** effectivePrecision;
    return Math.round(clamped * factor) / factor;
  };

  const formatDisplay = (val: number): string => {
    const rounded = clampAndRound(val);
    return mode === 'int' ? String(rounded) : rounded.toFixed(effectivePrecision);
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatDisplay(value));
  const [parseError, setParseError] = useState(false);

  const dragStartRef = useRef<{ x: number; startVal: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  const rangeMin = softMin ?? min;
  const rangeMax = softMax ?? max;
  const hasBoundedFill = Number.isFinite(rangeMin) && Number.isFinite(rangeMax) && rangeMax > rangeMin;
  const fillPct = hasBoundedFill
    ? Math.max(0, Math.min(100, ((value - rangeMin) / (rangeMax - rangeMin)) * 100))
    : 0;
  useCssVarRef(fillRef, '--numfield-pct', hasBoundedFill ? `${fillPct.toFixed(2)}%` : undefined);

  const isDirty =
    baselineValue !== undefined && Math.abs(value - baselineValue) > 10 ** -(effectivePrecision + 2);

  const commitDraft = (rawText: string): boolean => {
    const evaluated = evalNumericExpression(rawText);
    if (evaluated === null) {
      setParseError(true);
      return false;
    }
    setParseError(false);
    onChange(clampAndRound(evaluated));
    setEditing(false);
    return true;
  };

  const stepBy = (delta: number) => {
    if (disabled) return;
    onChange(clampAndRound(value + delta));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || editing || e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, startVal: value, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag || disabled) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    const mult = e.shiftKey ? 10 : e.ctrlKey || e.altKey ? 0.1 : 1;
    const next = drag.startVal + Math.round(dx / 2) * effectiveStep * mult;
    onChange(clampAndRound(next));
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    dragStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (drag && !drag.moved && !disabled) {
      setEditing(true);
      setDraft(formatDisplay(value));
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const mult = e.shiftKey ? 10 : e.ctrlKey || e.altKey ? 0.1 : 1;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepBy(effectiveStep * mult);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepBy(-effectiveStep * mult);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!editing) {
        setEditing(true);
        setDraft(formatDisplay(value));
        inputRef.current?.select();
      } else {
        commitDraft(draft);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
      setParseError(false);
      setDraft(formatDisplay(value));
    } else if (e.key === 'Tab' && editing) {
      commitDraft(draft);
    }
  };

  const handleWheel = (e: WheelEvent<HTMLInputElement>) => {
    if (disabled || document.activeElement !== inputRef.current) return;
    e.preventDefault();
    const mult = e.shiftKey ? 10 : e.ctrlKey || e.altKey ? 0.1 : 1;
    stepBy((e.deltaY < 0 ? 1 : -1) * effectiveStep * mult);
  };

  const handleReset = () => {
    if (disabled) return;
    if (onReset) onReset();
    else if (baselineValue !== undefined) onChange(clampAndRound(baselineValue));
  };

  const hasError = error || parseError;

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        <div
          data-ui="number-field"
          data-dirty={isDirty ? 'true' : undefined}
          data-error={hasError ? 'true' : undefined}
          data-disabled={disabled ? 'true' : undefined}
          data-editing={editing ? 'true' : undefined}
          data-axis={axisTone}
          data-force-state={forceState}
          className={cn('org-numfield', className)}
        >
          {label && (
            <span
              className="org-numfield__label"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            >
              {label}
            </span>
          )}
          <div
            className="org-numfield__body"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={() => {
              if (disabled) return;
              setEditing(true);
              setDraft(formatDisplay(value));
              window.setTimeout(() => inputRef.current?.select(), 0);
            }}
          >
            {hasBoundedFill && (
              <div ref={fillRef} className="org-numfield__fill" aria-hidden="true" />
            )}
            <input
              ref={inputRef}
              type="text"
              role="spinbutton"
              aria-label={ariaLabel ?? label ?? 'Numeric value'}
              aria-valuemin={Number.isFinite(min) ? min : undefined}
              aria-valuemax={Number.isFinite(max) ? max : undefined}
              aria-valuenow={value}
              readOnly={!editing}
              disabled={disabled}
              value={editing ? draft : formatDisplay(value)}
              className="org-numfield__input"
              onChange={(e) => {
                setDraft(e.target.value);
                if (parseError) setParseError(false);
              }}
              onFocus={() => {
                if (!editing && !disabled) {
                  setDraft(formatDisplay(value));
                }
              }}
              onBlur={() => {
                if (editing) {
                  if (!commitDraft(draft)) {
                    setDraft(formatDisplay(value));
                    setEditing(false);
                  }
                }
              }}
              onKeyDown={handleKeyDown}
              onWheel={handleWheel}
            />
            {unit && <span className="org-numfield__unit">{unit}</span>}
            {hasError && (
              <span className="org-numfield__err" title="Invalid numeric expression">
                <Icon name="alert" size="sm" />
              </span>
            )}
            {isDirty && !disabled && (
              <button
                type="button"
                className="org-numfield__reset"
                title="Reset to default"
                aria-label="Reset value"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReset();
                }}
              >
                <Icon name="reset" size="sm" />
              </button>
            )}
          </div>
          {showSteppers && (
            <div className="org-numfield__steppers">
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                aria-label="Increment"
                className="org-numfield__step-btn"
                onClick={() => stepBy(effectiveStep)}
              >
                <Icon name="chevron-up" size="sm" />
              </button>
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                aria-label="Decrement"
                className="org-numfield__step-btn"
                onClick={() => stepBy(-effectiveStep)}
              >
                <Icon name="chevron-down" size="sm" />
              </button>
            </div>
          )}
        </div>
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="org-numfield__menu">
          <ContextMenuPrimitive.Item
            className="org-numfield__menu-item"
            disabled={disabled || (baselineValue === undefined && !onReset)}
            onSelect={handleReset}
          >
            Reset to Default
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className="org-numfield__menu-item"
            onSelect={() => navigator.clipboard?.writeText(String(value))}
          >
            Copy Value
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className="org-numfield__menu-item"
            disabled={disabled}
            onSelect={async () => {
              const txt = await navigator.clipboard?.readText();
              if (txt) commitDraft(txt);
            }}
          >
            Paste Value
          </ContextMenuPrimitive.Item>
          {Number.isFinite(min) && (
            <ContextMenuPrimitive.Item
              className="org-numfield__menu-item"
              disabled={disabled}
              onSelect={() => onChange(clampAndRound(min))}
            >
              Set Min ({min})
            </ContextMenuPrimitive.Item>
          )}
          {Number.isFinite(max) && (
            <ContextMenuPrimitive.Item
              className="org-numfield__menu-item"
              disabled={disabled}
              onSelect={() => onChange(clampAndRound(max))}
            >
              Set Max ({max})
            </ContextMenuPrimitive.Item>
          )}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

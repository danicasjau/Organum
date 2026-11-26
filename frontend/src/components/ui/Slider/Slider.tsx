import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import { NumberField } from '../NumberField/NumberField';
import './Slider.css';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  baselineValue?: number;
  min?: number;
  max?: number;
  softMin?: number;
  softMax?: number;
  step?: number;
  mode?: 'int' | 'float';
  precision?: number;
  unit?: string;
  label?: string;
  onReset?: () => void;
  logarithmic?: boolean;
  showTicks?: boolean;
  disabled?: boolean;
  error?: boolean;
  dirty?: boolean;
  forceState?: 'hover' | 'pressed' | 'focus';
  ariaLabel?: string;
  inputAriaLabel?: string;
  className?: string;
}

function toNorm(val: number, min: number, max: number, log: boolean): number {
  const clamped = Math.max(min, Math.min(max, val));
  if (max <= min) return 0;
  if (log && min > 0) {
    const lMin = Math.log(min);
    const lMax = Math.log(max);
    return (Math.log(clamped) - lMin) / (lMax - lMin);
  }
  return (clamped - min) / (max - min);
}

function fromNorm(t: number, min: number, max: number, log: boolean): number {
  const clamped = Math.max(0, Math.min(1, t));
  if (log && min > 0) {
    const lMin = Math.log(min);
    const lMax = Math.log(max);
    return Math.exp(lMin + clamped * (lMax - lMin));
  }
  return min + clamped * (max - min);
}

/* Tick marks every 10% and labels at 0/25/50/75/100 under the trough. */
const TICK_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const LABEL_STEPS = [0, 25, 50, 75, 100];
function formatTick(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 1);
}

export function Slider({
  value,
  onChange,
  baselineValue,
  min = 0,
  max = 100,
  softMin,
  softMax,
  step,
  mode = 'float',
  precision = 2,
  unit,
  label,
  onReset,
  logarithmic = false,
  showTicks = false,
  disabled = false,
  error = false,
  dirty,
  forceState,
  ariaLabel = 'Slider',
  inputAriaLabel,
  className,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const effectiveStep = step ?? (mode === 'int' ? 1 : (max - min) / 100);
  const norm = toNorm(value, min, max, logarithmic);
  const pct = `${(norm * 100).toFixed(3)}%`;

  useCssVarRef(fillRef, '--slider-pct', pct);
  useCssVarRef(thumbRef, '--slider-pct', pct);

  const isDirty =
    dirty ?? (baselineValue !== undefined && Math.abs(value - baselineValue) > 10 ** -(precision + 2));

  const updateFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    let raw = fromNorm(t, min, max, logarithmic);
    if (mode === 'int') {
      raw = Math.round(raw);
    } else if (step) {
      raw = Math.round((raw - min) / step) * step + min;
    }
    onChange(Math.max(min, Math.min(max, raw)));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromClientX(e.clientX);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const mult = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(max, value + effectiveStep * mult));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(min, value - effectiveStep * mult));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      data-ui="slider"
      data-disabled={disabled ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
      data-dirty={isDirty ? 'true' : undefined}
      data-force-state={forceState}
      data-ticks={showTicks ? 'true' : undefined}
      className={cn('org-slider', className)}
    >
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        className="org-slider__track-area"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="org-slider__groove">
          <div ref={fillRef} className="org-slider__fill" />
        </div>
        {showTicks && (
          <div className="org-slider__ticks" aria-hidden="true">
            {TICK_STEPS.map((t) => (
              <span key={t} className="org-slider__tick" data-major={t % 25 === 0 ? 'true' : undefined} />
            ))}
          </div>
        )}
        {showTicks && (
          <div className="org-slider__tick-labels" aria-hidden="true">
            {LABEL_STEPS.map((p) => (
              <span key={p} className="org-slider__tick-label" data-pos={p}>
                {formatTick(min + ((max - min) * p) / 100)}
              </span>
            ))}
          </div>
        )}
        <div ref={thumbRef} className="org-slider__thumb" />
      </div>
      <div className="org-slider__field org-vtopbar__num">
        <NumberField
          label={label}
          value={value}
          onChange={onChange}
          baselineValue={baselineValue}
          mode={mode}
          min={min}
          max={max}
          softMin={softMin}
          softMax={softMax}
          step={effectiveStep}
          precision={precision}
          unit={unit}
          onReset={onReset}
          disabled={disabled}
          error={error}
          forceState={forceState}
          ariaLabel={inputAriaLabel ?? `${ariaLabel} numeric input`}
        />
      </div>
    </div>
  );
}

export interface RangeSliderProps {
  value: [number, number];
  onChange: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export function RangeSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  ariaLabel = 'Range slider',
}: RangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<HTMLDivElement>(null);
  const loThumbRef = useRef<HTMLDivElement>(null);
  const hiThumbRef = useRef<HTMLDivElement>(null);
  const activeThumb = useRef<'lo' | 'hi' | null>(null);

  const [lo, hi] = value;
  const loPct = toNorm(lo, min, max, false) * 100;
  const hiPct = toNorm(hi, min, max, false) * 100;

  useCssVarRef(rangeRef, '--range-start', `${loPct.toFixed(3)}%`);
  useCssVarRef(rangeRef, '--range-width', `${Math.max(0, hiPct - loPct).toFixed(3)}%`);
  useCssVarRef(loThumbRef, '--slider-pct', `${loPct.toFixed(3)}%`);
  useCssVarRef(hiThumbRef, '--slider-pct', `${hiPct.toFixed(3)}%`);

  const span = Math.max(1, max - min);
  const tickStep = span <= 40 ? 1 : span <= 100 ? 2 : span <= 250 ? 5 : 10;
  const majorEvery = tickStep === 1 ? 5 : tickStep === 2 ? 10 : tickStep === 5 ? 25 : 50;
  const ticks: Array<{ frame: number; xPct: number; major: boolean }> = [];
  const firstTick = Math.ceil(min / tickStep) * tickStep;
  for (let f = firstTick; f <= max; f += tickStep) {
    ticks.push({
      frame: f,
      xPct: ((f - min) / span) * 100,
      major: f % majorEvery === 0 || f === min || f === max,
    });
  }

  const updatePointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || !activeThumb.current) return;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = Math.round((min + t * (max - min)) / step) * step;
    const clamped = Math.max(min, Math.min(max, raw));
    if (activeThumb.current === 'lo') {
      onChange([Math.min(clamped, hi), hi]);
    } else {
      onChange([lo, Math.max(clamped, lo)]);
    }
  };

  return (
    <div
      data-ui="range-slider"
      data-disabled={disabled ? 'true' : undefined}
      className="org-rangeslider"
    >
      <div
        ref={trackRef}
        className="org-rangeslider__panel"
        onPointerDown={(e) => {
          if (disabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const t = (e.clientX - rect.left) / rect.width;
          const clickVal = min + t * (max - min);
          activeThumb.current =
            Math.abs(clickVal - lo) <= Math.abs(clickVal - hi) ? 'lo' : 'hi';
          e.currentTarget.setPointerCapture(e.pointerId);
          updatePointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) {
            updatePointer(e.clientX);
          }
        }}
        onPointerUp={(e) => {
          activeThumb.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
      >
        <svg className="org-rangeslider__ruler" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t.frame}>
              <line
                x1={`${t.xPct}%`}
                x2={`${t.xPct}%`}
                y1={t.major ? '25%' : '55%'}
                y2="100%"
                className={t.major ? 'org-rangeslider__tick-major' : 'org-rangeslider__tick-minor'}
              />
              {t.major && (
                <text x={`${t.xPct}%`} y="9" className="org-rangeslider__tick-label">
                  {t.frame}
                </text>
              )}
            </g>
          ))}
        </svg>
        <div ref={rangeRef} className="org-rangeslider__band" />
        <div
          ref={loThumbRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${ariaLabel} minimum`}
          aria-valuemin={min}
          aria-valuemax={hi}
          aria-valuenow={lo}
          className="org-rangeslider__handle"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') onChange([Math.min(hi, lo + step), hi]);
            if (e.key === 'ArrowLeft') onChange([Math.max(min, lo - step), hi]);
          }}
        />
        <div
          ref={hiThumbRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={`${ariaLabel} maximum`}
          aria-valuemin={lo}
          aria-valuemax={max}
          aria-valuenow={hi}
          className="org-rangeslider__handle"
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') onChange([lo, Math.min(max, hi + step)]);
            if (e.key === 'ArrowLeft') onChange([lo, Math.max(lo, hi - step)]);
          }}
        />
      </div>
      <span className="org-rangeslider__readout">
        {lo}–{hi}
      </span>
    </div>
  );
}


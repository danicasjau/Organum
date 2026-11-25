import { useRef, type PointerEvent } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { NumberField } from '../NumberField/NumberField';
import './DialKnob.css';

export interface AngleDialProps {
  value: number;
  onChange: (deg: number) => void;
  baselineValue?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export function AngleDial({
  value,
  onChange,
  baselineValue,
  disabled = false,
  ariaLabel = 'Angle',
}: AngleDialProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const updateAngle = (clientX: number, clientY: number, snap: boolean) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let deg = (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90;
    deg = ((deg % 360) + 360) % 360;
    if (snap) deg = Math.round(deg / 15) * 15;
    onChange(Math.round(deg * 10) / 10);
  };

  const rad = ((value - 90) * Math.PI) / 180;
  const x2 = 14 + Math.cos(rad) * 10;
  const y2 = 14 + Math.sin(rad) * 10;

  return (
    <div data-ui="angle-dial" className="org-dial-wrap">
      <svg
        ref={svgRef}
        viewBox="0 0 28 28"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={value}
        className="org-dial"
        onPointerDown={(e: PointerEvent<SVGSVGElement>) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateAngle(e.clientX, e.clientY, e.shiftKey);
        }}
        onPointerMove={(e: PointerEvent<SVGSVGElement>) => {
          if (!disabled && e.currentTarget.hasPointerCapture(e.pointerId)) {
            updateAngle(e.clientX, e.clientY, e.shiftKey);
          }
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onDoubleClick={() => {
          if (!disabled && baselineValue !== undefined) onChange(baselineValue);
        }}
      >
        <circle cx="14" cy="14" r="12" className="org-dial__face" />
        <line x1="14" y1="14" x2={x2} y2={y2} className="org-dial__needle" />
        <circle cx="14" cy="14" r="2" className="org-dial__center" />
      </svg>
      <div className="org-dial__field">
        <NumberField
          value={value}
          baselineValue={baselineValue}
          onChange={onChange}
          min={0}
          max={360}
          step={1}
          precision={1}
          unit="°"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  baselineValue?: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  disabled?: boolean;
}

export function Knob({
  value,
  onChange,
  baselineValue,
  min = 0,
  max = 100,
  step = 1,
  label,
  disabled = false,
}: KnobProps) {
  const dragRef = useRef<{ y: number; startVal: number } | null>(null);
  const norm = max > min ? (value - min) / (max - min) : 0;
  const angleDeg = -135 + norm * 270;
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const x2 = 14 + Math.cos(rad) * 10;
  const y2 = 14 + Math.sin(rad) * 10;

  return (
    <div data-ui="knob" className="org-knob-wrap">
      <svg
        viewBox="0 0 28 28"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label ?? 'Knob'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="org-dial org-knob"
        onPointerDown={(e) => {
          if (disabled) return;
          dragRef.current = { y: e.clientY, startVal: value };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || disabled) return;
          const dy = dragRef.current.y - e.clientY;
          const range = max - min;
          const raw = dragRef.current.startVal + (dy / 120) * range;
          const snapped = Math.round(raw / step) * step;
          onChange(Math.max(min, Math.min(max, Number(snapped.toFixed(4)))));
        }}
        onPointerUp={(e) => {
          dragRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onDoubleClick={() => {
          if (!disabled && baselineValue !== undefined) onChange(baselineValue);
        }}
      >
        <circle cx="14" cy="14" r="12" className="org-dial__face" />
        <line x1="14" y1="14" x2={x2} y2={y2} className="org-dial__needle" />
        <circle cx="14" cy="14" r="2" className="org-dial__center" />
      </svg>
      <span className="org-knob__val">{value}</span>
      {baselineValue !== undefined && value !== baselineValue && !disabled && (
        <Button
          variant="ghost"
          size="sm"
          title="Reset knob"
          aria-label="Reset knob"
          onClick={() => onChange(baselineValue)}
        >
          <Icon name="reset" size="sm" />
        </Button>
      )}
    </div>
  );
}

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  disabled = false,
  ariaLabel = 'Stepper',
}: StepperProps) {
  return (
    <div data-ui="stepper" role="group" aria-label={ariaLabel} className="org-stepper">
      <Button
        variant="icon"
        size="sm"
        disabled={disabled || value <= min}
        aria-label="Decrease"
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Icon name="minus" size="sm" />
      </Button>
      <span className="org-stepper__val">{value}</span>
      <Button
        variant="icon"
        size="sm"
        disabled={disabled || value >= max}
        aria-label="Increase"
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Icon name="plus" size="sm" />
      </Button>
    </div>
  );
}


import { useId, useRef, type PointerEvent } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { NumberField } from '../NumberField/NumberField';
import './DialKnob.css';


/* ---- v1 knob face -------------------------------------------------------
   Round RAISED dial with a knurled edge (dash-array ribs), soft cast shadow,
   a 3px amber indicator and a tick ring. All colours come from tokens (CSS
   classes), so the Paper theme restyles it without edits. */
const C = 24;
function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + Math.cos(rad) * r, C + Math.sin(rad) * r];
}

interface KnobFaceProps {
  angleDeg: number;
  /** 'arc' = 11 ticks over 270°; 'full' = 12 ticks over 360°. */
  ring: 'arc' | 'full';
  minLabel?: string;
  maxLabel?: string;
}

function KnobFace({ angleDeg, ring, minLabel, maxLabel }: KnobFaceProps) {
  const gid = useId().replace(/:/g, '');
  const ticks =
    ring === 'arc'
      ? Array.from({ length: 11 }, (_, i) => ({ deg: -135 + i * 27, long: i === 0 || i === 5 || i === 10 }))
      : Array.from({ length: 12 }, (_, i) => ({ deg: i * 30, long: i % 3 === 0 }));
  const [ix1, iy1] = polar(4.5, angleDeg);
  const [ix2, iy2] = polar(11.5, angleDeg);
  const [lx, ly] = polar(21, -135);
  const [rx, ry] = polar(21, 135);
  return (
    <>
      <defs>
        <linearGradient id={`kf-${gid}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" className="org-knob__stop-top" />
          <stop offset="1" className="org-knob__stop-bottom" />
        </linearGradient>
      </defs>
      {ticks.map((t) => {
        const [x1, y1] = polar(t.long ? 18.5 : 19.5, t.deg);
        const [x2, y2] = polar(22, t.deg);
        return (
          <line
            key={t.deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={t.long ? 'org-knob__tick org-knob__tick--long' : 'org-knob__tick'}
          />
        );
      })}
      <circle cx={C + 1} cy={C + 2} r="15" className="org-knob__shadow" />
      <circle cx={C} cy={C} r="15" className="org-knob__rim" />
      <circle cx={C} cy={C} r="15" className="org-knob__knurl" />
      <circle cx={C} cy={C} r="12.5" fill={`url(#kf-${gid})`} className="org-knob__face" />
      <circle cx={C} cy={C} r="12" className="org-knob__hi" />
      <line x1={ix1} y1={iy1} x2={ix2} y2={iy2} className="org-dial__needle" />
      {minLabel !== undefined && (
        <text x={lx} y={ly + 5} className="org-knob__label" textAnchor="middle">
          {minLabel}
        </text>
      )}
      {maxLabel !== undefined && (
        <text x={rx} y={ry + 5} className="org-knob__label" textAnchor="middle">
          {maxLabel}
        </text>
      )}
    </>
  );
}

function fmtLimit(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

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

  return (
    <div data-ui="angle-dial" className="org-dial-wrap">
      <svg
        ref={svgRef}
        viewBox="0 0 48 48"
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
        <KnobFace angleDeg={value} ring="full" />
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

  return (
    <div data-ui="knob" className="org-knob-wrap">
      <svg
        viewBox="0 0 48 52"
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
        <KnobFace angleDeg={angleDeg} ring="arc" minLabel={fmtLimit(min)} maxLabel={fmtLimit(max)} />
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


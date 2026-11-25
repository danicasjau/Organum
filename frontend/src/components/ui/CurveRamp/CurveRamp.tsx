import { useRef, useState, type PointerEvent } from 'react';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import './CurveRamp.css';

export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurveRampProps {
  points: ReadonlyArray<CurvePoint>;
  onChange: (points: CurvePoint[]) => void;
  disabled?: boolean;
}

const W = 220;
const H = 96;

export function CurveRamp({ points, onChange, disabled = false }: CurveRampProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  const sorted = [...points].sort((a, b) => a.x - b.x);
  const pathData = sorted
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${(pt.x * W).toFixed(1)} ${((1 - pt.y) * H).toFixed(1)}`)
    .join(' ');

  const clientToNormalized = (clientX: number, clientY: number): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    return { x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
  };

  return (
    <div data-ui="curve-ramp" className="org-ramp">
      <div className="org-ramp__bar">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange([
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ])
          }
        >
          Linear
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange([
              { x: 0, y: 0 },
              { x: 0.25, y: 0.1 },
              { x: 0.75, y: 0.9 },
              { x: 1, y: 1 },
            ])
          }
        >
          S-Curve
        </Button>
        <Button
          variant="icon"
          size="sm"
          title="Reset curve"
          aria-label="Reset curve"
          disabled={disabled}
          onClick={() =>
            onChange([
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ])
          }
        >
          <Icon name="reset" size="sm" />
        </Button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="org-ramp__svg"
        onPointerDown={(e: PointerEvent<SVGSVGElement>) => {
          if (disabled || !svgRef.current) return;
          const pt = clientToNormalized(e.clientX, e.clientY);
          const hit = sorted.findIndex(
            (p) => Math.hypot((p.x - pt.x) * W, (p.y - pt.y) * H) <= 8,
          );
          if (hit >= 0) {
            setDraggingIdx(hit);
            e.currentTarget.setPointerCapture(e.pointerId);
          } else {
            const next = [...sorted, pt].sort((a, b) => a.x - b.x);
            onChange(next);
          }
        }}
        onPointerMove={(e: PointerEvent<SVGSVGElement>) => {
          if (draggingIdx === null || disabled) return;
          const pt = clientToNormalized(e.clientX, e.clientY);
          const next = sorted.map((p, i) => (i === draggingIdx ? pt : p));
          onChange(next);
        }}
        onPointerUp={(e) => {
          setDraggingIdx(null);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
      >
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="org-ramp__grid" />
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} className="org-ramp__grid" />
        <line x1="0" y1={H} x2={W} y2="0" className="org-ramp__diag" />
        <path d={pathData} className="org-ramp__line" />
        {sorted.map((pt, idx) => (
          <circle
            key={idx}
            cx={pt.x * W}
            cy={(1 - pt.y) * H}
            r="4"
            className="org-ramp__pt"
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (!disabled && sorted.length > 2) {
                onChange(sorted.filter((_, i) => i !== idx));
              }
            }}
          />
        ))}
      </svg>
    </div>
  );
}


import { useRef } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import './Progress.css';

export interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = true,
  className,
}: ProgressBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fillRef = useRef<HTMLDivElement>(null);
  useCssVarRef(fillRef, '--progress-pct', `${pct}%`);

  return (
    <div
      data-ui="progress-bar"
      role="progressbar"
      aria-label={label ?? 'Progress'}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('org-progress', className)}
    >
      <div className="org-progress__track">
        <div ref={fillRef} className="org-progress__fill" />
      </div>
      {showPercent && <span className="org-progress__pct">{Math.round(pct)}%</span>}
    </div>
  );
}

export function Spinner({
  size = 'md',
  label = 'Loading',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  className?: string;
}) {
  return (
    <svg
      data-ui="spinner"
      data-size={size}
      role="status"
      aria-label={label}
      viewBox="0 0 16 16"
      className={cn('org-spinner', className)}
    >
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
        <line x1="8" y1="1.5" x2="8" y2="4" opacity="1" />
        <line x1="12.6" y1="3.4" x2="10.8" y2="5.2" opacity="0.85" />
        <line x1="14.5" y1="8" x2="12" y2="8" opacity="0.7" />
        <line x1="12.6" y1="12.6" x2="10.8" y2="10.8" opacity="0.55" />
        <line x1="8" y1="14.5" x2="8" y2="12" opacity="0.4" />
        <line x1="3.4" y1="12.6" x2="5.2" y2="10.8" opacity="0.3" />
        <line x1="1.5" y1="8" x2="4" y2="8" opacity="0.2" />
        <line x1="3.4" y1="3.4" x2="5.2" y2="5.2" opacity="0.12" />
      </g>
    </svg>
  );
}


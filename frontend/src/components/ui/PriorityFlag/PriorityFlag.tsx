import { cn } from '../_internal/cn';
import { SegmentedControl } from '../ButtonGroup/ButtonGroup';
import './PriorityFlag.css';

/** v1 priority levels, in order. */
export type PriorityLevel = 'low' | 'normal' | 'high' | 'urgent' | 'critical';

export const PRIORITY_LEVELS: ReadonlyArray<PriorityLevel> = [
  'low',
  'normal',
  'high',
  'urgent',
  'critical',
];

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
  critical: 'Critical',
};

/**
 * Map any stored priority value to a v1 level. The backend currently stores
 * 'normal' | 'high' | 'stopper'; 'stopper' is shown as Critical.
 */
export function toPriorityLevel(value: string | null | undefined): PriorityLevel {
  const v = (value ?? '').toLowerCase();
  if (v === 'stopper') return 'critical';
  return (PRIORITY_LEVELS as ReadonlyArray<string>).includes(v) ? (v as PriorityLevel) : 'normal';
}

/** The 15px flag glyph: stroke in the priority colour, 40% fill. */
export function PriorityFlagGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={cn('org-prioflag__glyph', className)}
      viewBox="0 0 24 24"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={2}
      aria-hidden="true"
    >
      <path className="org-prioflag__cloth" d="M5 4.5h12.5L15 9l2.5 4.5H5Z" />
      <path className="org-prioflag__pole" d="M5 21V3.5" />
    </svg>
  );
}

export interface PriorityFlagProps {
  /** v1 level, or a raw stored value ('stopper' → Critical). */
  priority: PriorityLevel | string;
  /** Hide the text label (never use colour alone: keep the label unless a column header names it). */
  hideLabel?: boolean;
  className?: string;
}

/** Priority is always the flag icon plus a text label, never colour alone. */
export function PriorityFlag({ priority, hideLabel = false, className }: PriorityFlagProps) {
  const level = toPriorityLevel(priority);
  const label = PRIORITY_LABELS[level];
  return (
    <span
      data-ui="priority-flag"
      data-priority={level}
      className={cn('org-prioflag', className)}
      title={`${label} priority`}
    >
      <PriorityFlagGlyph />
      {hideLabel ? (
        <span className="org-prioflag__sr">{label}</span>
      ) : (
        <span className="org-prioflag__label">{label}</span>
      )}
    </span>
  );
}

export interface PrioritySegmentedProps {
  value: PriorityLevel;
  onChange: (value: PriorityLevel) => void;
  levels?: ReadonlyArray<PriorityLevel>;
  disabled?: boolean;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

/** 5-key "Priority" SegmentedControl: each key shows its coloured flag plus label. */
export function PrioritySegmented({
  value,
  onChange,
  levels = PRIORITY_LEVELS,
  disabled,
  ariaLabel = 'Priority',
  size = 'md',
}: PrioritySegmentedProps) {
  return (
    <SegmentedControl<PriorityLevel>
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      disabled={disabled}
      size={size}
      options={levels.map((l) => ({
        value: l,
        label: <PriorityFlag priority={l} />,
        title: `${PRIORITY_LABELS[l]} priority`,
      }))}
    />
  );
}

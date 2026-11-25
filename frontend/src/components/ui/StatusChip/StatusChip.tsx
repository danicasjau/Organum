import { cn } from '../_internal/cn';
import './StatusChip.css';

export interface StatusMeta {
  code: string;
  label: string;
  glyph: string;
}

const STATUS_META: Record<string, StatusMeta> = {
  WTG: { code: 'WTG', label: 'Waiting on dependencies', glyph: '○' },
  RDY: { code: 'RDY', label: 'Ready to start', glyph: '▷' },
  IP: { code: 'IP', label: 'In progress', glyph: '▶' },
  RTK: { code: 'RTK', label: 'Retake requested', glyph: '↺' },
  P_LEAD: { code: 'P_LEAD', label: 'Pending Lead review', glyph: '◆' },
  P_SUP: { code: 'P_SUP', label: 'Pending Supervisor review', glyph: '◈' },
  P_CLIENT: { code: 'P_CLIENT', label: 'Pending Client review', glyph: '★' },
  APP: { code: 'APP', label: 'Approved', glyph: '✓' },
  HLD: { code: 'HLD', label: 'On hold', glyph: '❚❚' },
};

export interface StatusChipProps {
  status: string;
  compact?: boolean;
  title?: string;
  className?: string;
}

export function StatusChip({ status, compact = false, title, className }: StatusChipProps) {
  const normalized = status.toUpperCase();
  const meta = STATUS_META[normalized] ?? {
    code: normalized,
    label: normalized,
    glyph: '•',
  };
  return (
    <span
      data-ui="status-chip"
      data-status={meta.code}
      data-compact={compact ? 'true' : undefined}
      className={cn('org-statuschip', className)}
      title={title ?? `${meta.code} — ${meta.label}`}
    >
      <span className="org-statuschip__glyph" aria-hidden="true">
        {meta.glyph}
      </span>
      <span className="org-statuschip__code">{meta.code}</span>
    </span>
  );
}


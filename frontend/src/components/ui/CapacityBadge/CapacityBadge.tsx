import './CapacityBadge.css';

export type AssignmentCapacity = 'artist' | 'lead' | 'supervisor';

export interface CapacityBadgeProps {
  capacity: AssignmentCapacity;
}

const LABELS: Record<AssignmentCapacity, { short: string; full: string }> = {
  artist: { short: 'DO', full: 'Assigned to do work (artist)' },
  lead: { short: 'LEAD', full: 'Lead capacity' },
  supervisor: { short: 'SUP', full: 'Supervisor capacity' },
};

export function CapacityBadge({ capacity }: CapacityBadgeProps) {
  const meta = LABELS[capacity];
  return (
    <span
      data-ui="capacity-badge"
      data-capacity={capacity}
      className="org-capbadge"
      title={meta.full}
    >
      {meta.short}
    </span>
  );
}

export function CapacityBadgeList({
  capacities,
}: {
  capacities: ReadonlyArray<string>;
}) {
  const ordered = (['artist', 'lead', 'supervisor'] as const).filter((c) =>
    capacities.includes(c),
  );
  if (ordered.length === 0) return null;
  return (
    <span className="org-capbadge-list">
      {ordered.map((c) => (
        <CapacityBadge key={c} capacity={c} />
      ))}
    </span>
  );
}


import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Button,
  Checkbox,
  ContextMenu,
  DatePicker,
  Dialog,
  Select,
  Text,
  TextField,
  type SelectOption,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import type { MilestoneLike } from './scheduleModel';
import './schedule.css';

export type MilestoneTargetKind = 'none' | 'department' | 'user' | 'entity' | 'task' | 'company';

export interface MilestoneTargets {
  department: SelectOption[];
  user: SelectOption[];
  entity: SelectOption[];
  task: SelectOption[];
  company: SelectOption[];
}

const TARGET_KINDS: ReadonlyArray<{ value: MilestoneTargetKind; label: string }> = [
  { value: 'none', label: 'Nothing (project)' },
  { value: 'department', label: 'Department' },
  { value: 'user', label: 'User' },
  { value: 'entity', label: 'Entity' },
  { value: 'task', label: 'Task' },
  { value: 'company', label: 'Studio / company' },
];

export interface MilestoneDraftValues {
  name: string;
  date: string;
  kind: 'deliver' | 'milestone';
  target_kind: MilestoneTargetKind;
  target_id: string | null;
  note: string;
  status: 'open' | 'done';
  client_visible: boolean;
}

/** Create or edit a deliver date / milestone. Saving goes to the schedule draft. */
export function MilestoneDialog({
  open,
  onOpenChange,
  initial,
  targets,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: (Partial<MilestoneDraftValues> & { id?: string }) | null;
  targets: MilestoneTargets;
  onSubmit: (values: MilestoneDraftValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [v, setV] = useState<MilestoneDraftValues>({
    name: '',
    date: new Date().toISOString().slice(0, 10),
    kind: 'milestone',
    target_kind: 'none',
    target_id: null,
    note: '',
    status: 'open',
    client_visible: false,
  });
  useEffect(() => {
    if (!open || !initial) return;
    setV((prev) => ({ ...prev, ...initial, target_id: initial.target_id ?? null }));
  }, [open, initial]);

  const patch = (p: Partial<MilestoneDraftValues>) => setV((prev) => ({ ...prev, ...p }));
  const needsTarget = v.target_kind !== 'none';
  const valid = v.name.trim() && v.date && (!needsTarget || v.target_id);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial?.id ? `Edit ${v.kind === 'deliver' ? 'deliver date' : 'milestone'}` : 'New milestone / deliver date'}
    >
      <form
        className="org-sched-form"
        data-ui="milestone-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          await onSubmit({ ...v, name: v.name.trim(), target_id: needsTarget ? v.target_id : null });
          onOpenChange(false);
        }}
      >
        <label className="org-sched-field">
          <Text size="sm" variant="muted">Name</Text>
          <TextField aria-label="Milestone name" value={v.name} onChange={(e) => patch({ name: e.target.value })} required />
        </label>
        <div className="org-sched-inline">
          <DatePicker ariaLabel="Milestone date" value={v.date} onChange={(d) => d && patch({ date: d })} />
          <Select
            ariaLabel="Milestone kind"
            value={v.kind}
            onChange={(k) => patch({ kind: k as 'deliver' | 'milestone' })}
            options={[
              { value: 'milestone', label: 'Milestone (finish by)' },
              { value: 'deliver', label: 'Deliver date (final)' },
            ]}
          />
        </div>
        <div className="org-sched-inline">
          <Select
            ariaLabel="Attach to"
            value={v.target_kind}
            onChange={(k) => patch({ target_kind: k as MilestoneTargetKind, target_id: null })}
            options={TARGET_KINDS.map((t) => ({ value: t.value, label: t.label }))}
          />
          {needsTarget && (
            <Select
              ariaLabel="Milestone target"
              filterable
              value={v.target_id ?? ''}
              placeholder="Choose…"
              onChange={(id) => patch({ target_id: id })}
              options={targets[v.target_kind as Exclude<MilestoneTargetKind, 'none'>]}
            />
          )}
        </div>
        <label className="org-sched-field">
          <Text size="sm" variant="muted">Note</Text>
          <TextField aria-label="Milestone note" value={v.note} onChange={(e) => patch({ note: e.target.value })} />
        </label>
        <div className="org-sched-inline">
          <Checkbox label="Done" checked={v.status === 'done'} onChange={(d) => patch({ status: d ? 'done' : 'open' })} />
          <Checkbox
            label="Shared with clients"
            checked={v.client_visible}
            onChange={(c) => patch({ client_visible: c })}
          />
        </div>
        <div className="org-sched-actions">
          {onDelete && initial?.id && (
            <Button
              variant="danger"
              onClick={async () => {
                await onDelete();
                onOpenChange(false);
              }}
            >
              Delete
            </Button>
          )}
          <span className="org-sched-version__spacer" />
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            Add to draft
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Yellow rhombus (CR04 §7): deliver dates are larger and filled, milestones outlined; a
 * vertical guide line spans the timeline. "!" marks late target tasks (never colour only).
 * Drag horizontally to move (the caller converts pixels to dates and writes to the draft).
 */
export function MilestoneMarker({
  milestone,
  x,
  height,
  lateCount,
  editable,
  dayPx,
  onEdit,
  onDelete,
  onToggleDone,
  onMoveDays,
}: {
  milestone: MilestoneLike & { draft?: boolean };
  x: number;
  height: number;
  lateCount: number;
  editable: boolean;
  dayPx: number;
  onEdit: () => void;
  onDelete: () => void;
  onToggleDone: () => void;
  onMoveDays: (days: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragDx, setDragDx] = useState(0);
  useCssVarRef(ref, '--ms-x', `${x + dragDx}px`);
  useCssVarRef(ref, '--ms-h', `${height}px`);

  const kindLabel = milestone.kind === 'deliver' ? 'Deliver date' : 'Milestone';
  const title = [
    `${kindLabel}: ${milestone.name}`,
    milestone.date,
    milestone.target_kind !== 'none' ? `attached to ${milestone.target_kind}` : 'project-wide',
    milestone.status === 'done' ? 'done' : 'open',
    lateCount > 0 ? `${lateCount} task(s) finish after it` : '',
    milestone.draft ? 'draft change' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const beginDrag = (e: ReactMouseEvent) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    let last = 0;
    const onMove = (ev: globalThis.MouseEvent) => {
      last = ev.clientX - x0;
      setDragDx(Math.round(last / dayPx) * dayPx);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragDx(0);
      const days = Math.round(last / dayPx);
      if (days !== 0) onMoveDays(days);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={ref}
      className="org-ms"
      data-kind={milestone.kind}
      data-status={milestone.status ?? 'open'}
      data-late={lateCount > 0 ? 'true' : undefined}
      data-draft={milestone.draft ? 'true' : undefined}
      data-ui="milestone-marker"
      data-milestone-id={milestone.id}
    >
      <span className="org-ms__line" aria-hidden="true" />
      <ContextMenu
        items={
          editable
            ? [
                { id: 'edit', label: 'Edit…', onSelect: onEdit },
                {
                  id: 'done',
                  label: milestone.status === 'done' ? 'Mark open' : 'Mark done',
                  onSelect: onToggleDone,
                },
                { id: 'del', label: 'Delete', onSelect: onDelete },
              ]
            : []
        }
      >
        <button
          type="button"
          className="org-ms__diamond"
          aria-label={title}
          title={title}
          onMouseDown={beginDrag}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (editable) onEdit();
          }}
        >
          <span className="org-ms__shape" aria-hidden="true" />
          {lateCount > 0 && <span className="org-ms__late" aria-hidden="true">!</span>}
        </button>
      </ContextMenu>
      <span className="org-ms__name">{milestone.name}</span>
    </div>
  );
}

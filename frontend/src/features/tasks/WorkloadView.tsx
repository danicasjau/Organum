import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Icon,
  Select,
  Spinner,
  StatusChip,
  Text,
  DatePicker,
} from '../../components/ui';
import {
  apiClient,
  type CompanyOut,
  type DepartmentOut,
  type TaskListItemOut,
  type UserOut,
  type WorkloadCellSchema,
  type WorkloadRowSchema,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import {
  addDays,
  aggregateWorkloadWeeks,
  isWorkingDay,
  todayIsoUtc,
  utilizationTier,
} from './planningHelpers';
import { useTasksStore, type WorkloadGroupBy, type WorkloadZoom } from './tasksStore';
import './WorkloadView.css';

interface SelectedCellInfo {
  user: WorkloadRowSchema;
  cell: WorkloadCellSchema;
}

const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];

export function WorkloadView({
  tasks,
  users,
  companies,
  departments,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ReadonlyArray<TaskListItemOut>;
  users: ReadonlyArray<UserOut>;
  companies: ReadonlyArray<CompanyOut>;
  departments: ReadonlyArray<DepartmentOut>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const workloadZoom = useTasksStore((s) => s.workloadZoom);
  const setWorkloadZoom = useTasksStore((s) => s.setWorkloadZoom);
  const workloadGroupBy = useTasksStore((s) => s.workloadGroupBy);
  const setWorkloadGroupBy = useTasksStore((s) => s.setWorkloadGroupBy);

  const todayIso = useMemo(() => todayIsoUtc(), []);
  const [dateFrom, setDateFrom] = useState<string>(() => addDays(todayIso, -2));
  const [dateTo, setDateTo] = useState<string>(() => addDays(todayIso, 21));
  const [deptFilter, setDeptFilter] = useState<string>('');
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [unscheduledOpen, setUnscheduledOpen] = useState<boolean>(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCellInfo | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['project-settings', activeProjectUuid],
    queryFn: () => apiClient.getProjectSettings(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const {
    data: workload,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['workload', activeProjectUuid, dateFrom, dateTo, deptFilter, companyFilter],
    queryFn: () =>
      apiClient.getWorkload(
        {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          department_id: deptFilter || undefined,
          company_id: companyFilter || undefined,
        },
        activeProjectUuid,
      ),
    enabled: Boolean(activeProjectUuid),
  });

  const workingDays = settings?.working_days ?? DEFAULT_WORKING_DAYS;

  const tasksById = useMemo(() => {
    const m = new Map<string, TaskListItemOut>();
    for (const t of tasks) m.set(t.id, t);
    for (const t of workload?.unscheduled_tasks ?? []) m.set(t.id, t);
    return m;
  }, [tasks, workload?.unscheduled_tasks]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const userPrimaryDeptMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      for (const a of t.assignments ?? []) {
        if (a.assignment_role === 'artist' && !m.has(a.user_id)) {
          m.set(a.user_id, t.department_name);
        }
      }
    }
    return m;
  }, [tasks]);

  const columnsAndRows = useMemo(() => {
    if (!workload) {
      return {
        columns: [] as Array<{ key: string; label: string; isOff: boolean; title: string }>,
        rows: [] as WorkloadRowSchema[],
      };
    }
    const rawDays = workload.days ?? [];
    const rawRows = workload.rows ?? [];
    if (workloadZoom === 'weeks') {
      const agg = aggregateWorkloadWeeks(rawDays, rawRows);
      return {
        columns: agg.columns.map((c) => ({
          key: c.weekStart,
          label: c.label,
          isOff: false,
          title: `Week starting ${c.weekStart} (${c.dayCount}d)`,
        })),
        rows: agg.rows,
      };
    }
    return {
      columns: rawDays.map((d) => ({
        key: d,
        label: d.slice(5),
        isOff: !isWorkingDay(d, workingDays),
        title: d,
      })),
      rows: rawRows,
    };
  }, [workload, workloadZoom, workingDays]);

  const groupedSections = useMemo(() => {
    const baseRows = columnsAndRows.rows;
    if (workloadGroupBy === 'none') {
      return [{ key: 'all', title: '', rows: baseRows }];
    }
    const buckets = new Map<string, WorkloadRowSchema[]>();
    for (const r of baseRows) {
      let groupLabel = 'Unassigned';
      if (workloadGroupBy === 'company') {
        const u = usersById.get(r.user_id);
        groupLabel = u?.company_name ?? 'In-house / Unscoped';
      } else if (workloadGroupBy === 'department') {
        groupLabel = userPrimaryDeptMap.get(r.user_id) ?? 'General / Other';
      }
      if (!buckets.has(groupLabel)) buckets.set(groupLabel, []);
      buckets.get(groupLabel)!.push(r);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([title, rows]) => ({ key: title, title, rows }));
  }, [columnsAndRows.rows, workloadGroupBy, usersById, userPrimaryDeptMap]);

  const unscheduled = workload?.unscheduled_tasks ?? [];

  return (
    <div className="org-workload" data-ui="workload-view">
      <div className="org-workload__toolbar">
        <div className="org-workload__controls">
          <label className="org-workload__field">
            <Text size="sm" variant="muted">
              From
            </Text>
            <DatePicker
              ariaLabel="Workload start date"
              clearable={false}
              value={dateFrom}
              max={dateTo || null}
              onChange={(v) => {
                if (v) setDateFrom(v);
              }}
            />
          </label>
          <label className="org-workload__field">
            <Text size="sm" variant="muted">
              To
            </Text>
            <DatePicker
              ariaLabel="Workload end date"
              clearable={false}
              value={dateTo}
              min={dateFrom || null}
              onChange={(v) => {
                if (v) setDateTo(v);
              }}
            />
          </label>
          <div className="org-workload__seg" role="group" aria-label="Workload time granularity">
            {(['days', 'weeks'] as WorkloadZoom[]).map((z) => (
              <Button
                key={z}
                size="sm"
                variant={workloadZoom === z ? 'primary' : 'ghost'}
                onClick={() => setWorkloadZoom(z)}
              >
                {z === 'days' ? 'Days' : 'Weeks'}
              </Button>
            ))}
          </div>
          <Select
            ariaLabel="Workload group by"
            value={workloadGroupBy}
            onChange={(v) => setWorkloadGroupBy(v as WorkloadGroupBy)}
            options={[
              { value: 'none', label: 'Group: None' },
              { value: 'department', label: 'Group: Department' },
              { value: 'company', label: 'Group: Company' },
            ]}
          />
          {departments.length > 0 && (
            <Select
              ariaLabel="Workload department filter"
              value={deptFilter}
              onChange={setDeptFilter}
              options={[
                { value: '', label: 'All depts' },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          )}
          {companies.length > 0 && (
            <Select
              ariaLabel="Workload company filter"
              value={companyFilter}
              onChange={setCompanyFilter}
              options={[
                { value: '', label: 'All companies' },
                ...companies.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          )}
        </div>

        <div className="org-workload__legend" aria-label="Utilization legend">
          <span className="org-workload__leg-chip org-workload__cell--t0">0%</span>
          <span className="org-workload__leg-chip org-workload__cell--t1">1–75%</span>
          <span className="org-workload__leg-chip org-workload__cell--t2">76–100%</span>
          <span className="org-workload__leg-chip org-workload__cell--t3">101–125%</span>
          <span className="org-workload__leg-chip org-workload__cell--t4">&gt;125%</span>
        </div>
      </div>

      {/* Collapsible Unscheduled Tasks Band */}
      <div className="org-workload__unsched">
        <button
          type="button"
          className="org-workload__unsched-toggle"
          onClick={() => setUnscheduledOpen((o) => !o)}
          aria-expanded={unscheduledOpen}
        >
          <Icon name={unscheduledOpen ? 'chevron-down' : 'chevron-right'} size="sm" />
          <Text size="sm">Unscheduled tasks</Text>
          <Badge tone={unscheduled.length > 0 ? 'warning' : 'neutral'}>{unscheduled.length}</Badge>
        </button>
        {unscheduledOpen && (
          <div className="org-workload__unsched-list">
            {unscheduled.length === 0 ? (
              <Text size="sm" variant="muted">
                All assigned artist tasks have ideal start & finish dates.
              </Text>
            ) : (
              unscheduled.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`org-workload__unsched-item ${
                    selectedTaskId === t.id ? 'is-selected' : ''
                  }`}
                  onClick={() => onSelectTask(t.id)}
                >
                  <span className="org-workload__mono">{t.task_code}</span>
                  <StatusChip status={t.status} compact />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="org-workload__workspace">
        <div className="org-workload__grid-wrap">
          {isLoading ? (
            <div className="org-workload__state">
              <Spinner label="Computing capacity heatmap" />
            </div>
          ) : error ? (
            <div className="org-workload__state">
              <Text size="sm" variant="danger">
                {error instanceof Error ? error.message : 'Failed to load workload'}
              </Text>
            </div>
          ) : columnsAndRows.rows.length === 0 ? (
            <div className="org-workload__state">
              <Text size="sm" variant="muted">
                No artists match the current filter.
              </Text>
            </div>
          ) : (
            <table className="org-workload__table">
              <thead>
                <tr>
                  <th className="org-workload__th-user">Artist (cap/d)</th>
                  {columnsAndRows.columns.map((col) => (
                    <th
                      key={col.key}
                      className={`org-workload__th-day ${
                        workloadZoom === 'weeks' ? 'is-week' : ''
                      } ${col.isOff ? 'is-off' : ''}`}
                      title={col.title}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupedSections.map((sec) => (
                  <WorkloadSectionRows
                    key={sec.key}
                    sectionTitle={sec.title}
                    colCount={columnsAndRows.columns.length + 1}
                    rows={sec.rows}
                    isWeeks={workloadZoom === 'weeks'}
                    selectedCell={selectedCell}
                    onSelectCell={(user, cell) => setSelectedCell({ user, cell })}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedCell && (
          <aside className="org-workload__drawer" aria-label="Contributing tasks">
            <div className="org-workload__drawer-hdr">
              <div>
                <Text size="sm">{selectedCell.user.full_name || selectedCell.user.username}</Text>
                <Text size="sm" variant="muted">
                  {selectedCell.cell.day} · {selectedCell.cell.hours}h /{' '}
                  {selectedCell.cell.capacity_hours}h (
                  {Math.round(selectedCell.cell.utilization_pct)}%)
                </Text>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Close contributing tasks"
                onClick={() => setSelectedCell(null)}
              >
                <Icon name="close" size="sm" />
              </Button>
            </div>
            <div className="org-workload__drawer-body">
              {(selectedCell.cell.contributing_task_ids ?? []).length === 0 ? (
                <Text size="sm" variant="muted">
                  No scheduled tasks contributing on this date.
                </Text>
              ) : (
                (selectedCell.cell.contributing_task_ids ?? []).map((tid) => {
                  const t = tasksById.get(tid);
                  return (
                    <button
                      key={tid}
                      type="button"
                      className={`org-workload__contrib-card ${
                        selectedTaskId === tid ? 'is-selected' : ''
                      }`}
                      onClick={() => onSelectTask(tid)}
                    >
                      <div className="org-workload__contrib-top">
                        <span className="org-workload__mono">
                          {t ? t.task_code : tid.slice(0, 8)}
                        </span>
                        {t && <StatusChip status={t.status} compact />}
                      </div>
                      {t && (
                        <Text size="sm" variant="muted">
                          {t.entity_name} · {t.department_name} · bid {t.bid_hours ?? 0}h / logged{' '}
                          {t.logged_hours}h
                        </Text>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function WorkloadSectionRows({
  sectionTitle,
  colCount,
  rows,
  isWeeks,
  selectedCell,
  onSelectCell,
}: {
  sectionTitle: string;
  colCount: number;
  rows: ReadonlyArray<WorkloadRowSchema>;
  isWeeks: boolean;
  selectedCell: SelectedCellInfo | null;
  onSelectCell: (user: WorkloadRowSchema, cell: WorkloadCellSchema) => void;
}) {
  return (
    <>
      {sectionTitle && (
        <tr className="org-workload__group-tr">
          <th colSpan={colCount} className="org-workload__group-th">
            {sectionTitle} ({rows.length})
          </th>
        </tr>
      )}
      {rows.map((u) => (
        <tr key={u.user_id} className="org-workload__tr">
          <th className="org-workload__td-user">
            <Avatar username={u.username} fullName={u.full_name} size="sm" />
            <span className="org-workload__user-name" title={`${u.full_name} (@${u.username})`}>
              {u.full_name || u.username}
            </span>
            <span className="org-workload__user-cap">{u.daily_capacity_hours}h</span>
          </th>
          {(u.cells ?? []).map((cell) => {
            const tier = utilizationTier(cell.utilization_pct);
            const active =
              selectedCell?.user.user_id === u.user_id && selectedCell.cell.day === cell.day;
            const pctText = cell.utilization_pct > 0 ? `${Math.round(cell.utilization_pct)}%` : '-';
            return (
              <td
                key={cell.day}
                className={`org-workload__cell org-workload__cell--t${tier} ${
                  isWeeks ? 'is-week' : ''
                } ${active ? 'is-active' : ''}`}
              >
                <button
                  type="button"
                  className="org-workload__cell-btn"
                  title={`${u.full_name} · ${cell.day}: ${cell.hours}h / ${cell.capacity_hours}h (${Math.round(cell.utilization_pct)}%)`}
                  onClick={() => onSelectCell(u, cell)}
                >
                  {pctText}
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

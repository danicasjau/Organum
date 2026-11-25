import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  Icon,
  Popover,
  PriorityMarker,
  Stack,
  StatusChip,
  Text,
  TextArea,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type DepartmentOut,
  type EntityOut,
  type TaskBulkResponse,
  type TaskBulkRowIn,
  type TaskListItemOut,
  type UserOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { computeRollupStatus, parseMatrixTsvPaste } from './taskHelpers';
import { useTasksStore } from './tasksStore';
import './DepartmentMatrixView.css';
import { DepartmentTag } from '../departments/DepartmentTag';

interface MatrixColumnDef {
  id: string;
  department: DepartmentOut;
  taskName?: string;
  label: string;
  isExpandedChild: boolean;
}

type MatrixRowEntry =
  | { kind: 'group'; id: string; label: string; count: number }
  | { kind: 'entity'; id: string; entity: EntityOut };

function VirtualMatrixRows({ height, children }: { height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--mx-total-h', `${height}px`);
  return (
    <div ref={ref} className="org-matrix__vbody">
      {children}
    </div>
  );
}

function VirtualMatrixRowSlot({
  start,
  isGroup,
  children,
}: {
  start: number;
  isGroup: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--mx-offset', `${start}px`);
  return (
    <div
      ref={ref}
      role="row"
      className={isGroup ? 'org-matrix__row org-matrix__row--group' : 'org-matrix__row'}
    >
      {children}
    </div>
  );
}

export function DepartmentMatrixView({
  tasks,
  entities,
  departments,
  users,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ReadonlyArray<TaskListItemOut>;
  entities: ReadonlyArray<EntityOut>;
  departments: ReadonlyArray<DepartmentOut>;
  users: ReadonlyArray<UserOut>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const groupBy = useTasksStore((s) => s.matrixGroupBy);
  const setGroupBy = useTasksStore((s) => s.setMatrixGroupBy);
  const hiddenDeptIds = useTasksStore((s) => s.hiddenMatrixDeptIds);
  const setHiddenDeptIds = useTasksStore((s) => s.setHiddenMatrixDeptIds);
  const hiddenEntityIds = useTasksStore((s) => s.hiddenMatrixEntityIds);
  const setHiddenEntityIds = useTasksStore((s) => s.setHiddenMatrixEntityIds);
  const expandedDeptIds = useTasksStore((s) => s.expandedMatrixDeptIds);
  const toggleExpandedDept = useTasksStore((s) => s.toggleExpandedMatrixDept);
  const matrixUndoStack = useTasksStore((s) => s.matrixUndoStack);
  const pushMatrixUndo = useTasksStore((s) => s.pushMatrixUndo);
  const popMatrixUndo = useTasksStore((s) => s.popMatrixUndo);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [anchorCoord, setAnchorCoord] = useState<{ row: number; col: number } | null>(null);
  const [rangeEndCoord, setRangeEndCoord] = useState<{ row: number; col: number } | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTsv, setPasteTsv] = useState('');
  const [previewResp, setPreviewResp] = useState<TaskBulkResponse | null>(null);
  const [pendingRows, setPendingRows] = useState<TaskBulkRowIn[]>([]);
  const [pendingUndoRows, setPendingUndoRows] = useState<TaskBulkRowIn[]>([]);
  const [busyBulk, setBusyBulk] = useState(false);

  // Tasks indexed by entityId -> departmentId -> tasks[]
  const taskIndex = useMemo(() => {
    const map = new Map<string, Map<string, TaskListItemOut[]>>();
    for (const t of tasks) {
      if (!map.has(t.entity_id)) map.set(t.entity_id, new Map());
      const byDept = map.get(t.entity_id)!;
      if (!byDept.has(t.department_id)) byDept.set(t.department_id, []);
      byDept.get(t.department_id)!.push(t);
    }
    return map;
  }, [tasks]);

  const visibleEntityIdsFromTasks = useMemo(() => new Set(tasks.map((t) => t.entity_id)), [tasks]);

  const visibleEntities = useMemo(() => {
    const base =
      visibleEntityIdsFromTasks.size > 0
        ? entities.filter((e) => visibleEntityIdsFromTasks.has(e.id))
        : entities;
    return base.filter((e) => !hiddenEntityIds.includes(e.id));
  }, [entities, visibleEntityIdsFromTasks, hiddenEntityIds]);

  const visibleDepts = useMemo(
    () => departments.filter((d) => d.is_active && !hiddenDeptIds.includes(d.id)),
    [departments, hiddenDeptIds],
  );

  // Distinct task names per department when expanded
  const columns = useMemo<MatrixColumnDef[]>(() => {
    const cols: MatrixColumnDef[] = [];
    for (const dept of visibleDepts) {
      if (!expandedDeptIds.includes(dept.id)) {
        cols.push({
          id: dept.id,
          department: dept,
          label: dept.name,
          isExpandedChild: false,
        });
      } else {
        const names = new Set<string>();
        for (const t of tasks) {
          if (t.department_id === dept.id) names.add(t.name);
        }
        const sortedNames = names.size > 0 ? Array.from(names).sort() : ['main'];
        for (const tName of sortedNames) {
          cols.push({
            id: `${dept.id}:${tName}`,
            department: dept,
            taskName: tName,
            label: `${dept.short_code || dept.name} / ${tName}`,
            isExpandedChild: true,
          });
        }
      }
    }
    return cols;
  }, [visibleDepts, expandedDeptIds, tasks]);

  const matrixRows = useMemo<MatrixRowEntry[]>(() => {
    const grouped = new Map<string, EntityOut[]>();
    for (const ent of visibleEntities) {
      let grp = 'Root';
      if (groupBy === 'type') {
        grp = ent.entity_type?.trim() || 'Untyped';
      } else {
        const parts = (ent.rel_path ?? '').split('/').filter(Boolean);
        grp = parts.length > 1 ? parts.slice(0, -1).join(' ▸ ') : 'Root';
      }
      if (!grouped.has(grp)) grouped.set(grp, []);
      grouped.get(grp)!.push(ent);
    }

    const out: MatrixRowEntry[] = [];
    for (const grp of Array.from(grouped.keys()).sort()) {
      const list = grouped.get(grp)!.sort((a, b) => a.name.localeCompare(b.name));
      out.push({ kind: 'group', id: `grp:${grp}`, label: grp, count: list.length });
      if (!collapsedGroups[grp]) {
        for (const ent of list) {
          out.push({ kind: 'entity', id: ent.id, entity: ent });
        }
      }
    }
    return out;
  }, [visibleEntities, groupBy, collapsedGroups]);

  const entityRowIds = useMemo(
    () =>
      matrixRows
        .filter((r): r is Extract<MatrixRowEntry, { kind: 'entity' }> => r.kind === 'entity')
        .map((r) => r.entity.id),
    [matrixRows],
  );

  const entityIndexByRowIdx = useMemo(() => {
    const m = new Map<number, number>();
    let eIdx = 0;
    matrixRows.forEach((r, idx) => {
      if (r.kind === 'entity') {
        m.set(idx, eIdx);
        eIdx += 1;
      }
    });
    return m;
  }, [matrixRows]);

  const lookupCellTasks = (entityId: string, deptId: string, taskName?: string) => {
    const list = taskIndex.get(entityId)?.get(deptId) ?? [];
    if (!taskName) return list;
    return list.filter((t) => t.name === taskName);
  };

  const usernameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.username.toLowerCase(), u.id);
    return m;
  }, [users]);

  const isCellInSelection = (rowIdx: number, colIdx: number) => {
    if (!anchorCoord) return false;
    const end = rangeEndCoord ?? anchorCoord;
    const rMin = Math.min(anchorCoord.row, end.row);
    const rMax = Math.max(anchorCoord.row, end.row);
    const cMin = Math.min(anchorCoord.col, end.col);
    const cMax = Math.max(anchorCoord.col, end.col);
    return rowIdx >= rMin && rowIdx <= rMax && colIdx >= cMin && colIdx <= cMax;
  };

  const buildSelectedTsv = (): string => {
    const startR = anchorCoord ? Math.min(anchorCoord.row, (rangeEndCoord ?? anchorCoord).row) : 0;
    const endR = anchorCoord
      ? Math.max(anchorCoord.row, (rangeEndCoord ?? anchorCoord).row)
      : Math.max(0, entityRowIds.length - 1);
    const startC = anchorCoord ? Math.min(anchorCoord.col, (rangeEndCoord ?? anchorCoord).col) : 0;
    const endC = anchorCoord
      ? Math.max(anchorCoord.col, (rangeEndCoord ?? anchorCoord).col)
      : Math.max(0, columns.length - 1);

    const lines: string[] = [];
    for (let r = startR; r <= endR; r++) {
      const eid = entityRowIds[r];
      if (!eid) continue;
      const vals: string[] = [];
      for (let c = startC; c <= endC; c++) {
        const col = columns[c];
        if (!col) continue;
        const cellTasks = lookupCellTasks(eid, col.department.id, col.taskName);
        if (cellTasks.length === 0) vals.push('');
        else if (cellTasks.length === 1) vals.push(cellTasks[0]!.status);
        else vals.push(computeRollupStatus(cellTasks.map((t) => t.status)));
      }
      lines.push(vals.join('\t'));
    }
    return lines.join('\n');
  };

  const handleCopyTsv = async () => {
    const tsv = buildSelectedTsv();
    if (!tsv) return;
    try {
      await navigator.clipboard.writeText(tsv);
      toast.push('info', 'Copied selected matrix cells as TSV');
    } catch {
      toast.push('info', 'TSV ready (clipboard blocked by browser)');
    }
  };

  const runPreview = async (tsvText: string) => {
    const startR = anchorCoord?.row ?? 0;
    const startC = anchorCoord?.col ?? 0;
    const parsed = parseMatrixTsvPaste(
      tsvText,
      startR,
      startC,
      entityRowIds,
      columns.map((c) => ({ departmentId: c.department.id, taskName: c.taskName })),
      (eid, did, tName) => lookupCellTasks(eid, did, tName)[0],
      usernameMap,
    );
    if (parsed.rows.length === 0) {
      toast.push('warning', 'No recognized status / priority / @username tokens matched cells');
      return;
    }
    setBusyBulk(true);
    try {
      const res = await apiClient.bulkTasks(
        { dry_run: true, rows: parsed.rows },
        activeProjectUuid,
      );
      setPendingRows(parsed.rows);
      setPendingUndoRows(parsed.undoRows);
      setPreviewResp(res);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Bulk preview failed');
    } finally {
      setBusyBulk(false);
    }
  };

  const handleApplyPaste = async () => {
    if (pendingRows.length === 0) return;
    setBusyBulk(true);
    try {
      const res = await apiClient.bulkTasks(
        { dry_run: false, rows: pendingRows },
        activeProjectUuid,
      );
      if (!res.applied) {
        setPreviewResp(res);
        toast.push('danger', `Bulk paste aborted (${res.error_count} errors)`);
        return;
      }
      pushMatrixUndo(pendingUndoRows);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid] }),
      ]);
      toast.push('success', `Applied ${res.ok_count} matrix updates`);
      setPasteOpen(false);
      setPreviewResp(null);
      setPasteTsv('');
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Bulk apply failed');
    } finally {
      setBusyBulk(false);
    }
  };

  const handleUndo = async () => {
    const prevRows = popMatrixUndo();
    if (!prevRows || prevRows.length === 0) return;
    try {
      const res = await apiClient.bulkTasks({ dry_run: false, rows: prevRows }, activeProjectUuid);
      if (res.applied) {
        await queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] });
        toast.push('info', `Reverted ${res.ok_count} matrix updates`);
      } else {
        toast.push('warning', 'Unable to undo all matrix changes');
      }
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Undo failed');
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && matrixUndoStack.length > 0) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          void handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matrixUndoStack.length]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const vizer = useVirtualizer({
    count: matrixRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  return (
    <div
      className="org-matrix"
      data-ui="department-matrix-view"
      onPaste={(e) => {
        const txt = e.clipboardData.getData('text/plain');
        if (txt && anchorCoord) {
          e.preventDefault();
          setPasteTsv(txt);
          setPasteOpen(true);
          void runPreview(txt);
        }
      }}
    >
      <div className="org-matrix__toolbar">
        <div className="org-matrix__tool-group">
          <Button
            size="sm"
            variant="toggle"
            pressed={groupBy === 'path'}
            onClick={() => setGroupBy('path')}
          >
            Path Hierarchy
          </Button>
          <Button
            size="sm"
            variant="toggle"
            pressed={groupBy === 'type'}
            onClick={() => setGroupBy('type')}
          >
            Entity Type
          </Button>
          <Popover
            open={chooserOpen}
            onOpenChange={setChooserOpen}
            trigger={<Button size="sm">Show/Hide</Button>}
          >
            <div className="org-matrix__chooser">
              <Text size="sm" variant="accent">
                Departments
              </Text>
              {departments.map((d) => (
                <Checkbox
                  key={d.id}
                  label={d.name}
                  checked={!hiddenDeptIds.includes(d.id)}
                  onChange={(chk) =>
                    setHiddenDeptIds(
                      chk ? hiddenDeptIds.filter((x) => x !== d.id) : [...hiddenDeptIds, d.id],
                    )
                  }
                />
              ))}
              <Text size="sm" variant="accent">
                Entities ({entities.length})
              </Text>
              {entities.slice(0, 40).map((e) => (
                <Checkbox
                  key={e.id}
                  label={e.name}
                  checked={!hiddenEntityIds.includes(e.id)}
                  onChange={(chk) =>
                    setHiddenEntityIds(
                      chk ? hiddenEntityIds.filter((x) => x !== e.id) : [...hiddenEntityIds, e.id],
                    )
                  }
                />
              ))}
            </div>
          </Popover>
        </div>

        <div className="org-matrix__tool-group">
          <Button size="sm" onClick={() => void handleCopyTsv()}>
            Copy TSV
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setPreviewResp(null);
              setPasteOpen(true);
            }}
          >
            Paste TSV…
          </Button>
          {matrixUndoStack.length > 0 && (
            <Button size="sm" onClick={() => void handleUndo()}>
              Undo Paste ({matrixUndoStack.length})
            </Button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="org-matrix__scroll"
        role="grid"
        aria-label="Department entity matrix"
      >
        <div className="org-matrix__thead" role="rowgroup">
          <div className="org-matrix__hdr-row" role="row">
            <div className="org-matrix__corner" role="columnheader">
              Entity ({entityRowIds.length})
            </div>
            {columns.map((col) => (
              <div
                key={col.id}
                role="columnheader"
                className={
                  col.isExpandedChild ? 'org-matrix__dth org-matrix__dth--sub' : 'org-matrix__dth'
                }
              >
                <span className="org-matrix__dth-label" title={col.label}>
                  <DepartmentTag
                    id={col.department.id}
                    name={col.department.name}
                    color={col.department.color}
                    label={col.label}
                    variant="text"
                  />
                </span>
                {!col.isExpandedChild ? (
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label={`Expand ${col.department.name}`}
                    onClick={() => toggleExpandedDept(col.department.id)}
                  >
                    <Icon name="plus" size="sm" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label={`Collapse ${col.department.name}`}
                    onClick={() => toggleExpandedDept(col.department.id)}
                  >
                    <Icon name="minus" size="sm" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        <VirtualMatrixRows height={vizer.getTotalSize()}>
          {vizer.getVirtualItems().map((vRow) => {
            const entry = matrixRows[vRow.index]!;
            if (entry.kind === 'group') {
              const rawGrp = entry.id.slice(4);
              const isCollapsed = Boolean(collapsedGroups[rawGrp]);
              return (
                <VirtualMatrixRowSlot key={entry.id} start={vRow.start} isGroup>
                  <button
                    type="button"
                    className="org-matrix__grp-btn"
                    onClick={() => setCollapsedGroups((p) => ({ ...p, [rawGrp]: !p[rawGrp] }))}
                  >
                    <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size="sm" />
                    <span>{entry.label}</span>
                    <Badge tone="neutral">{entry.count}</Badge>
                  </button>
                </VirtualMatrixRowSlot>
              );
            }

            const eIdx = entityIndexByRowIdx.get(vRow.index) ?? 0;
            const ent = entry.entity;
            return (
              <VirtualMatrixRowSlot key={ent.id} start={vRow.start} isGroup={false}>
                <div className="org-matrix__ent-cell" title={ent.rel_path}>
                  <span className="org-matrix__ent-name">{ent.name}</span>
                  {ent.entity_type && <Badge tone="accent">{ent.entity_type}</Badge>}
                </div>
                {columns.map((col, cIdx) => {
                  const cellTasks = lookupCellTasks(ent.id, col.department.id, col.taskName);
                  const primary = cellTasks[0];
                  const selected = isCellInSelection(eIdx, cIdx);
                  const activeTask = primary && primary.id === selectedTaskId;
                  const rollup = computeRollupStatus(cellTasks.map((t) => t.status));
                  const assignees = cellTasks.flatMap((t) => t.assignments ?? []).slice(0, 2);
                  const dueTooltip = cellTasks
                    .map((t) => `${t.task_code}: ${t.status} (Due ${t.ideal_finish_date ?? '—'})`)
                    .join('\n');

                  return (
                    <div
                      key={`${ent.id}-${col.id}`}
                      role="gridcell"
                      tabIndex={0}
                      data-selected={selected ? 'true' : undefined}
                      data-active-task={activeTask ? 'true' : undefined}
                      title={dueTooltip}
                      className={
                        col.isExpandedChild
                          ? 'org-matrix__cell org-matrix__cell--sub'
                          : 'org-matrix__cell'
                      }
                      onClick={(e) => {
                        if (e.shiftKey && anchorCoord) {
                          setRangeEndCoord({ row: eIdx, col: cIdx });
                        } else {
                          setAnchorCoord({ row: eIdx, col: cIdx });
                          setRangeEndCoord(null);
                        }
                        if (primary) onSelectTask(primary.id);
                      }}
                    >
                      {cellTasks.length === 0 ? (
                        <Text size="sm" variant="muted">
                          —
                        </Text>
                      ) : (
                        <>
                          <StatusChip status={rollup} compact />
                          {primary?.priority && primary.priority !== 'normal' && (
                            <PriorityMarker priority={primary.priority} />
                          )}
                          <div className="org-matrix__cell-avs">
                            {assignees.map((a) => (
                              <Avatar
                                key={`${a.user_id}-${a.assignment_role}`}
                                username={a.username}
                                fullName={a.full_name}
                                size="sm"
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </VirtualMatrixRowSlot>
            );
          })}
        </VirtualMatrixRows>
      </div>

      <Dialog
        wide
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        title="Bulk Paste (TSV) — Preview & Apply"
        footer={
          <>
            <Button onClick={() => setPasteOpen(false)} disabled={busyBulk}>
              Cancel
            </Button>
            <Button
              onClick={() => void runPreview(pasteTsv)}
              disabled={busyBulk || !pasteTsv.trim()}
            >
              Preview Changes
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleApplyPaste()}
              disabled={
                busyBulk || !previewResp || previewResp.error_count > 0 || pendingRows.length === 0
              }
            >
              Apply ({previewResp?.ok_count ?? 0})
            </Button>
          </>
        }
      >
        <Stack gap="2">
          <Text size="sm" variant="muted">
            Paste tab-separated cells starting at row {(anchorCoord?.row ?? 0) + 1}, col{' '}
            {(anchorCoord?.col ?? 0) + 1}. Accepted values: status code (e.g. IP, APP, HLD),
            priority (normal, high, stopper), or @username.
          </Text>
          <TextArea
            aria-label="TSV paste input"
            rows={4}
            placeholder={'IP\thigh\nAPP\t@art_sam'}
            value={pasteTsv}
            onChange={(e) => {
              setPasteTsv(e.target.value);
              setPreviewResp(null);
            }}
          />
          {previewResp && (
            <Stack gap="1">
              <Banner severity={previewResp.error_count > 0 ? 'danger' : 'success'}>
                Preview: {previewResp.ok_count} valid, {previewResp.error_count} error(s)
                (all-or-nothing)
              </Banner>
              <div className="org-matrix__preview-list">
                {(previewResp.results ?? []).map((r) => (
                  <div
                    key={`${r.task_id}-${(r.changes ?? []).join(',')}`}
                    className="org-matrix__prev-row"
                  >
                    <span className="org-matrix__mono">{r.task_code || r.task_id}</span>
                    {r.ok ? (
                      <Badge tone="success">{(r.changes ?? []).join(', ')}</Badge>
                    ) : (
                      <Badge tone="danger">{r.error ?? 'Invalid'}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </Stack>
          )}
        </Stack>
      </Dialog>
    </div>
  );
}

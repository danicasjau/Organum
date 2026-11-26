import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  ColorPicker,
  ConfirmDialog,
  Icon,
  InlineEdit,
  SortableList,
  Text,
  TextField,
  useToast,
} from '../../components/ui';
import { apiClient, type DepartmentOut } from '../../lib/api/client';
import { deptColorHex } from '../departments/deptColors';
import './DepartmentsSettings.css';

const EMPTY: DepartmentOut[] = [];
type DefaultTask = NonNullable<DepartmentOut['default_tasks']>[number];

const errMsg = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** Short codes: 2-4 upper-case letters or digits, unique across departments. */
export function validateShortCode(
  draft: string,
  departments: ReadonlyArray<DepartmentOut>,
  selfId: string,
): string | null {
  const code = draft.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(code)) return '2-4 letters or digits';
  if (departments.some((d) => d.id !== selfId && d.short_code.toUpperCase() === code)) {
    return `Code ${code} is already used`;
  }
  return null;
}

/**
 * CR04 §12: compact department catalog editor. Inline add / rename / short code / colour,
 * drag-and-drop ordering (departments and their default tasks), search, delete with confirm.
 * "Delete" archives the department (data stays recoverable); archived ones can be restored.
 */
export function DepartmentsSettings({ projectUuid }: { projectUuid: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = ['departments', projectUuid];
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiClient.listDepartments(projectUuid),
  });
  const departments = data ?? EMPTY;

  const [search, setSearch] = useState('');
  const [hideArchived, setHideArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDept, setNewDept] = useState('');
  const [newTask, setNewTask] = useState('');
  const [confirmDept, setConfirmDept] = useState<DepartmentOut | null>(null);
  const [confirmTask, setConfirmTask] = useState<DefaultTask | null>(null);
  const [colorDrafts, setColorDrafts] = useState<Record<string, string>>({});
  const colorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey });
  };

  /** Optimistically reorder the cached list so drops feel instant. */
  const setCachedOrder = (ids: string[]) => {
    queryClient.setQueryData<DepartmentOut[]>(queryKey, (prev) =>
      prev ? ids.map((id) => prev.find((d) => d.id === id)!).filter(Boolean) : prev,
    );
  };

  const q = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      departments.filter(
        (d) =>
          (!hideArchived || d.is_active) &&
          (!q ||
            d.name.toLowerCase().includes(q) ||
            d.short_code.toLowerCase().includes(q) ||
            (d.default_tasks ?? []).some((t) => t.name.toLowerCase().includes(q))),
      ),
    [departments, hideArchived, q],
  );
  const filtering = Boolean(q) || hideArchived;

  useEffect(() => {
    if (visible.length > 0 && !visible.some((d) => d.id === selectedId)) {
      setSelectedId(visible[0]!.id);
    }
  }, [visible, selectedId]);

  const selected = departments.find((d) => d.id === selectedId) ?? null;
  const tasks = selected?.default_tasks ?? [];

  const saveColor = (deptId: string, hex: string) => {
    setColorDrafts((prev) => ({ ...prev, [deptId]: hex }));
    const timers = colorTimers.current;
    if (timers[deptId]) clearTimeout(timers[deptId]);
    timers[deptId] = setTimeout(async () => {
      delete timers[deptId];
      try {
        await apiClient.updateDepartment(deptId, { color: hex }, projectUuid);
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ['tasks', projectUuid] }),
        ]);
      } catch (err) {
        toast.push('danger', errMsg(err, 'Color update failed'));
      } finally {
        setColorDrafts((prev) => {
          const next = { ...prev };
          delete next[deptId];
          return next;
        });
      }
    }, 300);
  };

  const patchDept = async (
    id: string,
    patch: Parameters<typeof apiClient.updateDepartment>[1],
  ) => {
    await apiClient.updateDepartment(id, patch, projectUuid);
    await refresh();
  };

  const addDept = async (e: FormEvent) => {
    e.preventDefault();
    const name = newDept.trim();
    if (!name) return;
    try {
      const created = await apiClient.createDepartment(name, projectUuid);
      setNewDept('');
      await refresh();
      setSelectedId(created.id);
      toast.push('success', `Created department "${created.name}".`);
    } catch (err) {
      toast.push('danger', errMsg(err, 'Unable to create department'));
    }
  };

  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    const name = newTask.trim();
    if (!selected || !name) return;
    try {
      await apiClient.createDefaultTask(selected.id, name, projectUuid);
      setNewTask('');
      await refresh();
    } catch (err) {
      toast.push('danger', errMsg(err, 'Unable to add default task'));
    }
  };

  const reorderDepts = async (ids: string[]) => {
    setCachedOrder(ids);
    try {
      await apiClient.reorderDepartments(ids, projectUuid);
    } catch (err) {
      toast.push('danger', errMsg(err, 'Reorder failed'));
    }
    await refresh();
  };

  const reorderTasks = async (ids: string[]) => {
    if (!selected) return;
    try {
      await apiClient.reorderDefaultTasks(selected.id, ids, projectUuid);
    } catch (err) {
      toast.push('danger', errMsg(err, 'Reorder failed'));
    }
    await refresh();
  };

  return (
    <div className="org-depts" data-ui="departments-settings">
      <Banner severity="info" title="Catalog scope">
        Changes apply only to entities or departments created afterwards.
      </Banner>

      <div className="org-depts__toolbar">
        <TextField
          aria-label="Search departments"
          placeholder="Search departments or tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Checkbox label="Hide archived" checked={hideArchived} onChange={setHideArchived} />
      </div>

      <div className="org-depts__split">
        <section className="org-depts__col" aria-label="Departments">
          <Text size="sm" variant="muted">
            Departments ({visible.length}
            {visible.length !== departments.length ? ` of ${departments.length}` : ''})
            {filtering && ' · clear the search to reorder'}
          </Text>
          <SortableList
            ariaLabel="Departments"
            items={visible}
            disabled={filtering}
            getId={(d) => d.id}
            getLabel={(d) => d.name}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReorder={(ids) => void reorderDepts(ids)}
            renderItem={(d) => (
              <div className="org-depts__row" data-archived={d.is_active ? undefined : 'true'}>
                <span className="org-depts__color" onClick={(e) => e.stopPropagation()}>
                  <ColorPicker
                    ariaLabel={`${d.name} color`}
                    value={colorDrafts[d.id] ?? deptColorHex(d.color)}
                    onChange={(hex) => saveColor(d.id, hex)}
                  />
                </span>
                <InlineEdit
                  className="org-depts__name"
                  ariaLabel={`${d.name} name`}
                  value={d.name}
                  onCommit={(name) => patchDept(d.id, { name })}
                />
                <InlineEdit
                  className="org-depts__code"
                  mono
                  ariaLabel={`${d.name} short code`}
                  value={d.short_code}
                  maxLength={4}
                  validate={(v) => validateShortCode(v, departments, d.id)}
                  onCommit={(code) => patchDept(d.id, { short_code: code.toUpperCase() })}
                />
                <Badge tone="neutral">
                  {(d.default_tasks ?? []).length} task
                  {(d.default_tasks ?? []).length === 1 ? '' : 's'}
                </Badge>
                {d.is_active ? (
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label={`Delete ${d.name}`}
                    title="Delete (archive) department"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDept(d);
                    }}
                  >
                    <Icon name="trash" size="sm" />
                  </Button>
                ) : (
                  <>
                    <Badge tone="neutral">Archived</Badge>
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void patchDept(d.id, { is_active: true });
                      }}
                    >
                      Restore
                    </Button>
                  </>
                )}
              </div>
            )}
          />
          <form className="org-depts__add" onSubmit={(e) => void addDept(e)}>
            <TextField
              aria-label="New department name"
              placeholder="+ Add department (Enter)"
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={!newDept.trim()}>
              Add
            </Button>
          </form>
        </section>

        <section className="org-depts__col" aria-label="Default tasks">
          <Text size="sm" variant="muted">
            Default tasks — {selected?.name ?? 'select a department'} ({tasks.length})
          </Text>
          {selected && tasks.length === 0 && (
            <Text size="sm" variant="muted">
              No default tasks yet.
            </Text>
          )}
          {selected && tasks.length > 0 && (
            <SortableList
              ariaLabel={`Default tasks of ${selected.name}`}
              items={tasks}
              getId={(t) => t.id}
              getLabel={(t) => t.name}
              onReorder={(ids) => void reorderTasks(ids)}
              renderItem={(t) => (
                <div className="org-depts__row">
                  <InlineEdit
                    className="org-depts__name"
                    ariaLabel={`${t.name} task name`}
                    value={t.name}
                    onCommit={async (name) => {
                      await apiClient.updateDefaultTask(t.id, { name }, projectUuid);
                      await refresh();
                    }}
                  />
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label={`Delete default task ${t.name}`}
                    onClick={() => setConfirmTask(t)}
                  >
                    <Icon name="trash" size="sm" />
                  </Button>
                </div>
              )}
            />
          )}
          <form className="org-depts__add" onSubmit={(e) => void addTask(e)}>
            <TextField
              aria-label="New default task name"
              placeholder="+ Add default task (Enter)"
              disabled={!selected}
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={!selected || !newTask.trim()}>
              Add
            </Button>
          </form>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDept)}
        onOpenChange={(o) => !o && setConfirmDept(null)}
        title={`Delete department "${confirmDept?.name ?? ''}"?`}
        onConfirm={async () => {
          if (!confirmDept) return;
          try {
            await apiClient.deleteDepartment(confirmDept.id, projectUuid);
            await refresh();
            toast.push('success', `Archived "${confirmDept.name}". Use Restore to undo.`);
          } catch (err) {
            toast.push('danger', errMsg(err, 'Delete failed'));
          }
        }}
      >
        <Text>
          The department is removed from the catalog and new entities. Existing folders, tasks
          and history are kept, and you can restore it later from this list.
        </Text>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(confirmTask)}
        onOpenChange={(o) => !o && setConfirmTask(null)}
        title={`Delete default task "${confirmTask?.name ?? ''}"?`}
        onConfirm={async () => {
          if (!confirmTask) return;
          try {
            await apiClient.deleteDefaultTask(confirmTask.id, projectUuid);
            await refresh();
          } catch (err) {
            toast.push('danger', errMsg(err, 'Delete failed'));
          }
        }}
      >
        <Text>
          New entities will no longer get this task. Tasks that already exist are not changed.
        </Text>
      </ConfirmDialog>
    </div>
  );
}

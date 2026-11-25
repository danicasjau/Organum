import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Avatar,
  Button,
  CapacityBadgeList,
  ContextMenu,
  Dialog,
  Icon,
  Inline,
  Select,
  Stack,
  Text,
  useToast,
} from '../../components/ui';
import {
  apiClient,
  type DepartmentOut,
  type EntityDepartmentOut,
  type EntityOut,
  type TaskOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { ConfirmTrashDialog, PromptNameDialog } from './EntityDialogs';
import './DeptTaskColumn.css';

export function DeptTaskColumn({
  entity,
  catalogDepartments,
  selectedTaskId,
  onSelectTask,
  addDeptDialogOpen,
  onAddDeptDialogOpenChange,
}: {
  entity: EntityOut | null;
  catalogDepartments: ReadonlyArray<DepartmentOut>;
  selectedTaskId: string | null;
  onSelectTask: (deptId: string, taskId: string) => void;
  addDeptDialogOpen: boolean;
  onAddDeptDialogOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const openSettings = useProjectStore((s) => s.openSettings);

  const [collapsedDepts, setCollapsedDepts] = useState<Record<string, boolean>>({});
  const [newTaskForEd, setNewTaskForEd] = useState<EntityDepartmentOut | null>(null);
  const [renamingTask, setRenamingTask] = useState<TaskOut | null>(null);
  const [deletingTask, setDeletingTask] = useState<{ dept: EntityDepartmentOut; task: TaskOut } | null>(null);
  const [pickDeptId, setPickDeptId] = useState('');

  const refreshTree = async () => {
    await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
  };

  if (!entity) {
    return (
      <div className="org-dtcol">
        <div className="org-dtcol__header">
          <Text size="sm">Departments &amp; Tasks</Text>
        </div>
        <Stack padding="3">
          <Text size="sm" variant="muted">
            Select an entity in Column 1.
          </Text>
        </Stack>
      </div>
    );
  }

  const attachedIds = new Set((entity.departments ?? []).map((d) => d.department_id));
  const availableToAdd = catalogDepartments.filter((d) => d.is_active && !attachedIds.has(d.id));

  return (
    <div className="org-dtcol" aria-label="Departments and tasks">
      <div className="org-dtcol__header">
        <Text size="sm">
          Depts / Tasks — {entity.name}
        </Text>
        <Button
          size="sm"
          disabled={availableToAdd.length === 0}
          title="Add department to entity"
          onClick={() => {
            setPickDeptId(availableToAdd[0]?.id ?? '');
            onAddDeptDialogOpenChange(true);
          }}
        >
          <Icon name="plus" size="sm" /> Dept
        </Button>
      </div>

      <div className="org-dtcol__list" role="tree" aria-label="Entity departments and tasks">
        {(entity.departments ?? []).map((ed) => {
          const isCollapsed = Boolean(collapsedDepts[ed.id]);
          return (
            <div key={ed.id} className="org-dtcol__dept-block">
              <ContextMenu
                items={[
                  {
                    id: 'new-task',
                    label: 'New Task...',
                    onSelect: () => setNewTaskForEd(ed),
                  },
                  {
                    id: 'manage-defaults',
                    label: 'Manage Default Tasks...',
                    onSelect: () => openSettings('departments'),
                  },
                  {
                    id: 'reveal-dept',
                    label: 'Reveal in File Manager',
                    onSelect: async () => {
                      await apiClient.revealPath(
                        `${entity.rel_path}/${ed.folder_name}`,
                        activeProjectUuid,
                      );
                    },
                  },
                  { id: 'sep', label: '', separator: true },
                  {
                    id: 'remove-dept',
                    label: 'Remove Department (keep files)',
                    onSelect: async () => {
                      await apiClient.removeEntityDepartment(ed.id, activeProjectUuid);
                      await refreshTree();
                      toast.push('info', `Detached '${ed.name}' (disk files kept)`);
                    },
                  },
                ]}
              >
                <div
                  role="treeitem"
                  aria-expanded={!isCollapsed}
                  className="org-dtcol__dept-row"
                  onClick={() =>
                    setCollapsedDepts((prev) => ({ ...prev, [ed.id]: !prev[ed.id] }))
                  }
                >
                  <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size="sm" />
                  <Icon name="folder" size="sm" />
                  <span className="org-dtcol__label">{ed.name}</span>
                  <Button
                    variant="icon"
                    size="sm"
                    aria-label={`New task in ${ed.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewTaskForEd(ed);
                    }}
                  >
                    <Icon name="plus" size="sm" />
                  </Button>
                </div>
              </ContextMenu>

              {!isCollapsed &&
                (ed.tasks ?? []).map((task) => {
                  const selected = task.id === selectedTaskId;
                  return (
                    <ContextMenu
                      key={task.id}
                      items={[
                        {
                          id: 'rename',
                          label: 'Rename Task...',
                          onSelect: () => setRenamingTask(task),
                        },
                        {
                          id: 'reveal',
                          label: 'Reveal in File Manager',
                          onSelect: async () => {
                            await apiClient.revealPath(
                              `${entity.rel_path}/${ed.folder_name}/${task.folder_name}`,
                              activeProjectUuid,
                            );
                          },
                        },
                        { id: 'sep', label: '', separator: true },
                        {
                          id: 'delete',
                          label: 'Delete Task...',
                          onSelect: () => setDeletingTask({ dept: ed, task }),
                        },
                      ]}
                    >
                      <button
                        type="button"
                        role="treeitem"
                        aria-selected={selected}
                        data-task-id={task.id}
                        data-selected={selected ? 'true' : undefined}
                        className="org-dtcol__task-row"
                        onClick={() => onSelectTask(ed.id, task.id)}
                      >
                        <Icon name="layers" size="sm" />
                        <span className="org-dtcol__label">{task.name}</span>
                        <CapacityBadgeList capacities={task.my_capacities ?? []} />
                        {(task.assignments ?? []).slice(0, 2).map((a) => (
                          <Avatar
                            key={`${a.user_id}-${a.assignment_role}`}
                            username={a.username}
                            fullName={`${a.full_name} (${a.assignment_role})`}
                            size="sm"
                          />
                        ))}
                        <Text size="sm" variant="muted">
                          {task.product?.versions?.length ?? 0}v
                        </Text>
                      </button>
                    </ContextMenu>
                  );
                })}
            </div>
          );
        })}

        {availableToAdd.length > 0 && (
          <button
            type="button"
            className="org-dtcol__add-row"
            onClick={() => {
              setPickDeptId(availableToAdd[0]?.id ?? '');
              onAddDeptDialogOpenChange(true);
            }}
          >
            <Icon name="plus" size="sm" />
            <span>Add Department...</span>
          </button>
        )}
      </div>

      <Dialog
        open={addDeptDialogOpen}
        onOpenChange={onAddDeptDialogOpenChange}
        title={`Add Department to ${entity.name}`}
        footer={
          <>
            <Button onClick={() => onAddDeptDialogOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!pickDeptId}
              onClick={async () => {
                if (!pickDeptId) return;
                try {
                  await apiClient.addEntityDepartment(entity.id, pickDeptId, activeProjectUuid);
                  await refreshTree();
                  onAddDeptDialogOpenChange(false);
                  toast.push('success', 'Department added');
                } catch (err) {
                  toast.push('danger', err instanceof Error ? err.message : 'Failed');
                }
              }}
            >
              Add Department
            </Button>
          </>
        }
      >
        <Stack gap="2">
          {availableToAdd.length === 0 ? (
            <Inline gap="2">
              <Text size="sm" variant="muted">
                All active departments are already attached.
              </Text>
              <Button size="sm" onClick={() => openSettings('departments')}>
                Edit Catalog
              </Button>
            </Inline>
          ) : (
            <Select
              ariaLabel="Department from catalog"
              value={pickDeptId || availableToAdd[0]!.id}
              onChange={setPickDeptId}
              options={availableToAdd.map((d) => ({ value: d.id, label: d.name }))}
              filterable={false}
            />
          )}
        </Stack>
      </Dialog>

      <PromptNameDialog
        open={Boolean(newTaskForEd)}
        onOpenChange={(open) => {
          if (!open) setNewTaskForEd(null);
        }}
        title={newTaskForEd ? `New Task — ${newTaskForEd.name}` : 'New Task'}
        label="Task name"
        confirmLabel="Create Task"
        onConfirm={async (name) => {
          if (!newTaskForEd) return;
          const created = await apiClient.createTask(newTaskForEd.id, name, activeProjectUuid);
          await refreshTree();
          onSelectTask(newTaskForEd.id, created.id);
          toast.push('success', `Created task '${created.name}'`);
        }}
      />

      <PromptNameDialog
        open={Boolean(renamingTask)}
        onOpenChange={(open) => {
          if (!open) setRenamingTask(null);
        }}
        title="Rename Task"
        label="New task name"
        initialValue={renamingTask?.name ?? ''}
        confirmLabel="Rename"
        onConfirm={async (newName) => {
          if (!renamingTask) return;
          await apiClient.updateTask(renamingTask.id, { name: newName }, activeProjectUuid);
          await refreshTree();
          toast.push('success', `Renamed task to '${newName}'`);
        }}
      />

      <ConfirmTrashDialog
        open={Boolean(deletingTask)}
        onOpenChange={(open) => {
          if (!open) setDeletingTask(null);
        }}
        title="Delete Task"
        message={
          deletingTask
            ? `Move task '${deletingTask.dept.name}/${deletingTask.task.name}' and its files to 00_Pipeline/trash/?`
            : ''
        }
        onConfirm={async () => {
          if (!deletingTask) return;
          await apiClient.deleteTask(deletingTask.task.id, activeProjectUuid);
          await refreshTree();
          toast.push('info', `Moved task '${deletingTask.task.name}' to trash`);
        }}
      />
    </div>
  );
}


import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Button,
  Icon,
  Popover,
  SearchField,
  Select,
  Stack,
  Text,
  TextField,
  useToast,
} from '../../components/ui';
import {
  apiClient,
  type CompanyOut,
  type DepartmentOut,
  type SavedViewOut,
  type UserOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { ALL_WORKFLOW_STATUSES, PRIORITY_OPTIONS } from './taskHelpers';
import { useTasksStore, type TasksWorkspaceView } from './tasksStore';
import './TaskFilterBar.css';

const EMPTY_VIEWS: SavedViewOut[] = [];

export function TaskFilterBar({
  departments,
  users,
  companies,
  isClient,
  activeView,
}: {
  departments: ReadonlyArray<DepartmentOut>;
  users: ReadonlyArray<UserOut>;
  companies: ReadonlyArray<CompanyOut>;
  isClient: boolean;
  activeView: TasksWorkspaceView;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const filters = useTasksStore((s) => s.filters);
  const setFilters = useTasksStore((s) => s.setFilters);
  const resetFilters = useTasksStore((s) => s.resetFilters);
  const applyViewConfig = useTasksStore((s) => s.applyViewConfig);
  const hiddenGridCols = useTasksStore((s) => s.hiddenGridCols);
  const hiddenMatrixDeptIds = useTasksStore((s) => s.hiddenMatrixDeptIds);
  const hiddenMatrixEntityIds = useTasksStore((s) => s.hiddenMatrixEntityIds);
  const expandedMatrixDeptIds = useTasksStore((s) => s.expandedMatrixDeptIds);
  const matrixGroupBy = useTasksStore((s) => s.matrixGroupBy);
  const kanbanSwimlane = useTasksStore((s) => s.kanbanSwimlane);

  const [moreOpen, setMoreOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState('');

  const { data: savedViewsData } = useQuery({
    queryKey: ['saved-views', activeProjectUuid, activeView],
    queryFn: () => apiClient.listSavedViews(activeView, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && !isClient),
  });
  const savedViews = savedViewsData ?? EMPTY_VIEWS;

  const hasActiveFilters = Boolean(
    filters.q ||
      filters.status ||
      filters.priority ||
      filters.department_id ||
      filters.company_id ||
      filters.user_id ||
      filters.my_capacity ||
      filters.mine_only ||
      filters.include_linked_entities ||
      filters.entity_path_prefix ||
      filters.tag ||
      filters.date_from ||
      filters.date_to,
  );

  const handleSaveView = async () => {
    const name = viewName.trim();
    if (!name) return;
    try {
      await apiClient.createSavedView(
        {
          view_kind: activeView,
          name,
          config_json: {
            filters,
            hiddenGridCols,
            hiddenMatrixDeptIds,
            hiddenMatrixEntityIds,
            expandedMatrixDeptIds,
            matrixGroupBy,
            kanbanSwimlane,
          },
        },
        activeProjectUuid,
      );
      setViewName('');
      await queryClient.invalidateQueries({ queryKey: ['saved-views', activeProjectUuid] });
      toast.push('success', `Saved view '${name}'`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Unable to save view');
    }
  };

  return (
    <div className="org-tfilter" data-ui="task-filterbar">
      <div className="org-tfilter__search">
        <SearchField
          ariaLabel="Search tasks"
          placeholder="Search code, task, entity..."
          value={filters.q ?? ''}
          onChange={(q) => setFilters({ q: q || undefined })}
        />
      </div>

      <div className="org-tfilter__sel">
        <Select
          ariaLabel="Filter status"
          value={filters.status ?? ''}
          onChange={(v) => setFilters({ status: v || undefined })}
          options={[
            { value: '', label: 'All Statuses' },
            ...ALL_WORKFLOW_STATUSES.map((s) => ({ value: s, label: s })),
          ]}
        />
      </div>

      {!isClient && (
        <div className="org-tfilter__sel">
          <Select
            ariaLabel="Filter priority"
            value={filters.priority ?? ''}
            onChange={(v) => setFilters({ priority: v || undefined })}
            options={[
              { value: '', label: 'All Priority' },
              ...PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label })),
            ]}
          />
        </div>
      )}

      <div className="org-tfilter__sel">
        <Select
          ariaLabel="Filter department"
          value={filters.department_id ?? ''}
          onChange={(v) => setFilters({ department_id: v || undefined })}
          options={[
            { value: '', label: 'All Depts' },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </div>

      {!isClient && companies.length > 0 && (
        <div className="org-tfilter__sel">
          <Select
            ariaLabel="Filter company"
            value={filters.company_id ?? ''}
            onChange={(v) => setFilters({ company_id: v || undefined })}
            options={[
              { value: '', label: 'All Companies' },
              ...companies.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      )}

      {!isClient && users.length > 0 && (
        <div className="org-tfilter__sel">
          <Select
            ariaLabel="Filter user"
            value={filters.user_id ?? ''}
            onChange={(v) => setFilters({ user_id: v || undefined })}
            options={[
              { value: '', label: 'All Assignees' },
              ...users.map((u) => ({ value: u.id, label: u.full_name })),
            ]}
          />
        </div>
      )}

      {!isClient && (
        <div className="org-tfilter__sel">
          <Select
            ariaLabel="Filter my capacity"
            value={filters.my_capacity ?? ''}
            onChange={(v) =>
              setFilters({
                my_capacity: v
                  ? (v as 'artist' | 'lead' | 'supervisor')
                  : undefined,
              })
            }
            options={[
              { value: '', label: 'My Cap: Any' },
              { value: 'artist', label: 'DO (Artist)' },
              { value: 'lead', label: 'LEAD' },
              { value: 'supervisor', label: 'SUP' },
            ]}
          />
        </div>
      )}

      {!isClient && (
        <>
          <Button
            size="sm"
            variant="toggle"
            pressed={Boolean(filters.mine_only)}
            onClick={() => setFilters({ mine_only: !filters.mine_only })}
          >
            Mine only
          </Button>
          <Button
            size="sm"
            variant="toggle"
            pressed={Boolean(filters.include_linked_entities)}
            onClick={() =>
              setFilters({ include_linked_entities: !filters.include_linked_entities })
            }
          >
            Include linked
          </Button>

          <Popover
            open={moreOpen}
            onOpenChange={setMoreOpen}
            trigger={
              <Button size="sm" aria-label="More filters">
                More
              </Button>
            }
          >
            <Stack gap="2" padding="2" className="org-tfilter__pop">
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Entity Path Prefix
                </Text>
                <TextField
                  aria-label="Entity path prefix"
                  placeholder="e.g. shots/"
                  value={filters.entity_path_prefix ?? ''}
                  onChange={(e) => setFilters({ entity_path_prefix: e.target.value || undefined })}
                />
              </Stack>
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Tag
                </Text>
                <TextField
                  aria-label="Filter tag"
                  placeholder="hero..."
                  value={filters.tag ?? ''}
                  onChange={(e) => setFilters({ tag: e.target.value || undefined })}
                />
              </Stack>
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Date From / To
                </Text>
                <div className="org-tfilter__dates">
                  <input
                    type="date"
                    className="org-tfilter__date"
                    aria-label="Date from"
                    value={filters.date_from ?? ''}
                    onChange={(e) => setFilters({ date_from: e.target.value || undefined })}
                  />
                  <input
                    type="date"
                    className="org-tfilter__date"
                    aria-label="Date to"
                    value={filters.date_to ?? ''}
                    onChange={(e) => setFilters({ date_to: e.target.value || undefined })}
                  />
                </div>
              </Stack>
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Server Sort
                </Text>
                <Select
                  ariaLabel="Sort order"
                  value={filters.sort ?? 'updated'}
                  onChange={(v) =>
                    setFilters({
                      sort: v as 'code' | 'status' | 'priority' | 'due' | 'updated',
                    })
                  }
                  options={[
                    { value: 'updated', label: 'Updated' },
                    { value: 'code', label: 'Code' },
                    { value: 'status', label: 'Status' },
                    { value: 'priority', label: 'Priority' },
                    { value: 'due', label: 'Due date' },
                  ]}
                />
              </Stack>
            </Stack>
          </Popover>

          <Popover
            open={viewsOpen}
            onOpenChange={setViewsOpen}
            trigger={
              <Button size="sm" aria-label="Saved views">
                Views ({savedViews.length})
              </Button>
            }
          >
            <Stack gap="2" padding="2" className="org-tfilter__pop">
              <Text size="sm" variant="accent">
                Saved Views ({activeView})
              </Text>
              <div className="org-tfilter__save-row">
                <TextField
                  aria-label="Saved view name"
                  placeholder="View name..."
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                />
                <Button size="sm" variant="primary" onClick={() => void handleSaveView()}>
                  Save
                </Button>
              </div>
              {savedViews.length === 0 ? (
                <Text size="sm" variant="muted">
                  No saved views yet.
                </Text>
              ) : (
                savedViews.map((sv) => (
                  <div key={sv.id} className="org-tfilter__view-row">
                    <Button
                      size="sm"
                      onClick={() => {
                        applyViewConfig(sv.config_json ?? {});
                        setViewsOpen(false);
                      }}
                    >
                      {sv.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="icon"
                      aria-label={`Delete view ${sv.name}`}
                      onClick={async () => {
                        await apiClient.deleteSavedView(sv.id, activeProjectUuid);
                        await queryClient.invalidateQueries({
                          queryKey: ['saved-views', activeProjectUuid],
                        });
                      }}
                    >
                      <Icon name="trash" size="sm" />
                    </Button>
                  </div>
                ))
              )}
            </Stack>
          </Popover>
        </>
      )}

      {hasActiveFilters && (
        <Button size="sm" onClick={resetFilters}>
          Clear
        </Button>
      )}
    </div>
  );
}


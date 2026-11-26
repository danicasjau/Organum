import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Panel,
  Select,
  Stack,
  Tabs,
  Text,
  TextField,
} from '../../components/ui';
import { apiClient, type ProjectSettingsOut, type RoleOut } from '../../lib/api/client';
import { AuthenticatedShell } from '../auth/AuthenticatedShell';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { AdminDatabaseSection } from './AdminDatabaseSection';
import { AdminDefaultTasksSection } from './AdminDefaultTasksSection';
import { AdminDepTemplatesSection } from './AdminDepTemplatesSection';
import { AdminRulesSection } from './AdminRulesSection';
import {
  EMPTY_PERMISSION_FILTER,
  differsFromDefault,
  filterPermissionKeys,
  isFilterActive,
  permissionGroups,
  visibleRoles,
  type PermissionFilter,
} from './permissionFilter';
import './AdminPage.css';

type AdminSection =
  | 'roles'
  | 'default_tasks'
  | 'dep_templates'
  | 'rules'
  | 'project'
  | 'database'
  | 'audit'
  | 'users'
  | 'departments';

const WEEKDAY_OPTIONS: ReadonlyArray<{ day: number; label: string }> = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
];

type PermScope = 'all' | 'company' | 'mine' | 'shared' | 'none';

const SCOPE_OPTIONS: ReadonlyArray<{ value: PermScope; label: string }> = [
  { value: 'all', label: 'all' },
  { value: 'company', label: 'company' },
  { value: 'mine', label: 'mine' },
  { value: 'shared', label: 'shared' },
  { value: 'none', label: 'none' },
];

const CAPACITY_COLS: ReadonlyArray<'artist' | 'lead' | 'supervisor'> = [
  'artist',
  'lead',
  'supervisor',
];

/**
 * Administration sections (roles matrix, project settings, audit log) rendered
 * inside the unified Users panel.
 */
export function AdminConsoleContent({
  section: embeddedSection,
  theme,
  onToggleTheme,
}: {
  section?: AdminSection;
  theme?: ThemeMode;
  onToggleTheme?: () => void;
}) {
  const navigate = useNavigate();
  const auth = useAuthStore((s) => s.auth);
  const queryClient = useQueryClient();
  const projectUuid = auth?.project_uuid ?? null;
  const canManageRoles = hasPerm(auth?.permissions, 'role.manage');
  const canManageRules = hasPerm(auth?.permissions, 'rules.manage');
  const canManageEntities = hasPerm(auth?.permissions, 'entity.manage');
  const canAdminDb = auth?.user.role_name === 'admin' && hasPerm(auth?.permissions, 'admin.db');
  const canViewUsers = hasPerm(auth?.permissions, 'user.view');

  const [currentSection, setCurrentSection] = useState<AdminSection>(
    () => embeddedSection ?? (hasPerm(auth?.permissions, 'role.manage') ? 'roles' : 'rules'),
  );
  useEffect(() => {
    if (embeddedSection) setCurrentSection(embeddedSection);
  }, [embeddedSection]);
  const [matrixTab, setMatrixTab] = useState('role-matrix');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [auditFilter, setAuditFilter] = useState('');

  const rolesQuery = useQuery({
    queryKey: ['admin-roles', projectUuid],
    queryFn: () => apiClient.listRoles(projectUuid),
    enabled: Boolean(projectUuid && canManageRoles),
  });

  const capsQuery = useQuery({
    queryKey: ['admin-capacities', projectUuid],
    queryFn: () => apiClient.getCapacities(projectUuid),
    enabled: Boolean(projectUuid && canManageRoles),
  });

  const projSettingsQuery = useQuery({
    queryKey: ['project-settings', projectUuid],
    queryFn: () => apiClient.getProjectSettings(projectUuid),
    enabled: Boolean(projectUuid),
  });

  const auditQuery = useQuery({
    queryKey: ['admin-audit', projectUuid, auditFilter],
    queryFn: () => apiClient.listAuditLogs(auditFilter || undefined, 150, projectUuid),
    enabled: Boolean(projectUuid && canManageRoles && currentSection === 'audit'),
  });

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const [capDraft, setCapDraft] = useState<{
    artist: string[];
    lead: string[];
    supervisor: string[];
  } | null>(null);

  useEffect(() => {
    if (capsQuery.data) {
      setCapDraft({
        artist: [...(capsQuery.data.artist ?? [])],
        lead: [...(capsQuery.data.lead ?? [])],
        supervisor: [...(capsQuery.data.supervisor ?? [])],
      });
    }
  }, [capsQuery.data]);

  const [projDraft, setProjDraft] = useState<ProjectSettingsOut | null>(null);
  useEffect(() => {
    if (projSettingsQuery.data) {
      setProjDraft({ ...projSettingsQuery.data });
    }
  }, [projSettingsQuery.data]);

  const permissionKeys = useMemo(() => {
    const first = roles[0]?.permissions ?? {};
    return Object.keys(first).sort();
  }, [roles]);

  const [permFilter, setPermFilter] = useState<PermissionFilter>(EMPTY_PERMISSION_FILTER);
  const patchPermFilter = (patch: Partial<PermissionFilter>) =>
    setPermFilter((prev) => ({ ...prev, ...patch }));
  const shownRoles = useMemo(() => visibleRoles(roles, permFilter), [roles, permFilter]);
  const shownKeys = useMemo(
    () => filterPermissionKeys(permissionKeys, roles, permFilter),
    [permissionKeys, roles, permFilter],
  );

  const handleUpdateRoleScope = async (role: RoleOut, permKey: string, nextScope: PermScope) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const nextPerms: Record<string, PermScope> = {};
      for (const k of permissionKeys) {
        nextPerms[k] = (role.permissions?.[k] as PermScope | undefined) ?? 'none';
      }
      nextPerms[permKey] = nextScope;
      await apiClient.putRolePermissions(role.id, nextPerms, projectUuid);
      await queryClient.invalidateQueries({ queryKey: ['admin-roles', projectUuid] });
      setStatusMsg(`Updated ${role.label} · ${permKey} → ${nextScope}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update role permission');
    }
  };

  const handleCreateRole = async () => {
    if (!newRoleName.trim() || !newRoleLabel.trim()) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiClient.createRole(
        { name: newRoleName.trim(), label: newRoleLabel.trim(), rank: 35 },
        projectUuid,
      );
      setNewRoleName('');
      setNewRoleLabel('');
      await queryClient.invalidateQueries({ queryKey: ['admin-roles', projectUuid] });
      setStatusMsg('Created custom role.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create role');
    }
  };

  const handleToggleCapPerm = (cap: 'artist' | 'lead' | 'supervisor', permKey: string) => {
    if (!capDraft) return;
    const set = new Set(capDraft[cap]);
    if (set.has(permKey)) set.delete(permKey);
    else set.add(permKey);
    setCapDraft({ ...capDraft, [cap]: Array.from(set).sort() });
  };

  const handleSaveCaps = async () => {
    if (!capDraft) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiClient.putCapacities(capDraft, projectUuid);
      await queryClient.invalidateQueries({ queryKey: ['admin-capacities', projectUuid] });
      setStatusMsg('Saved capacity permissions matrix.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save capacity matrix');
    }
  };

  const handleSaveProjectSettings = async () => {
    if (!projDraft) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await apiClient.patchProjectSettings(
        {
          name: projDraft.name,
          status: projDraft.status,
          hours_per_day: projDraft.hours_per_day,
          working_days: projDraft.working_days,
          task_code_pattern: projDraft.task_code_pattern,
          require_version_to_submit: projDraft.require_version_to_submit,
          enforce_dependencies_in_gantt: projDraft.enforce_dependencies_in_gantt,
          admin_sql_console_enabled: projDraft.admin_sql_console_enabled,
          link_dependency_depth: projDraft.link_dependency_depth,
        },
        projectUuid,
      );
      const freshMe = await apiClient.getAuthMe();
      useAuthStore.getState().setAuth(freshMe);
      await queryClient.invalidateQueries({ queryKey: ['project-settings', projectUuid] });
      setStatusMsg('Saved project settings.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save project settings');
    }
  };

  const content = (
    <div className="org-admin-shell" data-ui="admin-page">
      {!embeddedSection && (
        <aside className="org-admin-nav" aria-label="Admin sections">
          <div className="org-admin-nav__title">Admin Console</div>
          {(
            [
              ['users', 'Users', canViewUsers],
              ['roles', 'Roles & Permissions', canManageRoles],
              ['departments', 'Departments', canViewUsers],
              ['default_tasks', 'Default Tasks', canManageEntities],
              ['dep_templates', 'Dependency Templates', canManageEntities],
              ['rules', 'Rules', canManageRules],
              ['project', 'Project', canManageRoles],
              ['database', 'Database', canAdminDb],
              ['audit', 'Audit Log', canManageRoles],
            ] as ReadonlyArray<readonly [AdminSection, string, boolean]>
          )
            .filter(([, , visible]) => visible)
            .map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="org-admin-nav__item"
                data-active={currentSection === id ? 'true' : undefined}
                onClick={() => {
                  if (id === 'users') navigate('/users');
                  else if (id === 'departments') navigate('/users?tab=departments');
                  else setCurrentSection(id);
                }}
              >
                {label}
              </button>
            ))}
        </aside>
      )}

      <section className="org-admin-content">
        {errorMsg && <Banner severity="danger">{errorMsg}</Banner>}
        {statusMsg && <Banner severity="success">{statusMsg}</Banner>}
        {currentSection === 'roles' && (
          <Tabs
            activeId={matrixTab}
            onChange={setMatrixTab}
            items={[
              {
                id: 'role-matrix',
                label: 'Role Permissions Matrix',
                content: (
                  <Stack gap="2">
                    <div className="org-admin-toolbar">
                      <TextField
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        placeholder="role_key (e.g. coordinator)"
                      />
                      <TextField
                        value={newRoleLabel}
                        onChange={(e) => setNewRoleLabel(e.target.value)}
                        placeholder="Display Label"
                      />
                      <Button size="sm" variant="primary" onClick={() => void handleCreateRole()}>
                        Add Custom Role
                      </Button>
                    </div>

                    <div
                      className="org-admin-toolbar org-admin-permfilter"
                      role="search"
                      aria-label="Filter permissions"
                    >
                      <TextField
                        aria-label="Search permissions"
                        placeholder="Search key, role or scope (e.g. gantt, company)..."
                        value={permFilter.text}
                        onChange={(e) => patchPermFilter({ text: e.target.value })}
                      />
                      <Select
                        ariaLabel="Permission group"
                        value={permFilter.group}
                        onChange={(group) => patchPermFilter({ group })}
                        options={[
                          { value: '', label: 'All groups' },
                          ...permissionGroups(permissionKeys).map((g) => ({ value: g, label: g })),
                        ]}
                      />
                      <Select
                        ariaLabel="Role column"
                        value={permFilter.roleId}
                        onChange={(roleId) => patchPermFilter({ roleId })}
                        options={[
                          { value: '', label: 'All roles' },
                          ...roles.map((r) => ({ value: r.id, label: r.label })),
                        ]}
                      />
                      <Checkbox
                        label="Only differences from default"
                        checked={permFilter.onlyDifferences}
                        onChange={(onlyDifferences) => patchPermFilter({ onlyDifferences })}
                      />
                      <Text size="sm" variant="muted" aria-live="polite">
                        {shownKeys.length} of {permissionKeys.length} permissions
                      </Text>
                      {isFilterActive(permFilter) && (
                        <Button size="sm" onClick={() => setPermFilter(EMPTY_PERMISSION_FILTER)}>
                          Clear filters
                        </Button>
                      )}
                    </div>

                    <div className="org-admin-table-wrap">
                      <table className="org-admin-matrix" aria-label="Role permissions matrix">
                        <thead>
                          <tr>
                            <th>Permission</th>
                            {shownRoles.map((r) => (
                              <th key={r.id} title={r.name}>
                                {r.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shownKeys.length === 0 && (
                            <tr>
                              <td colSpan={shownRoles.length + 1}>
                                <Text size="sm" variant="muted">
                                  No permissions match the current filters.
                                </Text>
                              </td>
                            </tr>
                          )}
                          {shownKeys.map((perm) => (
                            <tr key={perm}>
                              <td className="org-admin-matrix__perm">{perm}</td>
                              {shownRoles.map((role) => {
                                const scope = (role.permissions?.[perm] ?? 'none') as PermScope;
                                const locked = role.name === 'admin';
                                const changed = differsFromDefault(role, perm);
                                return (
                                  <td
                                    key={`${role.id}:${perm}`}
                                    data-changed={changed ? 'true' : undefined}
                                    title={
                                      changed
                                        ? `Changed from default (${role.default_permissions?.[perm] ?? 'none'})`
                                        : undefined
                                    }
                                  >
                                    {changed && (
                                      <span
                                        className="org-admin-matrix__changed"
                                        aria-label={`changed from default ${role.default_permissions?.[perm] ?? 'none'}`}
                                      >
                                        *
                                      </span>
                                    )}
                                    {locked ? (
                                      <Badge tone="neutral">all</Badge>
                                    ) : (
                                      <Select
                                        ariaLabel={`${role.label} ${perm}`}
                                        value={scope}
                                        options={[...SCOPE_OPTIONS]}
                                        onChange={(v) =>
                                          void handleUpdateRoleScope(role, perm, v as PermScope)
                                        }
                                      />
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Stack>
                ),
              },
              {
                id: 'capacities',
                label: 'Capacities Matrix',
                content: (
                  <Stack gap="2">
                    <div className="org-admin-toolbar">
                      <Text size="sm" variant="muted">
                        Capacity permissions apply whenever a user is assigned as DO (artist), LEAD,
                        or SUP (supervisor) on a specific task.
                      </Text>
                      <Button size="sm" variant="primary" onClick={() => void handleSaveCaps()}>
                        Save Capacities
                      </Button>
                    </div>
                    <div className="org-admin-table-wrap">
                      <table className="org-admin-matrix" aria-label="Capacity permissions matrix">
                        <thead>
                          <tr>
                            <th>Permission</th>
                            <th>DO (artist)</th>
                            <th>LEAD (lead)</th>
                            <th>SUP (supervisor)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {permissionKeys.map((perm) => (
                            <tr key={perm}>
                              <td className="org-admin-matrix__perm">{perm}</td>
                              {CAPACITY_COLS.map((cap) => (
                                <td key={`${cap}:${perm}`}>
                                  <Checkbox
                                    ariaLabel={`${cap} ${perm}`}
                                    checked={Boolean(capDraft?.[cap].includes(perm))}
                                    onChange={() => handleToggleCapPerm(cap, perm)}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Stack>
                ),
              },
            ]}
          />
        )}

        {currentSection === 'project' && projDraft && (
          <Panel title="Project Lifecycle & Security Settings">
            <Stack gap="2">
              <label className="org-admin-field">
                <Text size="sm" variant="muted">
                  Project Status
                </Text>
                <Select
                  ariaLabel="Project Status"
                  value={projDraft.status}
                  onChange={(v) =>
                    setProjDraft({
                      ...projDraft,
                      status: v as ProjectSettingsOut['status'],
                    })
                  }
                  options={[
                    { value: 'active', label: 'active (read/write)' },
                    { value: 'on_hold', label: 'on_hold' },
                    { value: 'completed', label: 'completed' },
                    { value: 'archived', label: 'archived (read-only for non-admins)' },
                  ]}
                />
              </label>
              <label className="org-admin-field">
                <Text size="sm" variant="muted">
                  Hours per Day
                </Text>
                <TextField
                  type="number"
                  value={String(projDraft.hours_per_day)}
                  onChange={(e) =>
                    setProjDraft({
                      ...projDraft,
                      hours_per_day: Number(e.target.value) || 8,
                    })
                  }
                />
              </label>
              <label className="org-admin-field">
                <Text size="sm" variant="muted">
                  Task Code Pattern
                </Text>
                <TextField
                  value={projDraft.task_code_pattern}
                  onChange={(e) =>
                    setProjDraft({ ...projDraft, task_code_pattern: e.target.value })
                  }
                />
              </label>
              <div className="org-admin-field">
                <Text size="sm" variant="muted">
                  Working Days
                </Text>
                <div className="org-admin-toolbar">
                  {WEEKDAY_OPTIONS.map((w) => {
                    const active = (projDraft.working_days ?? []).includes(w.day);
                    return (
                      <Checkbox
                        key={w.day}
                        label={w.label}
                        checked={active}
                        onChange={(checked) => {
                          const next = new Set(projDraft.working_days ?? []);
                          if (checked) next.add(w.day);
                          else next.delete(w.day);
                          setProjDraft({
                            ...projDraft,
                            working_days: Array.from(next).sort((a, b) => a - b),
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <label className="org-admin-field">
                <Text size="sm" variant="muted">
                  Link Dependency Depth
                </Text>
                <Select
                  ariaLabel="Link Dependency Depth"
                  value={String(projDraft.link_dependency_depth ?? 1)}
                  onChange={(v) => setProjDraft({ ...projDraft, link_dependency_depth: Number(v) })}
                  options={[
                    { value: '1', label: '1 hop (direct links)' },
                    { value: '2', label: '2 hops (indirect links)' },
                  ]}
                />
              </label>
              <Checkbox
                label="Require published version to submit for review"
                checked={projDraft.require_version_to_submit}
                onChange={(v) => setProjDraft({ ...projDraft, require_version_to_submit: v })}
              />
              <Checkbox
                label="Enforce blocking dependencies on Gantt drag"
                checked={projDraft.enforce_dependencies_in_gantt}
                onChange={(v) => setProjDraft({ ...projDraft, enforce_dependencies_in_gantt: v })}
              />
              <Checkbox
                label="Enable read-only admin SQL console (Phase 7E)"
                checked={projDraft.admin_sql_console_enabled}
                onChange={(v) => setProjDraft({ ...projDraft, admin_sql_console_enabled: v })}
              />
              <div className="org-admin-toolbar">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleSaveProjectSettings()}
                >
                  Save Project Settings
                </Button>
              </div>
            </Stack>
          </Panel>
        )}

        {currentSection === 'default_tasks' && canManageEntities && (
          <AdminDefaultTasksSection projectUuid={projectUuid} />
        )}

        {currentSection === 'dep_templates' && canManageEntities && (
          <AdminDepTemplatesSection projectUuid={projectUuid} />
        )}

        {currentSection === 'rules' && canManageRules && (
          <AdminRulesSection projectUuid={projectUuid} />
        )}

        {currentSection === 'database' && canAdminDb && (
          <AdminDatabaseSection
            projectUuid={projectUuid}
            sqlConsoleEnabled={Boolean(projSettingsQuery.data?.admin_sql_console_enabled)}
          />
        )}

        {currentSection === 'audit' && (
          <Panel title="Security & Production Audit Log">
            <Stack gap="2">
              <div className="org-admin-toolbar">
                <TextField
                  value={auditFilter}
                  onChange={(e) => setAuditFilter(e.target.value)}
                  placeholder="Filter by action (e.g. auth.login)"
                />
                <Button size="sm" onClick={() => void auditQuery.refetch()}>
                  Refresh
                </Button>
              </div>
              <div className="org-admin-table-wrap">
                <table className="org-admin-matrix" aria-label="Audit log">
                  <thead>
                    <tr>
                      <th>Timestamp (UTC)</th>
                      <th>User</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>IP</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(auditQuery.data ?? []).map((row) => (
                      <tr key={row.id}>
                        <td>{new Date(row.at).toISOString()}</td>
                        <td>{row.username ?? '—'}</td>
                        <td>{row.action}</td>
                        <td>{row.target_type ? `${row.target_type}:${row.target_id}` : '—'}</td>
                        <td>{row.ip ?? '—'}</td>
                        <td>{JSON.stringify(row.detail_json)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Stack>
          </Panel>
        )}
      </section>
    </div>
  );

  if (theme && onToggleTheme) {
    return (
      <AuthenticatedShell
        theme={theme}
        onToggleTheme={onToggleTheme}
        statusText={`Admin Console — ${auth?.project_status ?? 'active'}`}
      >
        {content}
      </AuthenticatedShell>
    );
  }
  return content;
}

export function AdminPage({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return <AdminConsoleContent theme={theme} onToggleTheme={onToggleTheme} />;
}

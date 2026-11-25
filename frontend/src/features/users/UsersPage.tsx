import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Checkbox,
  ColorPicker,
  Dialog,
  Panel,
  SearchField,
  Select,
  Stack,
  Text,
  TextField,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import { apiClient, type CompanyOut, type DepartmentOut, type UserOut } from '../../lib/api/client';
import { AdminConsoleContent } from '../admin/AdminPage';
import { AuthenticatedShell } from '../auth/AuthenticatedShell';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { deptColorHex } from '../departments/deptColors';
import { TimeCapacitySection } from './TimeCapacitySection';
import './UsersPage.css';

type UsersSection = 'users' | 'companies' | 'departments' | 'time' | 'roles' | 'project' | 'audit';

const USERS_SECTIONS: ReadonlyArray<{
  id: UsersSection;
  label: string;
  group: 'People' | 'Time' | 'Settings';
  admin?: boolean;
}> = [
  { id: 'users', label: 'Users', group: 'People' },
  { id: 'companies', label: 'Companies', group: 'People' },
  { id: 'departments', label: 'Departments', group: 'People' },
  { id: 'time', label: 'Time & Capacity', group: 'Time' },
  { id: 'roles', label: 'Roles & Permissions', group: 'Settings', admin: true },
  { id: 'project', label: 'Project Settings', group: 'Settings', admin: true },
  { id: 'audit', label: 'Audit Log', group: 'Settings', admin: true },
];

function VirtualUserRow({
  user,
  selected,
  start,
  size,
  projectUuid,
  onSelect,
}: {
  user: UserOut;
  selected: boolean;
  start: number;
  size: number;
  projectUuid: string;
  onSelect: () => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  useCssVarRef(rowRef, '--virt-y', `${start}px`);
  useCssVarRef(rowRef, '--virt-h', `${size}px`);

  return (
    <button
      ref={rowRef}
      type="button"
      className="org-users-vrow"
      data-selected={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <Avatar
        username={user.username}
        fullName={user.full_name}
        avatarUrl={
          user.avatar_file
            ? `${apiClient.userAvatarUrl(user.id, projectUuid)}?v=${encodeURIComponent(user.avatar_file)}`
            : null
        }
        size="sm"
      />
      <span className="org-users-vrow__main">
        <span className="org-users-vrow__name">{user.full_name}</span>
        <span className="org-users-vrow__sub">
          @{user.username} · {user.role_label}
          {user.company_name ? ` · ${user.company_name}` : ''}
        </span>
      </span>
      <Badge tone={user.is_active ? 'success' : 'danger'}>
        {user.is_active ? 'Active' : 'Inactive'}
      </Badge>
    </button>
  );
}

function VirtualBodyContainer({
  totalSize,
  children,
}: {
  totalSize: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--virt-total-h', `${totalSize}px`);
  return (
    <div ref={ref} className="org-users-vlist__inner">
      {children}
    </div>
  );
}

export function UsersPage({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuthStore((s) => s.auth);
  const canAdmin = hasPerm(auth?.permissions, 'role.manage');
  const canViewUsers = hasPerm(auth?.permissions, 'user.view');
  const requested = (searchParams.get('section') ?? searchParams.get('tab') ?? '') as UsersSection;
  const navSections = USERS_SECTIONS.filter((sec) => (sec.admin ? canAdmin : canViewUsers));
  const activeTab: UsersSection = navSections.some((sec) => sec.id === requested)
    ? requested
    : (navSections[0]?.id ?? 'users');
  const setActiveTab = (next: UsersSection) =>
    setSearchParams(next === 'users' ? {} : { section: next }, { replace: true });

  const projectUuid = auth?.project_uuid ?? null;
  const queryClient = useQueryClient();
  const canManageUsers = hasPerm(auth?.permissions, 'user.manage');
  const canManageDepts = hasPerm(auth?.permissions, 'entity.manage');

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [newCapHours, setNewCapHours] = useState('8');

  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwValue, setResetPwValue] = useState('');

  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyCode, setNewCompanyCode] = useState('');
  const [newCompanyKind, setNewCompanyKind] = useState<'internal' | 'external' | 'group'>(
    'internal',
  );

  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const listParentRef = useRef<HTMLDivElement>(null);

  const usersQuery = useQuery({
    queryKey: ['users', projectUuid],
    queryFn: () => apiClient.listUsers(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const rolesQuery = useQuery({
    queryKey: ['roles', projectUuid],
    queryFn: () => apiClient.listRoles(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const companiesQuery = useQuery({
    queryKey: ['companies', projectUuid],
    queryFn: () => apiClient.listCompanies(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const deptsQuery = useQuery({
    queryKey: ['departments', projectUuid],
    queryFn: () => apiClient.listDepartments(projectUuid),
    enabled: Boolean(projectUuid),
  });

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const companies = useMemo(() => companiesQuery.data ?? [], [companiesQuery.data]);
  const departments = useMemo(() => deptsQuery.data ?? [], [deptsQuery.data]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role_name !== roleFilter) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        u.role_label.toLowerCase().includes(q) ||
        (u.company_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [users, query, roleFilter]);

  const virtualizer = useVirtualizer({
    count: filteredUsers.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 34,
    overscan: 8,
  });

  const selectedUser: UserOut | null = useMemo(
    () =>
      filteredUsers.find((u) => u.id === selectedUserId) ??
      users.find((u) => u.id === selectedUserId) ??
      filteredUsers[0] ??
      null,
    [filteredUsers, users, selectedUserId],
  );

  const selectedCompany: CompanyOut | null = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) ?? companies[0] ?? null,
    [companies, selectedCompanyId],
  );

  const invalidateUsers = async () => {
    await queryClient.invalidateQueries({ queryKey: ['users', projectUuid] });
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectUuid) return;
    setErrorMsg(null);
    setFeedback(null);
    const chosenRoleId =
      newRoleId || roles.find((r) => r.name === 'artist')?.id || roles[0]?.id || '';
    try {
      const created = await apiClient.createUser(
        {
          username: newUsername.trim(),
          full_name: newFullName.trim(),
          email: newEmail.trim() || null,
          password: newPassword,
          role_id: chosenRoleId,
          company_id: newCompanyId || null,
          daily_capacity_hours: Number(newCapHours) || 8,
          timezone: 'UTC',
          must_change_password: true,
        },
        projectUuid,
      );
      setCreateUserOpen(false);
      setNewUsername('');
      setNewFullName('');
      setNewEmail('');
      setNewPassword('');
      setSelectedUserId(created.id);
      await invalidateUsers();
      setFeedback(`Created user @${created.username}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create user');
    }
  };

  const handlePatchUser = async (
    user: UserOut,
    patch: Parameters<typeof apiClient.updateUser>[1],
  ) => {
    if (!projectUuid) return;
    setErrorMsg(null);
    setFeedback(null);
    try {
      await apiClient.updateUser(user.id, patch, projectUuid);
      await invalidateUsers();
      setFeedback(`Updated @${user.username}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update user');
    }
  };

  const handleToggleUserDept = async (user: UserOut, deptId: string) => {
    if (!projectUuid || !canManageUsers) return;
    const set = new Set(user.department_ids ?? []);
    if (set.has(deptId)) set.delete(deptId);
    else set.add(deptId);
    setErrorMsg(null);
    try {
      await apiClient.setUserDepartments(user.id, Array.from(set), projectUuid);
      await invalidateUsers();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update user departments');
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !projectUuid) return;
    setErrorMsg(null);
    try {
      await apiClient.resetUserPassword(
        selectedUser.id,
        { new_password: resetPwValue, must_change_password: true },
        projectUuid,
      );
      setResetPwOpen(false);
      setResetPwValue('');
      setFeedback(`Temporary password set for @${selectedUser.username}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reset password failed');
    }
  };

  const handleUploadAvatar = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedUser || !projectUuid) return;
    setErrorMsg(null);
    try {
      await apiClient.uploadUserAvatar(selectedUser.id, file, projectUuid);
      await invalidateUsers();
      setFeedback(`Avatar updated for @${selectedUser.username}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Avatar upload failed');
    } finally {
      e.target.value = '';
    }
  };

  const handleCreateCompany = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectUuid) return;
    setErrorMsg(null);
    try {
      const created = await apiClient.createCompany(
        {
          name: newCompanyName.trim(),
          short_code: newCompanyCode.trim().toUpperCase(),
          kind: newCompanyKind,
          color: '--series-1',
          notes: '',
        },
        projectUuid,
      );
      setNewCompanyName('');
      setNewCompanyCode('');
      setSelectedCompanyId(created.id);
      await queryClient.invalidateQueries({ queryKey: ['companies', projectUuid] });
      setFeedback(`Created company ${created.name}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create company');
    }
  };

  const handleToggleCompanyDept = async (comp: CompanyOut, deptId: string) => {
    if (!projectUuid || !canManageUsers) return;
    const set = new Set(comp.department_ids ?? []);
    if (set.has(deptId)) set.delete(deptId);
    else set.add(deptId);
    try {
      await apiClient.setCompanyDepartments(comp.id, Array.from(set), projectUuid);
      await queryClient.invalidateQueries({ queryKey: ['companies', projectUuid] });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update company departments');
    }
  };

  const handleCreateDept = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectUuid || !newDeptName.trim()) return;
    setErrorMsg(null);
    try {
      await apiClient.createDepartment(newDeptName.trim(), projectUuid);
      setNewDeptName('');
      setNewDeptCode('');
      await queryClient.invalidateQueries({ queryKey: ['departments', projectUuid] });
      setFeedback('Department created.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create department');
    }
  };

  const [deptColorDrafts, setDeptColorDrafts] = useState<Record<string, string>>({});
  const deptColorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queueDeptColor = (dept: DepartmentOut, hex: string) => {
    setDeptColorDrafts((prev) => ({ ...prev, [dept.id]: hex }));
    clearTimeout(deptColorTimers.current[dept.id]);
    deptColorTimers.current[dept.id] = setTimeout(() => {
      void handlePatchDept(dept, { color: hex });
    }, 300);
  };

  const handlePatchDept = async (
    dept: DepartmentOut,
    patch: { short_code?: string; color?: string; is_active?: boolean },
  ) => {
    if (!projectUuid) return;
    setErrorMsg(null);
    try {
      await apiClient.updateDepartment(dept.id, patch, projectUuid);
      await queryClient.invalidateQueries({ queryKey: ['departments', projectUuid] });
      setFeedback(`Updated department ${dept.name}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update department');
    }
  };

  return (
    <AuthenticatedShell
      theme={theme}
      onToggleTheme={onToggleTheme}
      statusText={`Users & Admin — ${users.length} users`}
    >
      <div className="org-users-shell">
        <aside className="org-users-nav" aria-label="Users & administration sections">
          {(['People', 'Time', 'Settings'] as const).map((group) => {
            const items = navSections.filter((sec) => sec.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="org-users-nav__group">
                <div className="org-users-nav__title">{group}</div>
                {items.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    className="org-users-nav__item"
                    data-active={activeTab === sec.id ? 'true' : undefined}
                    aria-current={activeTab === sec.id ? 'page' : undefined}
                    onClick={() => setActiveTab(sec.id)}
                  >
                    <span>{sec.label}</span>
                    {sec.id === 'users' && (
                      <span className="org-users-nav__count">{users.length}</span>
                    )}
                    {sec.id === 'companies' && (
                      <span className="org-users-nav__count">{companies.length}</span>
                    )}
                    {sec.id === 'departments' && (
                      <span className="org-users-nav__count">{departments.length}</span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </aside>
        <div className="org-users-page" data-ui="users-page">
          {errorMsg && <Banner severity="danger">{errorMsg}</Banner>}
          {feedback && <Banner severity="success">{feedback}</Banner>}

          {(() => {
            const sections: Array<{ id: UsersSection; label: string; content: ReactNode }> = [
              {
                id: 'users',
                label: `Users (${users.length})`,
                content: (
                  <div className="org-users-split">
                    <div className="org-users-left">
                      <div className="org-users-toolbar">
                        <SearchField
                          value={query}
                          onChange={setQuery}
                          placeholder="Filter username, name, role, company..."
                          ariaLabel="Filter users"
                        />
                        <Select
                          ariaLabel="Role filter"
                          value={roleFilter}
                          onChange={setRoleFilter}
                          options={[
                            { value: 'all', label: 'All roles' },
                            ...roles.map((r) => ({ value: r.name, label: r.label })),
                          ]}
                        />
                        {canManageUsers && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => setCreateUserOpen(true)}
                          >
                            + New User
                          </Button>
                        )}
                      </div>

                      <div
                        ref={listParentRef}
                        className="org-users-vlist"
                        role="listbox"
                        aria-label="Users directory"
                      >
                        <VirtualBodyContainer totalSize={virtualizer.getTotalSize()}>
                          {virtualizer.getVirtualItems().map((vRow) => {
                            const user = filteredUsers[vRow.index];
                            if (!user || !projectUuid) return null;
                            return (
                              <VirtualUserRow
                                key={user.id}
                                user={user}
                                selected={selectedUser?.id === user.id}
                                start={vRow.start}
                                size={vRow.size}
                                projectUuid={projectUuid}
                                onSelect={() => setSelectedUserId(user.id)}
                              />
                            );
                          })}
                        </VirtualBodyContainer>
                      </div>
                    </div>

                    <div className="org-users-right">
                      {selectedUser ? (
                        <Panel
                          key={selectedUser.id}
                          title={`Profile — ${selectedUser.full_name} (@${selectedUser.username})`}
                        >
                          <Stack gap="2">
                            <div className="org-users-profile-head">
                              <Avatar
                                username={selectedUser.username}
                                fullName={selectedUser.full_name}
                                avatarUrl={
                                  selectedUser.avatar_file && projectUuid
                                    ? `${apiClient.userAvatarUrl(selectedUser.id, projectUuid)}?v=${encodeURIComponent(selectedUser.avatar_file)}`
                                    : null
                                }
                                size="md"
                              />
                              <div>
                                <strong>{selectedUser.full_name}</strong>
                                <div className="org-users-badges">
                                  <Badge tone="accent">{selectedUser.role_label}</Badge>
                                  <Badge tone={selectedUser.is_active ? 'success' : 'danger'}>
                                    {selectedUser.is_active ? 'Active' : 'Inactive'}
                                  </Badge>
                                  {selectedUser.must_change_password && (
                                    <Badge tone="warning">Must change pw</Badge>
                                  )}
                                </div>
                              </div>
                              {canManageUsers && (
                                <div className="org-users-head-btns">
                                  <input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="org-users-hidden"
                                    onChange={(ev) => void handleUploadAvatar(ev)}
                                  />
                                  <Button size="sm" onClick={() => avatarInputRef.current?.click()}>
                                    Avatar
                                  </Button>
                                  <Button size="sm" onClick={() => setResetPwOpen(true)}>
                                    Reset Password
                                  </Button>
                                  {selectedUser.id !== auth?.user.id && (
                                    <Button
                                      size="sm"
                                      variant={selectedUser.is_active ? 'danger' : 'success'}
                                      onClick={() =>
                                        void handlePatchUser(selectedUser, {
                                          is_active: !selectedUser.is_active,
                                        })
                                      }
                                    >
                                      {selectedUser.is_active ? 'Deactivate' : 'Activate'}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="org-users-form-grid">
                              <label className="org-users-field">
                                <Text size="sm" variant="muted">
                                  Full Name
                                </Text>
                                <TextField
                                  defaultValue={selectedUser.full_name}
                                  disabled={!canManageUsers}
                                  onBlur={(e) => {
                                    const next = e.target.value.trim();
                                    if (next && next !== selectedUser.full_name) {
                                      void handlePatchUser(selectedUser, { full_name: next });
                                    }
                                  }}
                                />
                              </label>
                              <label className="org-users-field">
                                <Text size="sm" variant="muted">
                                  Email
                                </Text>
                                <TextField
                                  defaultValue={selectedUser.email ?? ''}
                                  disabled={!canManageUsers}
                                  onBlur={(e) => {
                                    const next = e.target.value.trim() || null;
                                    if (next !== (selectedUser.email ?? null)) {
                                      void handlePatchUser(selectedUser, { email: next });
                                    }
                                  }}
                                />
                              </label>
                              <label className="org-users-field">
                                <Text size="sm" variant="muted">
                                  Role
                                </Text>
                                <Select
                                  ariaLabel="User role"
                                  disabled={
                                    !canManageUsers ||
                                    (selectedUser.role_name === 'admin' &&
                                      auth?.user.role_name !== 'admin')
                                  }
                                  value={selectedUser.role_id}
                                  options={roles
                                    .filter(
                                      (r) => r.name !== 'admin' || auth?.user.role_name === 'admin',
                                    )
                                    .map((r) => ({ value: r.id, label: r.label }))}
                                  onChange={(v) =>
                                    void handlePatchUser(selectedUser, { role_id: v })
                                  }
                                />
                              </label>
                              <label className="org-users-field">
                                <Text size="sm" variant="muted">
                                  Company
                                </Text>
                                <Select
                                  ariaLabel="User company"
                                  disabled={!canManageUsers}
                                  value={selectedUser.company_id ?? '__none__'}
                                  options={[
                                    { value: '__none__', label: 'None' },
                                    ...companies.map((c) => ({
                                      value: c.id,
                                      label: `${c.name} (${c.short_code})`,
                                    })),
                                  ]}
                                  onChange={(v) =>
                                    void handlePatchUser(selectedUser, {
                                      company_id: v === '__none__' ? null : v,
                                    })
                                  }
                                />
                              </label>
                              <label className="org-users-field">
                                <Text size="sm" variant="muted">
                                  Daily Capacity Hours
                                </Text>
                                <TextField
                                  type="number"
                                  disabled={!canManageUsers}
                                  defaultValue={String(selectedUser.daily_capacity_hours)}
                                  onBlur={(e) =>
                                    void handlePatchUser(selectedUser, {
                                      daily_capacity_hours: Number(e.target.value) || 8,
                                    })
                                  }
                                />
                              </label>
                              <label className="org-users-field">
                                <Text size="sm" variant="muted">
                                  Timezone
                                </Text>
                                <TextField
                                  disabled={!canManageUsers}
                                  defaultValue={selectedUser.timezone}
                                  onBlur={(e) =>
                                    void handlePatchUser(selectedUser, {
                                      timezone: e.target.value || 'UTC',
                                    })
                                  }
                                />
                              </label>
                            </div>

                            <div className="org-users-section">
                              <Text size="sm">
                                <strong>Departments</strong>
                              </Text>
                              <div className="org-users-checks">
                                {departments.map((d) => (
                                  <Checkbox
                                    key={d.id}
                                    label={`${d.short_code} · ${d.name}`}
                                    disabled={!canManageUsers}
                                    checked={(selectedUser.department_ids ?? []).includes(d.id)}
                                    onChange={() => void handleToggleUserDept(selectedUser, d.id)}
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="org-users-section">
                              <Text size="sm">
                                <strong>Projects Working On</strong>
                              </Text>
                              <div className="org-users-proj-list">
                                {(selectedUser.projects_working_on ?? []).map((p) => (
                                  <Badge key={p.project_uuid} tone="neutral">
                                    {p.project_name}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </Stack>
                        </Panel>
                      ) : (
                        <Panel title="No user selected">
                          <Text size="sm" variant="muted">
                            Select a user from the list.
                          </Text>
                        </Panel>
                      )}
                    </div>
                  </div>
                ),
              },
              {
                id: 'companies',
                label: `Companies (${companies.length})`,
                content: (
                  <div className="org-users-split">
                    <div className="org-users-left">
                      {canManageUsers && (
                        <form onSubmit={handleCreateCompany} className="org-users-toolbar">
                          <TextField
                            value={newCompanyName}
                            onChange={(e) => setNewCompanyName(e.target.value)}
                            placeholder="Company name"
                            required
                          />
                          <TextField
                            value={newCompanyCode}
                            onChange={(e) => setNewCompanyCode(e.target.value)}
                            placeholder="CODE"
                            required
                          />
                          <Select
                            ariaLabel="New company kind"
                            value={newCompanyKind}
                            onChange={(v) =>
                              setNewCompanyKind(v as 'internal' | 'external' | 'group')
                            }
                            options={[
                              { value: 'internal', label: 'internal' },
                              { value: 'external', label: 'external' },
                              { value: 'group', label: 'group' },
                            ]}
                          />
                          <Button type="submit" size="sm" variant="primary">
                            Add
                          </Button>
                        </form>
                      )}
                      <div className="org-users-simple-list">
                        {companies.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="org-users-simple-row"
                            data-selected={selectedCompany?.id === c.id ? 'true' : undefined}
                            onClick={() => setSelectedCompanyId(c.id)}
                          >
                            <Badge tone="accent">{c.short_code}</Badge>
                            <span className="org-users-vrow__name">{c.name}</span>
                            <Badge tone="neutral">{c.kind}</Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="org-users-right">
                      {selectedCompany && (
                        <Panel title={`Company — ${selectedCompany.name}`}>
                          <Stack gap="2">
                            <Text size="sm" variant="muted">
                              Kind: {selectedCompany.kind} · Code: {selectedCompany.short_code}
                            </Text>
                            <Text size="sm">
                              <strong>Responsible Departments</strong>
                            </Text>
                            <div className="org-users-checks">
                              {departments.map((d) => (
                                <Checkbox
                                  key={d.id}
                                  label={`${d.short_code} · ${d.name}`}
                                  disabled={!canManageUsers}
                                  checked={(selectedCompany.department_ids ?? []).includes(d.id)}
                                  onChange={() =>
                                    void handleToggleCompanyDept(selectedCompany, d.id)
                                  }
                                />
                              ))}
                            </div>
                          </Stack>
                        </Panel>
                      )}
                    </div>
                  </div>
                ),
              },
              {
                id: 'departments',
                label: `Departments (${departments.length})`,
                content: (
                  <div className="org-users-depts">
                    {canManageDepts && (
                      <form onSubmit={handleCreateDept} className="org-users-toolbar">
                        <TextField
                          value={newDeptName}
                          onChange={(e) => setNewDeptName(e.target.value)}
                          placeholder="New department name"
                          required
                        />
                        <TextField
                          value={newDeptCode}
                          onChange={(e) => setNewDeptCode(e.target.value)}
                          placeholder="Short code (optional)"
                        />
                        <Button type="submit" size="sm" variant="primary">
                          Add Department
                        </Button>
                      </form>
                    )}
                    <div className="org-users-table-wrap">
                      <table className="org-users-table" aria-label="Departments catalog">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Short Code</th>
                            <th>Color</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {departments.map((d) => (
                            <tr key={d.id}>
                              <td>{d.name}</td>
                              <td>
                                <TextField
                                  disabled={!canManageDepts}
                                  defaultValue={d.short_code}
                                  onBlur={(e) => {
                                    const next = e.target.value.trim().toUpperCase();
                                    if (next && next !== d.short_code) {
                                      void handlePatchDept(d, { short_code: next });
                                    }
                                  }}
                                />
                              </td>
                              <td>
                                <ColorPicker
                                  ariaLabel={`${d.name} color`}
                                  disabled={!canManageDepts}
                                  value={deptColorDrafts[d.id] ?? deptColorHex(d.color)}
                                  onChange={(hex) => queueDeptColor(d, hex)}
                                />
                              </td>
                              <td>
                                <Checkbox
                                  label={d.is_active ? 'Active' : 'Disabled'}
                                  disabled={!canManageDepts}
                                  checked={d.is_active}
                                  onChange={(v) => void handlePatchDept(d, { is_active: v })}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ),
              },
              {
                id: 'time',
                label: 'Time & Capacity',
                content: (
                  <TimeCapacitySection
                    users={users}
                    onOpenProjectSettings={canAdmin ? () => setActiveTab('project') : undefined}
                  />
                ),
              },
            ];
            if (activeTab === 'roles' || activeTab === 'project' || activeTab === 'audit') {
              return <AdminConsoleContent section={activeTab} />;
            }
            return sections.find((sec) => sec.id === activeTab)?.content ?? null;
          })()}
        </div>
      </div>

      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen} title="Create New User">
        <form onSubmit={handleCreateUser} className="org-users-modal">
          <Stack gap="2">
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Username
              </Text>
              <TextField
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                required
              />
            </label>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Full Name
              </Text>
              <TextField
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                required
              />
            </label>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Email
              </Text>
              <TextField value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </label>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Temporary Password (min 10 chars)
              </Text>
              <TextField
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </label>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Role
              </Text>
              <Select
                ariaLabel="New user role"
                value={
                  newRoleId || roles.find((r) => r.name === 'artist')?.id || roles[0]?.id || ''
                }
                onChange={setNewRoleId}
                options={roles
                  .filter((r) => r.name !== 'admin' || auth?.user.role_name === 'admin')
                  .map((r) => ({ value: r.id, label: r.label }))}
              />
            </label>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Company
              </Text>
              <Select
                ariaLabel="New user company"
                value={newCompanyId || '__none__'}
                onChange={(v) => setNewCompanyId(v === '__none__' ? '' : v)}
                options={[
                  { value: '__none__', label: 'None' },
                  ...companies.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </label>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Daily Capacity (h)
              </Text>
              <TextField
                type="number"
                value={newCapHours}
                onChange={(e) => setNewCapHours(e.target.value)}
              />
            </label>
            <div className="org-users-modal-actions">
              <Button size="sm" onClick={() => setCreateUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary">
                Create User
              </Button>
            </div>
          </Stack>
        </form>
      </Dialog>

      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen} title="Reset User Password">
        <form onSubmit={handleResetPassword} className="org-users-modal">
          <Stack gap="2">
            <Text size="sm">
              Set a temporary password for <strong>{selectedUser?.username}</strong>. They will be
              forced to change it on next sign-in.
            </Text>
            <label className="org-users-field">
              <Text size="sm" variant="muted">
                Temporary Password (min 10 chars)
              </Text>
              <TextField
                type="password"
                value={resetPwValue}
                onChange={(e) => setResetPwValue(e.target.value)}
                required
              />
            </label>
            <div className="org-users-modal-actions">
              <Button size="sm" onClick={() => setResetPwOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary">
                Set Temporary Password
              </Button>
            </div>
          </Stack>
        </form>
      </Dialog>
    </AuthenticatedShell>
  );
}

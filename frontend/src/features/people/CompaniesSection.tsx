import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  ColorPicker,
  ConfirmDialog,
  Icon,
  InlineEdit,
  Panel,
  Select,
  Text,
  TextArea,
  TextField,
  UserPicker,
  type UserPickerOption,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import { apiClient, type CompanyOut, type DepartmentOut, type UserOut } from '../../lib/api/client';
import { deptColorHex } from '../departments/deptColors';
import { ActivationPeriodsEditor } from './ActivationPeriodsEditor';
import { DepartmentMultiSelect } from './DepartmentMultiSelect';
import { WorkHoursSummary } from './WorkHoursEditor';
import './people.css';

type Kind = 'internal' | 'external' | 'client' | 'group';
const KIND_GROUPS: ReadonlyArray<{ kind: Kind; label: string }> = [
  { kind: 'internal', label: 'Studios (internal)' },
  { kind: 'external', label: 'External studios' },
  { kind: 'client', label: 'Clients' },
  { kind: 'group', label: 'Groups' },
];
const KIND_OPTIONS = KIND_GROUPS.map((g) => ({ value: g.kind, label: g.kind }));

function Swatch({ color }: { color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVarRef(ref, '--co-swatch', deptColorHex(color));
  return <span ref={ref} className="org-co__swatch" aria-hidden="true" />;
}

/**
 * CR04 §11: studios / clients / groups as a master list (grouped by kind, departments nested)
 * plus a side panel with departments, members, activation periods, working hours, comments.
 */
export function CompaniesSection({
  companies,
  departments,
  users,
  projectUuid,
  canManage,
  canEditActivation,
  currentUserId,
}: {
  companies: ReadonlyArray<CompanyOut>;
  departments: ReadonlyArray<DepartmentOut>;
  users: ReadonlyArray<UserOut>;
  projectUuid: string | null;
  canManage: boolean;
  canEditActivation: boolean;
  currentUserId: string | null;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [selectedId, setSelectedId] = useState<string | null>(companies[0]?.id ?? null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newKind, setNewKind] = useState<Kind>('internal');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const q = query.trim().toLowerCase();
  const filtered = companies.filter((c) => {
    if (kindFilter !== 'all' && c.kind !== kindFilter) return false;
    if (!q) return true;
    const deptNames = (c.department_ids ?? []).map((id) => deptById.get(id)?.name ?? '');
    return [c.name, c.short_code, c.kind, ...deptNames].some((t) => t.toLowerCase().includes(q));
  });
  const selected = companies.find((c) => c.id === selectedId) ?? filtered[0] ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['companies', projectUuid] });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    try {
      await fn();
      await invalidate();
      if (ok) toast.push('success', ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const c = await apiClient.createCompany(
        {
          name: newName.trim(),
          short_code: newCode.trim().toUpperCase(),
          kind: newKind,
          color: '--series-1',
          notes: '',
          department_ids: [],
        },
        projectUuid,
      );
      setSelectedId(c.id);
      setNewName('');
      setNewCode('');
    }, 'Created');
  };

  return (
    <div className="org-co" data-ui="companies-section">
      <aside className="org-co__master">
        {canManage && (
          <form className="org-co__create" onSubmit={create}>
            <TextField
              aria-label="New company name"
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
            />
            <TextField
              aria-label="New company code"
              placeholder="CODE"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              required
            />
            <Select
              ariaLabel="New company kind"
              value={newKind}
              onChange={(v) => setNewKind(v as Kind)}
              options={KIND_OPTIONS}
            />
            <Button type="submit" size="sm" variant="primary">
              Add
            </Button>
          </form>
        )}
        <div className="org-co__filters">
          <TextField
            aria-label="Search companies"
            placeholder="Search name, code or department…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            ariaLabel="Company kind filter"
            value={kindFilter}
            onChange={(v) => setKindFilter(v as 'all' | Kind)}
            options={[{ value: 'all', label: 'All kinds' }, ...KIND_OPTIONS]}
          />
        </div>
        <nav className="org-co__tree" aria-label="Studios, clients and groups">
          {KIND_GROUPS.map((g) => {
            const list = filtered.filter((c) => c.kind === g.kind);
            if (list.length === 0) return null;
            return (
              <section key={g.kind} className="org-co__group">
                <Text size="sm" variant="muted">
                  {g.label} ({list.length})
                </Text>
                <ul className="org-co__list">
                  {list.map((c) => {
                    const open = expanded[c.id] ?? false;
                    const depts = (c.department_ids ?? [])
                      .map((id) => deptById.get(id))
                      .filter((d): d is DepartmentOut => Boolean(d));
                    return (
                      <li key={c.id}>
                        <div
                          className="org-co__item"
                          data-selected={selected?.id === c.id ? 'true' : undefined}
                        >
                          <button
                            type="button"
                            className="org-co__chev"
                            aria-label={`${open ? 'Collapse' : 'Expand'} ${c.name} departments`}
                            aria-expanded={open}
                            disabled={depts.length === 0}
                            onClick={() => setExpanded((p) => ({ ...p, [c.id]: !open }))}
                          >
                            <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
                          </button>
                          <button
                            type="button"
                            className="org-co__name"
                            aria-current={selected?.id === c.id ? 'true' : undefined}
                            onClick={() => setSelectedId(c.id)}
                          >
                            <Swatch color={c.color} />
                            <span>{c.name}</span>
                            <Badge tone="neutral">{c.short_code}</Badge>
                          </button>
                        </div>
                        {open && (
                          <ul className="org-co__depts">
                            {depts.map((d) => (
                              <li key={d.id}>
                                {d.short_code} · {d.name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {filtered.length === 0 && (
            <Text size="sm" variant="muted">
              Nothing matches.
            </Text>
          )}
        </nav>
      </aside>

      <section className="org-co__panel" aria-label="Company details">
        {error && <Banner severity="danger">{error}</Banner>}
        {!selected ? (
          <Text variant="muted">Select a studio, client or group.</Text>
        ) : (
          <CompanyPanel
            key={selected.id}
            company={selected}
            departments={departments}
            users={users}
            projectUuid={projectUuid}
            canManage={canManage}
            canEditActivation={canEditActivation}
            currentUserId={currentUserId}
            run={run}
            onDelete={() => setConfirmDelete(true)}
          />
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${selected?.name ?? ''}"?`}
        onConfirm={() =>
          run(async () => {
            if (!selected) return;
            await apiClient.deleteCompany(selected.id, projectUuid);
            setSelectedId(null);
          }, 'Deleted')
        }
      >
        <Text>Members keep their accounts but lose this company link.</Text>
      </ConfirmDialog>
    </div>
  );
}

function CompanyPanel({
  company,
  departments,
  users,
  projectUuid,
  canManage,
  canEditActivation,
  currentUserId,
  run,
  onDelete,
}: {
  company: CompanyOut;
  departments: ReadonlyArray<DepartmentOut>;
  users: ReadonlyArray<UserOut>;
  projectUuid: string | null;
  canManage: boolean;
  canEditActivation: boolean;
  currentUserId: string | null;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();
  const membersKey = ['company-members', projectUuid, company.id];
  const commentsKey = ['company-comments', projectUuid, company.id];
  const members = useQuery({
    queryKey: membersKey,
    queryFn: () => apiClient.getCompanyMembers(company.id, projectUuid),
  });
  const comments = useQuery({
    queryKey: commentsKey,
    queryFn: () => apiClient.listCompanyComments(company.id, projectUuid),
  });
  const [note, setNote] = useState('');

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const options: UserPickerOption[] = users.map((u) => ({
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    roleLabel: u.role_label,
    companyName: u.company_name,
    departmentIds: u.department_ids ?? [],
    avatarUrl: u.avatar_file ? apiClient.userAvatarUrl(u.id, projectUuid) : null,
    isActive: u.is_active,
  }));
  const primary = members.data?.primary_user_ids ?? [];
  const linked = members.data?.linked_user_ids ?? [];
  const everyone = [...primary, ...linked]
    .map((id) => userById.get(id))
    .filter((u): u is UserOut => Boolean(u));

  const patch = (p: Parameters<typeof apiClient.updateCompany>[1]) =>
    run(() => apiClient.updateCompany(company.id, p, projectUuid));

  return (
    <div className="org-co__detail" data-ui="company-panel">
      <div className="org-co__header">
        <Swatch color={company.color} />
        {canManage ? (
          <InlineEdit
            ariaLabel="Company name"
            value={company.name}
            onCommit={(name) => patch({ name })}
          />
        ) : (
          <strong>{company.name}</strong>
        )}
        {canManage ? (
          <InlineEdit
            ariaLabel="Company code"
            mono
            value={company.short_code}
            onCommit={(short_code) => patch({ short_code: short_code.toUpperCase() })}
          />
        ) : (
          <Badge tone="neutral">{company.short_code}</Badge>
        )}
        <Select
          ariaLabel="Company kind"
          disabled={!canManage}
          value={company.kind}
          onChange={(kind) => void patch({ kind: kind as Kind })}
          options={KIND_OPTIONS}
        />
        <ColorPicker
          ariaLabel="Company color"
          disabled={!canManage}
          value={deptColorHex(company.color)}
          onChange={(color) => void patch({ color })}
        />
        {canManage && (
          <Button size="sm" variant="icon" aria-label="Delete company" onClick={onDelete}>
            <Icon name="trash" size="sm" />
          </Button>
        )}
      </div>

      <Panel title="Departments">
        <DepartmentMultiSelect
          ariaLabel="Company departments"
          departments={departments}
          selectedIds={company.department_ids ?? []}
          disabled={!canManage}
          onChange={(ids) =>
            void run(() => apiClient.setCompanyDepartments(company.id, ids, projectUuid))
          }
        />
      </Panel>

      <Panel title={`Members (${everyone.length})`}>
        <div className="org-co__members">
          {everyone.length === 0 && (
            <Text size="sm" variant="muted">
              Nobody yet.
            </Text>
          )}
          <ul className="org-co__people" aria-label="Members">
            {everyone.map((u) => (
              <li key={u.id}>
                <Avatar
                  username={u.username}
                  fullName={u.full_name}
                  avatarUrl={u.avatar_file ? apiClient.userAvatarUrl(u.id, projectUuid) : null}
                  size="sm"
                />
                <span>{u.full_name}</span>
                <Badge tone="neutral">{u.role_label}</Badge>
                <Badge tone={primary.includes(u.id) ? 'accent' : 'info'}>
                  {primary.includes(u.id) ? 'primary' : 'linked'}
                </Badge>
                <WorkHoursSummary userId={u.id} projectUuid={projectUuid} />
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="org-co__link">
              <Text size="sm" variant="muted">
                Link people (any studio, internal or external):
              </Text>
              <UserPicker
                ariaLabel="Link people"
                users={options.filter((o) => !primary.includes(o.id))}
                selectedIds={linked}
                multi
                placeholder="Link people…"
                onChange={(ids) =>
                  void run(async () => {
                    await apiClient.putCompanyMembers(company.id, ids, projectUuid);
                    await queryClient.invalidateQueries({ queryKey: membersKey });
                  })
                }
              />
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Activation periods">
        <ActivationPeriodsEditor
          targetKind="company"
          targetId={company.id}
          projectUuid={projectUuid}
          editable={canEditActivation}
        />
      </Panel>

      <Panel title={`Comments (${comments.data?.length ?? 0})`}>
        <form
          className="org-co__comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void run(async () => {
              await apiClient.addCompanyComment(company.id, note.trim(), projectUuid);
              setNote('');
              await queryClient.invalidateQueries({ queryKey: commentsKey });
            });
          }}
        >
          <TextArea
            aria-label="New comment"
            placeholder="Add a dated note (contract, availability, contacts…)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={!note.trim()}>
            Add note
          </Button>
        </form>
        <ul className="org-co__comments" aria-label="Comments">
          {(comments.data ?? []).map((c) => (
            <li key={c.id}>
              <div className="org-co__comment-meta">
                <strong>{c.author_name ?? 'Unknown'}</strong>
                <Text size="sm" variant="muted">
                  {new Date(c.created_at).toLocaleString()}
                </Text>
                {(canManage || c.author_id === currentUserId) && (
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label="Delete comment"
                    onClick={() =>
                      void run(async () => {
                        await apiClient.deleteCompanyComment(company.id, c.id, projectUuid);
                        await queryClient.invalidateQueries({ queryKey: commentsKey });
                      })
                    }
                  >
                    <Icon name="trash" size="sm" />
                  </Button>
                )}
              </div>
              <Text>{c.body}</Text>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

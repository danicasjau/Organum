import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  CapacityBadgeList,
  Checkbox,
  Icon,
  Inline,
  NumberField,
  PriorityMarker,
  ScrollArea,
  Select,
  Spinner,
  Stack,
  StatusChip,
  Text,
  TextArea,
  TextField,
  UserPicker,
  useToast,
  type UserPickerOption,
} from '../../components/ui';
import {
  apiClient,
  type ClientTaskDetailOut,
  type CompanyOut,
  type TaskDetailOut,
  type TransitionOptionOut,
  type UserOut,
} from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { ShareWithClientDialog } from './ShareWithClientDialog';
import {
  canPerformOnTask,
  formatActedAsLabel,
  isFullTaskDetail,
  isOverdueDate,
  PRIORITY_OPTIONS,
  splitMentionSegments,
} from './taskHelpers';
import { TaskTransitionDialog } from './TaskTransitionDialog';
import './TaskDetail.css';

const EMPTY_USERS: UserOut[] = [];
const EMPTY_COMPANIES: CompanyOut[] = [];

function SectionBlock({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="org-tdet__section">
      <button
        type="button"
        className="org-tdet__sec-hdr"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="sm" />
        <span className="org-tdet__sec-title">{title}</span>
        {badge && <Badge tone="neutral">{badge}</Badge>}
      </button>
      {open && <div className="org-tdet__sec-body">{children}</div>}
    </section>
  );
}

function CommentBody({ body }: { body: string }) {
  const segs = splitMentionSegments(body);
  return (
    <span className="org-tdet__cmt-text">
      {segs.map((s, i) =>
        s.isMention ? (
          <span key={`${i}-${s.text}`} className="org-tdet__mention">
            {s.text}
          </span>
        ) : (
          <span key={`${i}-${s.text}`}>{s.text}</span>
        ),
      )}
    </span>
  );
}

export interface TaskDetailProps {
  taskId: string;
  compact?: boolean;
  onClose?: () => void;
  onOpenInViewer?: (opts: { taskId: string; fileId?: string | null; frame?: number | null }) => void;
  onSelectTask?: (taskId: string) => void;
}

export function TaskDetail({
  taskId,
  compact = false,
  onClose,
  onOpenInViewer,
  onSelectTask,
}: TaskDetailProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const isClientRole = auth?.user.role_name === 'client';

  const {
    data: detail,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['task', activeProjectUuid, taskId],
    queryFn: () => apiClient.getTask(taskId, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && taskId),
  });

  const canViewUsers = hasPerm(auth?.permissions, 'user.view') && !isClientRole;
  const { data: usersData } = useQuery({
    queryKey: ['users', activeProjectUuid],
    queryFn: () => apiClient.listUsers(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && canViewUsers),
  });
  const users = usersData ?? EMPTY_USERS;

  const canViewCompanies =
    !isClientRole &&
    (hasPerm(auth?.permissions, 'user.view') || hasPerm(auth?.permissions, 'task.share_client'));
  const { data: companiesData } = useQuery({
    queryKey: ['companies', activeProjectUuid],
    queryFn: () => apiClient.listCompanies(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && canViewCompanies),
  });
  const companies = companiesData ?? EMPTY_COMPANIES;

  const [depPickerOpen, setDepPickerOpen] = useState(false);
  const { data: depCandidateResp } = useQuery({
    queryKey: ['tasks-dep-candidates', activeProjectUuid],
    queryFn: () => apiClient.listTasks({ limit: 200, sort: 'code' }, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && depPickerOpen && !isClientRole),
  });

  const [descDraft, setDescDraft] = useState('');
  const [bidDraft, setBidDraft] = useState<number>(0);
  const [idealStartDraft, setIdealStartDraft] = useState('');
  const [idealFinishDraft, setIdealFinishDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [logHours, setLogHours] = useState<number>(1);
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logNote, setLogNote] = useState('');
  const [depTargetId, setDepTargetId] = useState('');
  const [depThreshold, setDepThreshold] = useState<'APP' | 'PUBLISHED' | 'ANY_STATUS'>('APP');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentClientVis, setCommentClientVis] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<TransitionOptionOut | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!detail) return;
    setDescDraft(detail.description ?? '');
    setConflictMsg(null);
    if (isFullTaskDetail(detail)) {
      setBidDraft(detail.bid_hours ?? 0);
      setIdealStartDraft(detail.ideal_start_date ?? '');
      setIdealFinishDraft(detail.ideal_finish_date ?? '');
    }
  }, [detail]);

  const invalidateTask = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid, taskId] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['my-tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['review-queue', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] }),
    ]);
  };

  const flashSaved = () => {
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleOpenViewer = (fileId?: string | null, frame?: number | null) => {
    if (onOpenInViewer) {
      onOpenInViewer({ taskId, fileId, frame });
      return;
    }
    const qs = new URLSearchParams();
    qs.set('task', taskId);
    if (fileId) qs.set('file', fileId);
    if (frame !== null && frame !== undefined) qs.set('frame', String(frame));
    navigate(`/viewer?${qs.toString()}`);
  };

  const companyById = useMemo(() => {
    const m = new Map<string, CompanyOut>();
    for (const c of companies) m.set(c.id, c);
    return m;
  }, [companies]);

  const userOptions: UserPickerOption[] = useMemo(
    () =>
      users.map((u) => ({
        id: u.id,
        username: u.username,
        fullName: u.full_name,
        roleLabel: u.role_label,
        companyName: u.company_id ? companyById.get(u.company_id)?.name ?? null : null,
        departmentIds: u.department_ids ?? [],
        avatarUrl: u.avatar_file
          ? apiClient.userAvatarUrl(u.id, activeProjectUuid)
          : null,
        isActive: u.is_active,
      })),
    [users, companyById, activeProjectUuid],
  );

  if (isLoading) {
    return (
      <div className="org-tdet org-tdet--loading" data-ui="task-detail">
        <Spinner label="Loading task" />
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="org-tdet" data-ui="task-detail">
        <Banner severity="danger">
          {error instanceof Error ? error.message : 'Unable to load task details'}
        </Banner>
      </div>
    );
  }

  const executeTransition = async (
    opt: TransitionOptionOut,
    extra: { version_id?: string | null; comment?: string | null } = {},
  ) => {
    try {
      await apiClient.transitionTask(
        taskId,
        {
          to: opt.to,
          version_id: extra.version_id ?? null,
          comment: extra.comment ?? null,
        },
        activeProjectUuid,
      );
      await invalidateTask();
      flashSaved();
      toast.push('success', `${detail.task_code} -> ${opt.to}`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Transition failed');
    }
  };

  const handleTransitionClick = (opt: TransitionOptionOut) => {
    if (opt.requires_comment || opt.requires_version) {
      setPendingTransition(opt);
    } else {
      void executeTransition(opt);
    }
  };

  const handlePostComment = async () => {
    const body = commentDraft.trim();
    if (!body) return;
    try {
      const visibility = isClientRole || commentClientVis ? 'client' : 'internal';
      await apiClient.createTaskComment(
        taskId,
        { body, kind: 'note', visibility },
        activeProjectUuid,
      );
      setCommentDraft('');
      await invalidateTask();
      flashSaved();
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Failed to post comment');
    }
  };

  // Client reduced allowlist view (§15)
  if (!isFullTaskDetail(detail)) {
    const cDetail: ClientTaskDetailOut = detail;
    const clientVersions = cDetail.product?.versions ?? [];
    const canClientComment = hasPerm(auth?.permissions, 'task.comment');

    return (
      <div className="org-tdet" data-ui="task-detail" data-client-mode="true">
        <div className="org-tdet__hdr">
          <div className="org-tdet__hdr-top">
            <Text size="sm" variant="mono">
              {cDetail.task_code}
            </Text>
            <StatusChip status={cDetail.status} />
            {onClose && (
              <Button size="sm" variant="icon" aria-label="Close task detail" onClick={onClose}>
                <Icon name="close" size="sm" />
              </Button>
            )}
          </div>
          <Text size="lg" variant="accent">
            {cDetail.task_name}
          </Text>
          <Text size="sm" variant="muted">
            {cDetail.entity_name} · {cDetail.department_name}
            {cDetail.ideal_finish_date ? ` · Due ${cDetail.ideal_finish_date}` : ''}
          </Text>
          {(cDetail.allowed_transitions ?? []).length > 0 && (
            <div className="org-tdet__actions">
              {(cDetail.allowed_transitions ?? []).map((opt) => (
                <Button
                  key={`${opt.to}-${opt.action}`}
                  size="sm"
                  variant={opt.to === 'APP' ? 'success' : opt.to === 'RTK' ? 'danger' : 'primary'}
                  onClick={() => handleTransitionClick(opt)}
                >
                  {opt.action}
                </Button>
              ))}
            </div>
          )}
        </div>

        <ScrollArea className="org-tdet__scroll">
          <SectionBlock title="Summary">
            <Text size="sm">{cDetail.description || 'No description provided.'}</Text>
          </SectionBlock>

          <SectionBlock title="Shared Versions" badge={String(clientVersions.length)}>
            {clientVersions.length === 0 ? (
              <Text size="sm" variant="muted">
                No versions shared yet.
              </Text>
            ) : (
              <Stack gap="1">
                {clientVersions.map((ver) => (
                  <div key={ver.id} className="org-tdet__row-box">
                    <span>
                      <strong>{ver.label}</strong> ({ver.files?.length ?? 0} files)
                    </span>
                    <Button
                      size="sm"
                      onClick={() => handleOpenViewer(ver.files?.[0]?.id ?? null)}
                    >
                      Open in viewer
                    </Button>
                  </div>
                ))}
              </Stack>
            )}
          </SectionBlock>

          <SectionBlock title="Reviews & Comments" badge={String((cDetail.comments ?? []).length)}>
            <Stack gap="2">
              {(cDetail.reviews ?? []).map((rev) => (
                <div key={rev.id} className="org-tdet__row-box">
                  <Badge tone={rev.decision === 'approved' ? 'success' : rev.decision === 'retake' ? 'danger' : 'neutral'}>
                    Round {rev.round_no} · {rev.stage.toUpperCase()} · {rev.decision}
                  </Badge>
                </div>
              ))}
              {(cDetail.comments ?? []).map((cmt) => (
                <div key={cmt.id} className="org-tdet__cmt">
                  <div className="org-tdet__cmt-meta">
                    <Text size="sm" variant="accent">
                      {cmt.author_full_name ?? 'Reviewer'}
                    </Text>
                    <Badge tone="info">client</Badge>
                    {cmt.file_id && (
                      <Button
                        size="sm"
                        onClick={() => handleOpenViewer(cmt.file_id, cmt.frame ?? null)}
                      >
                        View frame {cmt.frame ?? 0}
                      </Button>
                    )}
                  </div>
                  <CommentBody body={cmt.body} />
                </div>
              ))}
              {canClientComment && (
                <Stack gap="1">
                  <TextArea
                    aria-label="Client comment"
                    rows={2}
                    placeholder="Write client review note..."
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!commentDraft.trim()}
                    onClick={() => void handlePostComment()}
                  >
                    Post Client Comment
                  </Button>
                </Stack>
              )}
            </Stack>
          </SectionBlock>
        </ScrollArea>

        <TaskTransitionDialog
          open={Boolean(pendingTransition)}
          onOpenChange={(o) => {
            if (!o) setPendingTransition(null);
          }}
          taskCode={cDetail.task_code}
          taskName={cDetail.task_name}
          targetStatus={pendingTransition?.to ?? ''}
          actionLabel={pendingTransition?.action ?? ''}
          actedAsLabel={formatActedAsLabel(
            pendingTransition?.acted_as,
            pendingTransition?.on_behalf,
          )}
          requiresComment={Boolean(pendingTransition?.requires_comment)}
          requiresVersion={Boolean(pendingTransition?.requires_version)}
          versions={clientVersions}
          onSubmit={async (payload) => {
            if (pendingTransition) {
              await executeTransition(pendingTransition, payload);
            }
          }}
        />
      </div>
    );
  }

  // Internal Full View
  const full: TaskDetailOut = detail;
  const myCaps = full.my_capacities ?? [];
  const canEditFields = canPerformOnTask(auth, 'task.edit_fields', myCaps);
  const canEditSchedule = canPerformOnTask(auth, 'task.edit_schedule', myCaps);
  const canAssign = canPerformOnTask(auth, 'task.assign', myCaps);
  const canEditDeps = canPerformOnTask(auth, 'task.dependencies', myCaps);
  const canLogTime = canPerformOnTask(auth, 'task.log_time', myCaps);
  const canComment = canPerformOnTask(auth, 'task.comment', myCaps);
  const canShareClient = canPerformOnTask(auth, 'task.share_client', myCaps);
  const canShowAllDepts = auth?.user.role_name === 'admin' || auth?.permissions['task.assign'] === 'all';

  const patchWithConflict = async (payload: Record<string, unknown>) => {
    setConflictMsg(null);
    try {
      await apiClient.patchTask(
        taskId,
        { ...payload, expected_updated_at: full.updated_at },
        activeProjectUuid,
      );
      await invalidateTask();
      flashSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      if (msg.toLowerCase().includes('conflict') || msg.toLowerCase().includes('modified')) {
        setConflictMsg(msg);
      } else {
        toast.push('danger', msg);
      }
    }
  };

  const assignForRole = (role: 'artist' | 'lead' | 'supervisor') =>
    (full.assignments ?? []).filter((a) => a.assignment_role === role).map((a) => a.user_id);

  const updateAssignmentsRole = async (
    role: 'artist' | 'lead' | 'supervisor',
    nextIds: string[],
  ) => {
    const kept = (full.assignments ?? [])
      .filter((a) => a.assignment_role !== role)
      .map((a) => ({ user_id: a.user_id, assignment_role: a.assignment_role }));
    const replaced = nextIds.map((uid) => ({ user_id: uid, assignment_role: role }));
    try {
      await apiClient.putTaskAssignments(taskId, [...kept, ...replaced], activeProjectUuid);
      await invalidateTask();
      flashSaved();
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Assignment update failed');
    }
  };

  const versions = full.product?.versions ?? [];
  const overdue = isOverdueDate(full.ideal_finish_date, full.status);

  return (
    <div
      className={`org-tdet${compact ? ' org-tdet--compact' : ''}`}
      data-ui="task-detail"
      data-task-id={full.id}
    >
      <div className="org-tdet__hdr">
        <div className="org-tdet__hdr-top">
          <Text size="sm" variant="mono">
            {full.task_code}
          </Text>
          <StatusChip status={full.status} />
          <PriorityMarker priority={full.priority ?? 'normal'} />
          {full.blocked_upstream && (
            <span title="An upstream dependency is currently unmet">
              <Badge tone="danger">Blocked</Badge>
            </span>
          )}
          {savedNotice && <Badge tone="success">Saved</Badge>}
          {onClose && (
            <Button size="sm" variant="icon" aria-label="Close task detail" onClick={onClose}>
              <Icon name="close" size="sm" />
            </Button>
          )}
        </div>

        <Text size="lg" variant="accent">
          {full.task_name}
        </Text>

        <div className="org-tdet__sub">
          <Text size="sm" variant="muted">
            {full.entity_name} · {full.department_name}
          </Text>
          {myCaps.length > 0 && (
            <span className="org-tdet__you-are">
              <Text size="sm" variant="muted">
                You are:
              </Text>
              <CapacityBadgeList capacities={myCaps} />
            </span>
          )}
        </div>

        {conflictMsg && (
          <Banner severity="warning">
            <span>{conflictMsg}</span>
            <Button size="sm" onClick={() => void refetch()}>
              Reload
            </Button>
          </Banner>
        )}

        {(full.allowed_transitions ?? []).length > 0 && (
          <div className="org-tdet__actions" aria-label="Workflow actions">
            {(full.allowed_transitions ?? []).map((opt) => {
              const actedLabel = formatActedAsLabel(opt.acted_as, opt.on_behalf);
              const btnLabel = actedLabel ? `${opt.action} ${actedLabel}` : opt.action;
              return (
                <Button
                  key={`${opt.to}-${opt.action}`}
                  size="sm"
                  variant={
                    opt.to === 'APP'
                      ? 'success'
                      : opt.to === 'RTK'
                        ? 'danger'
                        : opt.to === 'IP' || opt.to.startsWith('P_')
                          ? 'primary'
                          : 'default'
                  }
                  onClick={() => handleTransitionClick(opt)}
                >
                  {btnLabel}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      <ScrollArea className="org-tdet__scroll">
        <SectionBlock title="Summary">
          <Stack gap="2">
            <Inline gap="2">
              <Button size="sm" onClick={() => navigate('/entities')}>
                Entity: {full.entity_name}
              </Button>
              <Badge tone="neutral">{full.department_name}</Badge>
              {full.parent_entity_type && <Badge tone="accent">{full.parent_entity_type}</Badge>}
            </Inline>

            <div className="org-tdet__grid2">
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Priority
                </Text>
                {canEditFields ? (
                  <Select
                    ariaLabel="Task priority"
                    value={full.priority ?? 'normal'}
                    onChange={(val) => void patchWithConflict({ priority: val })}
                    options={[...PRIORITY_OPTIONS]}
                  />
                ) : (
                  <Text size="sm" className="org-tdet__readonly">
                    {full.priority ?? 'normal'}
                  </Text>
                )}
              </Stack>

              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Complexity (1–5)
                </Text>
                {canEditFields ? (
                  <Select
                    ariaLabel="Task complexity"
                    value={full.complexity_rating ? String(full.complexity_rating) : 'none'}
                    onChange={(val) =>
                      void patchWithConflict({
                        complexity_rating: val === 'none' ? null : Number(val),
                      })
                    }
                    options={[
                      { value: 'none', label: 'Unset' },
                      { value: '1', label: '1 - Simple' },
                      { value: '2', label: '2 - Easy' },
                      { value: '3', label: '3 - Medium' },
                      { value: '4', label: '4 - Hard' },
                      { value: '5', label: '5 - Hero' },
                    ]}
                  />
                ) : (
                  <Text size="sm" className="org-tdet__readonly">
                    {full.complexity_rating ?? '—'}
                  </Text>
                )}
              </Stack>
            </div>

            <div className="org-tdet__checks">
              <Checkbox
                label="Lead review"
                checked={Boolean(full.needs_lead_review)}
                disabled={!canEditFields}
                onChange={(checked) => void patchWithConflict({ needs_lead_review: checked })}
              />
              <Checkbox
                label="Sup review"
                checked={Boolean(full.needs_sup_review)}
                disabled={!canEditFields}
                onChange={(checked) => void patchWithConflict({ needs_sup_review: checked })}
              />
              <Checkbox
                label="Client review"
                checked={Boolean(full.needs_client_review)}
                disabled={!canEditFields}
                onChange={(checked) => void patchWithConflict({ needs_client_review: checked })}
              />
            </div>

            <Stack gap="1">
              <Text size="sm" variant="muted">
                Description
              </Text>
              {canEditFields ? (
                <Stack gap="1">
                  <TextArea
                    aria-label="Task description"
                    rows={2}
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                  />
                  {descDraft !== (full.description ?? '') && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void patchWithConflict({ description: descDraft })}
                    >
                      Save Description
                    </Button>
                  )}
                </Stack>
              ) : (
                <Text size="sm" className="org-tdet__readonly">
                  {full.description || '—'}
                </Text>
              )}
            </Stack>

            <Stack gap="1">
              <Text size="sm" variant="muted">
                Tags ({full.tags?.length ?? 0})
              </Text>
              <Inline gap="1" wrap>
                {(full.tags ?? []).map((t) => (
                  <Badge key={t} tone="neutral">
                    {t}{' '}
                    {canEditFields && (
                      <button
                        type="button"
                        className="org-tdet__xbtn"
                        aria-label={`Remove tag ${t}`}
                        onClick={async () => {
                          await apiClient.putTaskTags(
                            taskId,
                            (full.tags ?? []).filter((x) => x !== t),
                            activeProjectUuid,
                          );
                          await invalidateTask();
                        }}
                      >
                        ×
                      </button>
                    )}
                  </Badge>
                ))}
              </Inline>
              {canEditFields && (
                <Inline gap="1">
                  <TextField
                    aria-label="Add task tag"
                    placeholder="Add tag..."
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const clean = tagDraft.trim();
                      if (!clean) return;
                      await apiClient.putTaskTags(
                        taskId,
                        Array.from(new Set([...(full.tags ?? []), clean])),
                        activeProjectUuid,
                      );
                      setTagDraft('');
                      await invalidateTask();
                    }}
                  >
                    Add
                  </Button>
                </Inline>
              )}
            </Stack>
          </Stack>
        </SectionBlock>

        <SectionBlock title="People" badge={String(full.assignments?.length ?? 0)}>
          <Stack gap="2">
            {canViewUsers ? (
              <>
                <div className="org-tdet__pick-row">
                  <Text size="sm">Artists (DO)</Text>
                  <UserPicker
                    ariaLabel="Assign artists"
                    users={userOptions}
                    selectedIds={assignForRole('artist')}
                    departmentId={full.department_id}
                    canShowAll={canShowAllDepts}
                    disabled={!canAssign}
                    placeholder="Assign artist..."
                    onChange={(ids) => void updateAssignmentsRole('artist', ids)}
                  />
                </div>
                <div className="org-tdet__pick-row">
                  <Text size="sm">Leads (LEAD)</Text>
                  <UserPicker
                    ariaLabel="Assign leads"
                    users={userOptions}
                    selectedIds={assignForRole('lead')}
                    departmentId={full.department_id}
                    canShowAll={canShowAllDepts}
                    disabled={!canAssign}
                    placeholder="Assign lead..."
                    onChange={(ids) => void updateAssignmentsRole('lead', ids)}
                  />
                </div>
                <div className="org-tdet__pick-row">
                  <Text size="sm">Supervisors (SUP)</Text>
                  <UserPicker
                    ariaLabel="Assign supervisors"
                    users={userOptions}
                    selectedIds={assignForRole('supervisor')}
                    departmentId={full.department_id}
                    canShowAll={canShowAllDepts}
                    disabled={!canAssign}
                    placeholder="Assign supervisor..."
                    onChange={(ids) => void updateAssignmentsRole('supervisor', ids)}
                  />
                </div>
              </>
            ) : (
              <Stack gap="1">
                {(full.assignments ?? []).map((a) => (
                  <div key={`${a.user_id}-${a.assignment_role}`} className="org-tdet__row-box">
                    <Inline gap="1">
                      <Avatar username={a.username} fullName={a.full_name} size="sm" />
                      <Text size="sm">{a.full_name}</Text>
                    </Inline>
                    <CapacityBadgeList capacities={[a.assignment_role]} />
                  </div>
                ))}
              </Stack>
            )}
          </Stack>
        </SectionBlock>

        <SectionBlock title="Schedule & Time" badge={`${full.logged_hours ?? 0}h`}>
          <Stack gap="2">
            <div className="org-tdet__grid2">
              <label className="org-tdet__field">
                <Text size="sm" variant="muted">
                  Ideal Start
                </Text>
                {canEditSchedule ? (
                  <input
                    type="date"
                    className="org-tdet__date"
                    aria-label="Ideal start date"
                    value={idealStartDraft}
                    onChange={(e) => {
                      const v = e.target.value;
                      setIdealStartDraft(v);
                      void patchWithConflict({ ideal_start_date: v || null });
                    }}
                  />
                ) : (
                  <Text size="sm" className="org-tdet__readonly">
                    {full.ideal_start_date ?? '—'}
                  </Text>
                )}
              </label>

              <label className="org-tdet__field">
                <Text size="sm" variant="muted">
                  Ideal Finish
                </Text>
                {canEditSchedule ? (
                  <input
                    type="date"
                    className={`org-tdet__date${overdue ? ' org-tdet__date--overdue' : ''}`}
                    aria-label="Ideal finish date"
                    value={idealFinishDraft}
                    onChange={(e) => {
                      const v = e.target.value;
                      setIdealFinishDraft(v);
                      void patchWithConflict({ ideal_finish_date: v || null });
                    }}
                  />
                ) : (
                  <Text
                    size="sm"
                    variant={overdue ? 'danger' : 'mono'}
                    className="org-tdet__readonly"
                  >
                    {full.ideal_finish_date ?? '—'}
                  </Text>
                )}
              </label>
            </div>

            <div className="org-tdet__grid2">
              <Text size="sm" variant="muted">
                Actual Start: <span className="org-tdet__mono">{full.actual_start_date ?? '—'}</span>
              </Text>
              <Text size="sm" variant="muted">
                Actual Finish: <span className="org-tdet__mono">{full.actual_finish_date ?? '—'}</span>
              </Text>
            </div>

            <div className="org-tdet__grid2">
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Bid Hours {full.bid_days !== null && full.bid_days !== undefined ? `(${full.bid_days}d)` : ''}
                </Text>
                {canEditFields ? (
                  <Inline gap="1">
                    <NumberField
                      ariaLabel="Bid hours"
                      value={bidDraft}
                      min={0}
                      max={10000}
                      step={1}
                      precision={1}
                      onChange={setBidDraft}
                    />
                    {bidDraft !== (full.bid_hours ?? 0) && (
                      <Button
                        size="sm"
                        onClick={() => void patchWithConflict({ bid_hours: bidDraft })}
                      >
                        Set
                      </Button>
                    )}
                  </Inline>
                ) : (
                  <Text size="sm" variant="mono" className="org-tdet__readonly">
                    {full.bid_hours ?? 0}h
                  </Text>
                )}
              </Stack>

              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Logged / Retakes
                </Text>
                <Text size="sm" variant="mono">
                  {full.logged_hours ?? 0}h logged · {full.retake_count ?? 0} retakes
                </Text>
              </Stack>
            </div>

            {canLogTime && (
              <div className="org-tdet__timelog-form">
                <NumberField
                  ariaLabel="Log hours"
                  value={logHours}
                  min={0.25}
                  max={24}
                  step={0.5}
                  precision={2}
                  onChange={setLogHours}
                />
                <input
                  type="date"
                  className="org-tdet__date"
                  aria-label="Work date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
                <TextField
                  aria-label="Time log note"
                  placeholder="Work note..."
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    try {
                      await apiClient.createTimeLog(
                        taskId,
                        { hours: logHours, work_date: logDate, note: logNote.trim() },
                        activeProjectUuid,
                      );
                      setLogNote('');
                      await invalidateTask();
                      flashSaved();
                    } catch (err) {
                      toast.push('danger', err instanceof Error ? err.message : 'Time log failed');
                    }
                  }}
                >
                  Log Time
                </Button>
              </div>
            )}

            {(full.time_logs ?? []).slice(0, 6).map((lg) => (
              <div key={lg.id} className="org-tdet__row-box">
                <span className="org-tdet__mono">
                  {lg.work_date} · {lg.hours}h · {lg.full_name ?? lg.username ?? 'User'}
                  {lg.note ? ` — ${lg.note}` : ''}
                </span>
                {(lg.user_id === auth?.user.id || canEditFields) && (
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label="Delete time log"
                    onClick={async () => {
                      await apiClient.deleteTimeLog(taskId, lg.id, activeProjectUuid);
                      await invalidateTask();
                    }}
                  >
                    <Icon name="trash" size="sm" />
                  </Button>
                )}
              </div>
            ))}
          </Stack>
        </SectionBlock>

        <SectionBlock
          title="Dependencies"
          badge={`${(full.dependencies ?? []).length}↑ / ${(full.downstream ?? []).length}↓`}
        >
          <Stack gap="2">
            {(full.dependencies ?? []).length === 0 ? (
              <Text size="sm" variant="muted">
                No upstream dependencies.
              </Text>
            ) : (
              (full.dependencies ?? []).map((d) => (
                <div key={d.upstream_task_id} className="org-tdet__row-box">
                  <button
                    type="button"
                    className="org-tdet__linkbtn"
                    onClick={() => onSelectTask?.(d.upstream_task_id)}
                  >
                    <span className="org-tdet__mono">{d.upstream_task_code}</span>
                    <StatusChip status={d.upstream_status ?? 'WTG'} compact />
                    <Badge tone={d.satisfied ? 'success' : 'warning'}>{d.threshold}</Badge>
                    {d.from_entity_link && (
                      <span title="Generated from entity link">
                        <Badge tone="info">via link</Badge>
                      </span>
                    )}
                  </button>
                  {canEditDeps && (
                    <Button
                      size="sm"
                      variant="icon"
                      aria-label={`Remove dependency ${d.upstream_task_code}`}
                      onClick={async () => {
                        const next = (full.dependencies ?? [])
                          .filter((x) => x.upstream_task_id !== d.upstream_task_id)
                          .map((x) => ({
                            upstream_task_id: x.upstream_task_id,
                            threshold: (x.threshold ?? 'APP') as 'APP' | 'PUBLISHED' | 'ANY_STATUS',
                            from_entity_link: Boolean(x.from_entity_link),
                          }));
                        await apiClient.putTaskDependencies(taskId, next, activeProjectUuid);
                        await invalidateTask();
                      }}
                    >
                      <Icon name="close" size="sm" />
                    </Button>
                  )}
                </div>
              ))
            )}

            {canEditDeps && (
              <Stack gap="1">
                {!depPickerOpen ? (
                  <Button size="sm" onClick={() => setDepPickerOpen(true)}>
                    + Add Upstream Dependency
                  </Button>
                ) : (
                  <div className="org-tdet__dep-add">
                    <Select
                      ariaLabel="Upstream task"
                      value={depTargetId}
                      onChange={setDepTargetId}
                      options={[
                        { value: '', label: 'Select upstream task...' },
                        ...(depCandidateResp?.items ?? [])
                          .filter((cand) => cand.id !== taskId)
                          .map((cand) => ({
                            value: cand.id,
                            label: `${cand.task_code} (${cand.status})`,
                          })),
                      ]}
                    />
                    <Select
                      ariaLabel="Dependency threshold"
                      value={depThreshold}
                      onChange={(v) =>
                        setDepThreshold(v as 'APP' | 'PUBLISHED' | 'ANY_STATUS')
                      }
                      options={[
                        { value: 'APP', label: 'APP' },
                        { value: 'PUBLISHED', label: 'PUBLISHED' },
                        { value: 'ANY_STATUS', label: 'ANY_STATUS' },
                      ]}
                    />
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!depTargetId}
                      onClick={async () => {
                        try {
                          const existing = (full.dependencies ?? []).map((x) => ({
                            upstream_task_id: x.upstream_task_id,
                            threshold: (x.threshold ?? 'APP') as 'APP' | 'PUBLISHED' | 'ANY_STATUS',
                            from_entity_link: Boolean(x.from_entity_link),
                          }));
                          await apiClient.putTaskDependencies(
                            taskId,
                            [
                              ...existing.filter((x) => x.upstream_task_id !== depTargetId),
                              {
                                upstream_task_id: depTargetId,
                                threshold: depThreshold,
                                from_entity_link: false,
                              },
                            ],
                            activeProjectUuid,
                          );
                          setDepTargetId('');
                          await invalidateTask();
                          flashSaved();
                        } catch (err) {
                          toast.push(
                            'danger',
                            err instanceof Error ? err.message : 'Dependency rejected',
                          );
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                )}
              </Stack>
            )}

            {(full.downstream ?? []).length > 0 && (
              <Stack gap="1">
                <Text size="sm" variant="muted">
                  Downstream Dependents
                </Text>
                {(full.downstream ?? []).map((d) => (
                  <div key={d.task_id} className="org-tdet__row-box">
                    <button
                      type="button"
                      className="org-tdet__linkbtn"
                      onClick={() => onSelectTask?.(d.task_id)}
                    >
                      <span className="org-tdet__mono">{d.upstream_task_code}</span>
                      <StatusChip status={d.upstream_status ?? 'WTG'} compact />
                    </button>
                  </div>
                ))}
              </Stack>
            )}
          </Stack>
        </SectionBlock>

        <SectionBlock title="Versions & Sharing" badge={String(versions.length)}>
          <Stack gap="2">
            {canShareClient && (
              <Inline gap="2">
                <Button size="sm" onClick={() => setShareOpen(true)}>
                  Share with client…
                </Button>
                {(full.shared_company_ids?.length ?? 0) > 0 && (
                  <Badge tone="info">
                    Shared ({full.shared_company_ids?.length})
                  </Badge>
                )}
              </Inline>
            )}
            {versions.length === 0 ? (
              <Text size="sm" variant="muted">
                No product versions published yet.
              </Text>
            ) : (
              versions.map((ver) => (
                <div key={ver.id} className="org-tdet__row-box">
                  <Inline gap="1">
                    <strong>{ver.label}</strong>
                    {full.latest_version_id === ver.id && <Badge tone="neutral">latest</Badge>}
                    {full.approved_version_id === ver.id && <Badge tone="success">approved</Badge>}
                  </Inline>
                  <Button
                    size="sm"
                    onClick={() => handleOpenViewer(ver.files?.[0]?.id ?? null)}
                  >
                    Open in viewer
                  </Button>
                </div>
              ))
            )}
          </Stack>
        </SectionBlock>

        <SectionBlock title="Reviews & Comments" badge={String((full.comments ?? []).length)}>
          <Stack gap="2">
            {(full.reviews ?? []).map((rev) => (
              <div key={rev.id} className="org-tdet__row-box">
                <span>
                  <Badge
                    tone={
                      rev.decision === 'approved'
                        ? 'success'
                        : rev.decision === 'retake'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    R{rev.round_no} {rev.stage.toUpperCase()} {rev.decision}
                  </Badge>{' '}
                  <Text size="sm" variant="muted">
                    {rev.on_behalf_of
                      ? `approved by ${rev.reviewer_name ?? 'Producer'} on behalf of ${rev.on_behalf_of}`
                      : `${rev.reviewer_name ?? ''} (${rev.acted_as})`}
                  </Text>
                </span>
              </div>
            ))}

            {(full.comments ?? []).map((cmt) => (
              <div key={cmt.id} className="org-tdet__cmt">
                <div className="org-tdet__cmt-meta">
                  <Text size="sm" variant="accent">
                    {cmt.author_full_name ?? cmt.author_username ?? 'User'}
                  </Text>
                  <Badge tone={cmt.visibility === 'client' ? 'info' : 'neutral'}>
                    {cmt.visibility}
                  </Badge>
                  {cmt.kind === 'media' && <Badge tone="accent">media</Badge>}
                  {cmt.file_id && (
                    <Button
                      size="sm"
                      onClick={() => handleOpenViewer(cmt.file_id, cmt.frame ?? null)}
                    >
                      Open {cmt.frame !== null && cmt.frame !== undefined ? `F${cmt.frame}` : 'file'}
                    </Button>
                  )}
                </div>
                {cmt.file_id && (
                  <img
                    src={apiClient.fileThumbnailUrl(cmt.file_id, activeProjectUuid)}
                    alt="Media annotation thumbnail"
                    className="org-tdet__media-thumb"
                    onClick={() => handleOpenViewer(cmt.file_id, cmt.frame ?? null)}
                  />
                )}
                <CommentBody body={cmt.body} />
              </div>
            ))}

            {canComment && (
              <Stack gap="1">
                <TextArea
                  aria-label="New task comment"
                  rows={2}
                  placeholder="Write comment (use @username to reference)..."
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                />
                <div className="org-tdet__cmt-foot">
                  {canShareClient ? (
                    <Checkbox
                      label="Visible to client"
                      checked={commentClientVis}
                      onChange={setCommentClientVis}
                    />
                  ) : (
                    <span />
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!commentDraft.trim()}
                    onClick={() => void handlePostComment()}
                  >
                    Post Comment
                  </Button>
                </div>
              </Stack>
            )}
          </Stack>
        </SectionBlock>

        <SectionBlock title="History" badge={String((full.events ?? []).length)} defaultOpen={false}>
          <Stack gap="1">
            {(full.events ?? []).slice(0, 40).map((ev) => (
              <div key={ev.id} className="org-tdet__ev-row">
                <span className="org-tdet__mono">
                  {ev.at.slice(0, 19).replace('T', ' ')}
                </span>
                <span>
                  <strong>{ev.field}</strong>: {ev.old_value ?? '—'} → {ev.new_value ?? '—'}
                </span>
                <Text size="sm" variant="muted">
                  {ev.username ?? ev.source} ({ev.acted_as})
                </Text>
              </div>
            ))}
          </Stack>
        </SectionBlock>
      </ScrollArea>

      <TaskTransitionDialog
        open={Boolean(pendingTransition)}
        onOpenChange={(o) => {
          if (!o) setPendingTransition(null);
        }}
        taskCode={full.task_code}
        taskName={full.task_name}
        targetStatus={pendingTransition?.to ?? ''}
        actionLabel={pendingTransition?.action ?? ''}
        actedAsLabel={formatActedAsLabel(
          pendingTransition?.acted_as,
          pendingTransition?.on_behalf,
        )}
        requiresComment={Boolean(pendingTransition?.requires_comment)}
        requiresVersion={Boolean(pendingTransition?.requires_version)}
        versions={versions}
        defaultVersionId={full.latest_version_id}
        onSubmit={async (payload) => {
          if (pendingTransition) {
            await executeTransition(pendingTransition, payload);
          }
        }}
      />

      <ShareWithClientDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        taskId={full.id}
        taskCode={full.task_code}
        companies={companies}
        versions={versions}
        initialCompanyIds={full.shared_company_ids ?? []}
        onShared={() => void invalidateTask()}
      />
    </div>
  );
}

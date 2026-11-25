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
  ContextMenu,
  DatePicker,
  formatDisplayDate,
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
  ReviewCard,
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
import { DepartmentTag } from '../departments/DepartmentTag';
import { useProjectStore } from '../project/projectStore';
import { buildReviewFeed } from '../reviews/reviewFeed';
import { useReviewSeenStore } from '../reviews/reviewSeenStore';
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

const PEOPLE_ROLES = [
  { role: 'artist', label: 'Artists', placeholder: 'Assign artist...' },
  { role: 'lead', label: 'Leads', placeholder: 'Assign lead...' },
  { role: 'supervisor', label: 'Supervisors', placeholder: 'Assign supervisor...' },
] as const;

/** Admin overrides for these workflow steps are hidden from the panel (they are artist actions). */
function isHiddenAdminTransition(opt: TransitionOptionOut): boolean {
  if (opt.acted_as !== 'role:admin') return false;
  const action = opt.action.toLowerCase();
  return action.startsWith('start') || action.startsWith('hold');
}

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
  onOpenInViewer?: (opts: {
    taskId: string;
    fileId?: string | null;
    frame?: number | null;
  }) => void;
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
  const [panel, setPanel] = useState<'overview' | 'activity'>('overview');
  const markSeen = useReviewSeenStore((st) => st.markSeen);
  const [seenBaseline, setSeenBaseline] = useState<{ taskId: string; at: string } | null>(null);

  // Opening a task marks its latest review as seen (clears the red dot everywhere),
  // while remembering the previous baseline to highlight what is new in this view.
  const detailFeedbackAt =
    detail && 'last_feedback_at' in detail ? (detail.last_feedback_at ?? null) : null;
  useEffect(() => {
    if (!detail) return;
    if (seenBaseline?.taskId !== detail.id) {
      setSeenBaseline({
        taskId: detail.id,
        at: useReviewSeenStore.getState().seen[detail.id] ?? '',
      });
    }
    if (detailFeedbackAt) markSeen(detail.id, detailFeedbackAt);
  }, [detail, detailFeedbackAt, seenBaseline?.taskId, markSeen]);

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
        companyName: u.company_id ? (companyById.get(u.company_id)?.name ?? null) : null,
        departmentIds: u.department_ids ?? [],
        avatarUrl: u.avatar_file ? apiClient.userAvatarUrl(u.id, activeProjectUuid) : null,
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
    const clientFeed = buildReviewFeed({
      reviews: cDetail.reviews ?? [],
      comments: (cDetail.comments ?? []).map((c) => ({ ...c, author_username: null })),
      versionLabels: new Map(clientVersions.map((v) => [v.id, v.label])),
    });

    return (
      <div className="org-tdet" data-ui="task-detail" data-client-mode="true">
        <div className="org-tdet__hdr">
          <div className="org-tdet__hdr-top">
            <span className="org-tdet__code">{cDetail.task_code}</span>
            <StatusChip status={cDetail.status} />
            {onClose && (
              <Button size="sm" variant="icon" aria-label="Close task detail" onClick={onClose}>
                <Icon name="close" size="sm" />
              </Button>
            )}
          </div>
          <h2 className="org-tdet__title" title={cDetail.task_name}>
            {cDetail.task_name}
          </h2>
          <div className="org-tdet__context">
            <DepartmentTag name={cDetail.department_name} className="org-tdet__dept" />
            <span className="org-tdet__entity">{cDetail.entity_name}</span>
          </div>
          {cDetail.ideal_finish_date && (
            <div className="org-tdet__keyfacts">
              <span className="org-tdet__fact">
                <span className="org-tdet__fact-label">Due</span>
                <span className="org-tdet__fact-value">
                  {formatDisplayDate(cDetail.ideal_finish_date)}
                </span>
              </span>
            </div>
          )}
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
                    <Button size="sm" onClick={() => handleOpenViewer(ver.files?.[0]?.id ?? null)}>
                      Open in viewer
                    </Button>
                  </div>
                ))}
              </Stack>
            )}
          </SectionBlock>

          <SectionBlock title="Reviews" badge={String(clientFeed.length)}>
            <Stack gap="2">
              {clientFeed.length === 0 && (
                <Text size="sm" variant="muted">
                  No reviews yet.
                </Text>
              )}
              {clientFeed.map((item) => (
                <ReviewCard
                  key={item.key}
                  title={item.title}
                  tone={item.tone}
                  tag={item.tag}
                  author={item.author}
                  authorLabel={item.authorLabel}
                  at={item.at}
                  taskLabel={cDetail.task_code}
                  chips={item.chips}
                  imageUrl={
                    item.fileId ? apiClient.fileThumbnailUrl(item.fileId, activeProjectUuid) : null
                  }
                  onImageClick={
                    item.fileId ? () => handleOpenViewer(item.fileId, item.frame) : undefined
                  }
                  body={item.body ? <CommentBody body={item.body} /> : undefined}
                />
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
  const canShowAllDepts =
    auth?.user.role_name === 'admin' || auth?.permissions['task.assign'] === 'all';

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
  const visibleTransitions = (full.allowed_transitions ?? []).filter(
    (opt) => !isHiddenAdminTransition(opt),
  );
  const userById = new Map(users.map((u) => [u.id, u]));
  const feed = buildReviewFeed({
    reviews: full.reviews ?? [],
    comments: full.comments ?? [],
    versionLabels: new Map(versions.map((v) => [v.id, v.label])),
    avatarUrlFor: (uid) =>
      uid && userById.get(uid)?.avatar_file
        ? apiClient.userAvatarUrl(uid, activeProjectUuid)
        : null,
    currentUserId: auth?.user.id ?? null,
    unreadAfter: seenBaseline?.taskId === full.id ? seenBaseline.at : undefined,
  });

  return (
    <div
      className={`org-tdet${compact ? ' org-tdet--compact' : ''}`}
      data-ui="task-detail"
      data-task-id={full.id}
    >
      <div className="org-tdet__hdr">
        <div className="org-tdet__hdr-top">
          <span className="org-tdet__code">{full.task_code}</span>
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

        <h2 className="org-tdet__title" title={full.task_name}>
          {full.task_name}
        </h2>

        <div className="org-tdet__context">
          <DepartmentTag
            id={full.department_id}
            name={full.department_name}
            color={full.department_color}
            className="org-tdet__dept"
          />
          <button
            type="button"
            className="org-tdet__entity"
            title="Open entity in the Entities browser"
            onClick={() => navigate(`/entities?task=${full.id}`)}
          >
            {full.entity_name}
          </button>
          {full.parent_entity_type && <Badge tone="accent">{full.parent_entity_type}</Badge>}
        </div>

        <div className="org-tdet__keyfacts">
          <span className="org-tdet__fact">
            <span className="org-tdet__fact-label">Planned</span>
            <span
              className={`org-tdet__fact-value${overdue ? ' org-tdet__fact-value--danger' : ''}`}
            >
              {formatDisplayDate(full.ideal_start_date) || '—'} →{' '}
              {formatDisplayDate(full.ideal_finish_date) || '—'}
            </span>
          </span>
          <span className="org-tdet__fact">
            <span className="org-tdet__fact-label">Time</span>
            <span className="org-tdet__fact-value">
              {full.logged_hours ?? 0}h / {full.bid_hours ?? 0}h
            </span>
          </span>
          {myCaps.length > 0 && (
            <span className="org-tdet__fact">
              <span className="org-tdet__fact-label">You are</span>
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

        {visibleTransitions.length > 0 && (
          <div className="org-tdet__actions" aria-label="Workflow actions">
            {visibleTransitions.map((opt) => {
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

        <div className="org-tdet__switch" role="tablist" aria-label="Task detail panels">
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'overview'}
            data-active={panel === 'overview' ? 'true' : undefined}
            className="org-tdet__switch-btn"
            onClick={() => setPanel('overview')}
          >
            Summary · People · Schedule
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'activity'}
            data-active={panel === 'activity' ? 'true' : undefined}
            className="org-tdet__switch-btn"
            onClick={() => setPanel('activity')}
          >
            Dependencies · Versions · Reviews · History
            {feed.length > 0 && <Badge tone="neutral">{feed.length}</Badge>}
          </button>
        </div>
      </div>

      <ScrollArea className="org-tdet__scroll">
        {panel === 'overview' ? (
          <div className="org-tdet__overview">
            <section className="org-tdet__block">
              <h3 className="org-tdet__block-title">People</h3>
              <div className="org-tdet__people">
                {PEOPLE_ROLES.map(({ role, label, placeholder }) => {
                  const assigned = (full.assignments ?? []).filter(
                    (a) => a.assignment_role === role,
                  );
                  return (
                    <div key={role} className="org-tdet__people-row" data-role={role}>
                      <span className="org-tdet__role-label">{label}</span>
                      <div className="org-tdet__people-list">
                        {assigned.length === 0 ? (
                          <span className="org-tdet__unassigned">Unassigned</span>
                        ) : (
                          assigned.map((a) => (
                            <span key={a.user_id} className="org-tdet__person">
                              <Avatar
                                username={a.username}
                                fullName={a.full_name}
                                avatarUrl={
                                  a.avatar_file
                                    ? apiClient.userAvatarUrl(a.user_id, activeProjectUuid)
                                    : null
                                }
                                size="lg"
                              />
                              <span className="org-tdet__person-text">
                                <span className="org-tdet__person-name">{a.full_name}</span>
                                <span className="org-tdet__person-user">@{a.username}</span>
                              </span>
                            </span>
                          ))
                        )}
                        {canViewUsers && canAssign && (
                          <UserPicker
                            ariaLabel={`Assign ${label.toLowerCase()}`}
                            users={userOptions}
                            selectedIds={assignForRole(role)}
                            departmentId={full.department_id}
                            canShowAll={canShowAllDepts}
                            placeholder={placeholder}
                            onChange={(ids) => void updateAssignmentsRole(role, ids)}
                            trigger={
                              <Button size="sm" aria-label={`Edit ${label.toLowerCase()}`}>
                                <Icon name={assigned.length === 0 ? 'plus' : 'pencil'} size="sm" />
                                {assigned.length === 0 ? 'Assign' : 'Edit'}
                              </Button>
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="org-tdet__block">
              <h3 className="org-tdet__block-title">Schedule &amp; Time</h3>
              <Stack gap="2">
                <div className="org-tdet__grid2">
                  <label className="org-tdet__field">
                    <Text size="sm" variant="muted">
                      Planned Start
                    </Text>
                    {canEditSchedule ? (
                      <DatePicker
                        ariaLabel="Planned start date"
                        placeholder="Set planned start"
                        value={idealStartDraft}
                        max={idealFinishDraft || null}
                        onChange={(v) => {
                          setIdealStartDraft(v ?? '');
                          void patchWithConflict({ ideal_start_date: v });
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
                      Planned Finish
                    </Text>
                    {canEditSchedule ? (
                      <DatePicker
                        ariaLabel="Planned finish date"
                        placeholder="Set planned finish"
                        value={idealFinishDraft}
                        min={idealStartDraft || null}
                        error={overdue}
                        onChange={(v) => {
                          setIdealFinishDraft(v ?? '');
                          void patchWithConflict({ ideal_finish_date: v });
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
                    Actual Start:{' '}
                    <span className="org-tdet__mono">{full.actual_start_date ?? '—'}</span>
                  </Text>
                  <Text size="sm" variant="muted">
                    Actual Finish:{' '}
                    <span className="org-tdet__mono">{full.actual_finish_date ?? '—'}</span>
                  </Text>
                </div>

                <div className="org-tdet__grid2">
                  <Stack gap="1">
                    <Text size="sm" variant="muted">
                      Bid Hours{' '}
                      {full.bid_days !== null && full.bid_days !== undefined
                        ? `(${full.bid_days}d)`
                        : ''}
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
                    <DatePicker
                      ariaLabel="Work date"
                      clearable={false}
                      value={logDate}
                      onChange={(v) => {
                        if (v) setLogDate(v);
                      }}
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
                          toast.push(
                            'danger',
                            err instanceof Error ? err.message : 'Time log failed',
                          );
                        }
                      }}
                    >
                      Log Time
                    </Button>
                  </div>
                )}

                {(full.time_logs ?? []).slice(0, 6).map((lg) => (
                  <ContextMenu
                    key={lg.id}
                    items={
                      lg.user_id === auth?.user.id || canEditFields
                        ? [
                            {
                              id: 'delete-log',
                              label: 'Delete Time Log',
                              onSelect: async () => {
                                await apiClient.deleteTimeLog(taskId, lg.id, activeProjectUuid);
                                await invalidateTask();
                              },
                            },
                          ]
                        : []
                    }
                  >
                    <div className="org-tdet__row-box">
                      <span className="org-tdet__mono">
                        {lg.work_date} · {lg.hours}h · {lg.full_name ?? lg.username ?? 'User'}
                        {lg.note ? ` — ${lg.note}` : ''}
                      </span>
                    </div>
                  </ContextMenu>
                ))}
              </Stack>
            </section>

            <section className="org-tdet__block">
              <h3 className="org-tdet__block-title">Summary</h3>
              <Stack gap="2">
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
            </section>
          </div>
        ) : (
          <>
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
                                threshold: (x.threshold ?? 'APP') as
                                  'APP' | 'PUBLISHED' | 'ANY_STATUS',
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
                          onChange={(v) => setDepThreshold(v as 'APP' | 'PUBLISHED' | 'ANY_STATUS')}
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
                                threshold: (x.threshold ?? 'APP') as
                                  'APP' | 'PUBLISHED' | 'ANY_STATUS',
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
                      <Badge tone="info">Shared ({full.shared_company_ids?.length})</Badge>
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
                        {full.approved_version_id === ver.id && (
                          <Badge tone="success">approved</Badge>
                        )}
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

            <SectionBlock title="Reviews" badge={String(feed.length)}>
              <Stack gap="2">
                {feed.length === 0 ? (
                  <Text size="sm" variant="muted">
                    No reviews or comments yet.
                  </Text>
                ) : (
                  feed.map((item) => (
                    <ReviewCard
                      key={item.key}
                      title={item.title}
                      tone={item.tone}
                      tag={item.tag}
                      author={item.author}
                      authorLabel={item.authorLabel}
                      at={item.at}
                      taskLabel={full.task_code}
                      chips={item.chips}
                      unread={item.unread}
                      imageUrl={
                        item.fileId
                          ? apiClient.fileThumbnailUrl(item.fileId, activeProjectUuid)
                          : null
                      }
                      imageAlt="Painted review"
                      onImageClick={
                        item.fileId ? () => handleOpenViewer(item.fileId, item.frame) : undefined
                      }
                      body={item.body ? <CommentBody body={item.body} /> : undefined}
                      actions={
                        item.fileId ? (
                          <Button
                            size="sm"
                            onClick={() => handleOpenViewer(item.fileId, item.frame)}
                          >
                            Open in viewer
                            {item.frame !== null && item.frame !== undefined
                              ? ` · F${item.frame}`
                              : ''}
                          </Button>
                        ) : undefined
                      }
                    />
                  ))
                )}

                {canComment && (
                  <Stack gap="1">
                    <TextArea
                      aria-label="New task comment"
                      rows={3}
                      placeholder="Write a review comment (use @username to reference)..."
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

            <SectionBlock
              title="History"
              badge={String((full.events ?? []).length)}
              defaultOpen={false}
            >
              <Stack gap="1">
                {(full.events ?? []).slice(0, 40).map((ev) => (
                  <div key={ev.id} className="org-tdet__ev-row">
                    <span className="org-tdet__mono">{ev.at.slice(0, 19).replace('T', ' ')}</span>
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
          </>
        )}
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
        actedAsLabel={formatActedAsLabel(pendingTransition?.acted_as, pendingTransition?.on_behalf)}
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

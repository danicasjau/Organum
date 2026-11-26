import { useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { DensityMode, ThemeMode } from '../../app/App';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Panel,
  Select,
  SplitGroup,
  SplitHandle,
  SplitPane,
  Stack,
  Text,
  TextField,
} from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import { AuthenticatedShell } from '../auth/AuthenticatedShell';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { ReviewQueueView } from '../tasks/ReviewQueueView';
import { TaskDetail } from '../tasks/TaskDetail';
import { WorkHoursEditor, WorkHoursSummary } from '../people/WorkHoursEditor';
import { MyTasksInbox } from './MyTasksInbox';
import { loadMeLayout, saveMeLayout } from './meLayout';
import './MyUserPage.css';

/** Below this container width (token --me-stack-bp) the columns stack vertically. */
function useStacked(ref: RefObject<HTMLElement | null>): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bp = parseFloat(getComputedStyle(el).getPropertyValue('--me-stack-bp')) || 0;
    const update = (w: number) => setStacked(bp > 0 && w < bp);
    update(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) update(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return stacked;
}

function MeColumn({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="org-me-col" data-ui={`me-col-${id}`} aria-label={title}>
      <header className="org-me-col__head">{title}</header>
      <div className="org-me-col__body">{children}</div>
    </section>
  );
}

export function MyUserPage({
  theme,
  onToggleTheme,
  density,
  onChangeDensity,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
  density: DensityMode;
  onChangeDensity: (d: DensityMode) => void;
}) {
  const auth = useAuthStore((s) => s.auth);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);
  const stacked = useStacked(rootRef);
  const [initialLayout] = useState(loadMeLayout);

  const selectedTaskId = searchParams.get('task');
  const selectTask = (taskId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (taskId) next.set('task', taskId);
    else next.delete('task');
    setSearchParams(next, { replace: true });
  };

  if (!auth) return null;

  const isClient = auth.user.role_name === 'client';
  const canReview =
    isClient ||
    hasPerm(auth.permissions, 'task.approve.lead') ||
    hasPerm(auth.permissions, 'task.approve.sup') ||
    hasPerm(auth.permissions, 'task.approve.client');

  const openInViewer = ({ taskId, fileId }: { taskId: string; fileId?: string | null }) => {
    const qs = new URLSearchParams({ task: taskId });
    if (fileId) qs.set('file', fileId);
    navigate(`/viewer?${qs.toString()}`);
  };

  const profile = (
    <MeProfileColumn
      theme={theme}
      onToggleTheme={onToggleTheme}
      density={density}
      onChangeDensity={onChangeDensity}
    />
  );
  const tasks = (
    <MyTasksInbox
      selectedTaskId={selectedTaskId}
      onSelectTask={(id) => selectTask(id)}
      hideReviewQueue
    />
  );
  const preview = selectedTaskId ? (
    <TaskDetail
      key={selectedTaskId}
      taskId={selectedTaskId}
      compact
      onClose={() => selectTask(null)}
      onSelectTask={(id) => selectTask(id)}
      onOpenInViewer={openInViewer}
    />
  ) : canReview ? (
    <ReviewQueueView onSelectTask={(id) => selectTask(id)} onOpenInViewer={openInViewer} />
  ) : (
    <div className="org-me-empty">
      <Text size="sm" variant="muted">
        Select a task card to see its details here.
      </Text>
    </div>
  );
  const previewTitle = selectedTaskId ? 'Task Detail' : canReview ? 'Review Queue' : 'Preview';

  return (
    <AuthenticatedShell
      theme={theme}
      onToggleTheme={onToggleTheme}
      statusText={`My User — ${auth.user.full_name}`}
    >
      <div
        ref={rootRef}
        className="org-me-page"
        data-ui="my-user-page"
        data-layout={stacked ? 'stacked' : 'columns'}
      >
        {stacked ? (
          <div className="org-me-stack">
            <MeColumn id="profile" title="Profile">
              {profile}
            </MeColumn>
            <MeColumn id="tasks" title="My Tasks">
              {tasks}
            </MeColumn>
            <MeColumn id="preview" title={previewTitle}>
              {preview}
            </MeColumn>
          </div>
        ) : (
          <SplitGroup
            orientation="horizontal"
            defaultLayout={initialLayout}
            onLayoutChanged={(layout) => saveMeLayout(layout)}
          >
            <SplitPane id="me-profile" defaultSize="26%" minSize="240px">
              <MeColumn id="profile" title="Profile">
                {profile}
              </MeColumn>
            </SplitPane>
            <SplitHandle />
            <SplitPane id="me-tasks" defaultSize="42%" minSize="320px">
              <MeColumn id="tasks" title="My Tasks">
                {tasks}
              </MeColumn>
            </SplitPane>
            <SplitHandle />
            <SplitPane id="me-preview" defaultSize="32%" minSize="260px">
              <MeColumn id="preview" title={previewTitle}>
                {preview}
              </MeColumn>
            </SplitPane>
          </SplitGroup>
        )}
      </div>
    </AuthenticatedShell>
  );
}

function MeProfileColumn({
  theme,
  onToggleTheme,
  density,
  onChangeDensity,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
  density: DensityMode;
  onChangeDensity: (d: DensityMode) => void;
}) {
  const auth = useAuthStore((s) => s.auth);
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(auth?.user.full_name ?? '');
  const [email, setEmail] = useState(auth?.user.email ?? '');
  const [timezone, setTimezone] = useState(auth?.user.timezone ?? 'UTC');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currPw, setCurrPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);
  const [editHours, setEditHours] = useState(false);

  if (!auth) return null;

  const avatarUrl = auth.user.avatar_file
    ? `${apiClient.userAvatarUrl(auth.user.id, auth.project_uuid)}?v=${encodeURIComponent(auth.user.avatar_file)}`
    : null;

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileErr(null);
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      await apiClient.updateUser(
        auth.user.id,
        {
          full_name: fullName.trim() || auth.user.full_name,
          email: email.trim() || null,
          timezone: timezone.trim() || 'UTC',
        },
        auth.project_uuid,
      );
      const freshMe = await apiClient.getAuthMe();
      setAuth(freshMe);
      await queryClient.invalidateQueries({ queryKey: ['users', auth.project_uuid] });
      setProfileMsg('Profile saved.');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Unable to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileErr(null);
    setProfileMsg(null);
    try {
      await apiClient.uploadUserAvatar(auth.user.id, file, auth.project_uuid);
      const freshMe = await apiClient.getAuthMe();
      setAuth(freshMe);
      setProfileMsg('Avatar uploaded.');
    } catch (err) {
      setProfileErr(err instanceof Error ? err.message : 'Avatar upload failed');
    } finally {
      e.target.value = '';
    }
  };

  const handleChangePw = async (e: FormEvent) => {
    e.preventDefault();
    setPwErr(null);
    setPwMsg(null);
    if (newPw.length < 10) {
      setPwErr('Password must be at least 10 characters long.');
      return;
    }
    if (newPw !== confPw) {
      setPwErr('New password and confirmation do not match.');
      return;
    }
    setSavingPw(true);
    try {
      const updated = await apiClient.changePassword(
        { current_password: currPw, new_password: newPw },
        auth.project_uuid,
      );
      setAuth(updated);
      setCurrPw('');
      setNewPw('');
      setConfPw('');
      setPwMsg('Password updated and session rotated.');
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Unable to update password');
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <Stack gap="2">
      <Panel title="User Identity & Profile">
        <form onSubmit={handleSaveProfile} className="org-me-form">
          <Stack gap="2">
            {profileErr && <Banner severity="danger">{profileErr}</Banner>}
            {profileMsg && <Banner severity="success">{profileMsg}</Banner>}
            <div className="org-me-avatar-row">
              <Avatar
                username={auth.user.username}
                fullName={auth.user.full_name}
                avatarUrl={avatarUrl}
                size="md"
              />
              <div>
                <strong>{auth.user.username}</strong>
                <div className="org-me-badges">
                  <Badge tone="accent">{auth.user.role_label}</Badge>
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="org-me-hidden-input"
                onChange={(ev) => void handleAvatarUpload(ev)}
              />
              <Button size="sm" onClick={() => avatarInputRef.current?.click()}>
                Upload Avatar
              </Button>
            </div>

            <label className="org-me-field">
              <Text size="sm" variant="muted">
                Full Name
              </Text>
              <TextField value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </label>
            <label className="org-me-field">
              <Text size="sm" variant="muted">
                Email
              </Text>
              <TextField
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="artist@studio.local"
              />
            </label>
            <label className="org-me-field">
              <Text size="sm" variant="muted">
                Timezone
              </Text>
              <TextField
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="UTC"
              />
            </label>
            <div className="org-me-actions">
              <Button type="submit" size="sm" variant="primary" disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>

      <Panel title="Working Hours" collapsible>
        <div className="org-me-kv" data-ui="me-working-hours">
          <Text size="sm" variant="muted">
            Daily capacity
          </Text>
          <Text size="sm">{auth.user.daily_capacity_hours}h / day</Text>
        </div>
        <WorkHoursSummary userId={auth.user.id} projectUuid={auth.project_uuid} />
        <div className="org-me-actions">
          <Button size="sm" onClick={() => setEditHours((v) => !v)}>
            {editHours ? 'Close editor' : 'Edit my hours'}
          </Button>
        </div>
        {editHours && (
          <WorkHoursEditor userId={auth.user.id} projectUuid={auth.project_uuid} editable />
        )}
      </Panel>

      <Panel title="Preferences" collapsible>
        <Stack gap="2">
          <div className="org-me-pref-row">
            <Text size="sm" variant="muted">
              Theme
            </Text>
            <Button size="sm" onClick={onToggleTheme}>
              Current: {theme === 'dark' ? 'Dark' : 'Light'} (Switch)
            </Button>
          </div>
          <div className="org-me-pref-row">
            <Text size="sm" variant="muted">
              Density
            </Text>
            <Select
              ariaLabel="UI Density"
              value={density}
              onChange={(v) => onChangeDensity(v === 'comfortable' ? 'comfortable' : 'compact')}
              options={[
                { value: 'compact', label: 'Compact (2002 dense)' },
                { value: 'comfortable', label: 'Comfortable' },
              ]}
            />
          </div>
        </Stack>
      </Panel>

      <Panel title="Change Password" collapsible defaultOpen={false}>
        <form onSubmit={handleChangePw} className="org-me-form">
          <Stack gap="2">
            {pwErr && <Banner severity="danger">{pwErr}</Banner>}
            {pwMsg && <Banner severity="success">{pwMsg}</Banner>}
            <label className="org-me-field">
              <Text size="sm" variant="muted">
                Current Password
              </Text>
              <TextField
                type="password"
                value={currPw}
                onChange={(e) => setCurrPw(e.target.value)}
                required
              />
            </label>
            <label className="org-me-field">
              <Text size="sm" variant="muted">
                New Password (min 10 chars)
              </Text>
              <TextField
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
              />
            </label>
            <label className="org-me-field">
              <Text size="sm" variant="muted">
                Confirm New Password
              </Text>
              <TextField
                type="password"
                value={confPw}
                onChange={(e) => setConfPw(e.target.value)}
                required
              />
            </label>
            <div className="org-me-actions">
              <Button type="submit" size="sm" variant="primary" disabled={savingPw}>
                {savingPw ? 'Updating...' : 'Update Password'}
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>

      <Panel title="Projects Working On" collapsible>
        <Stack gap="1">
          {(auth.user.projects_working_on ?? []).length === 0 ? (
            <Text size="sm" variant="muted">
              No indexed projects found.
            </Text>
          ) : (
            (auth.user.projects_working_on ?? []).map((p) => (
              <div key={p.project_uuid} className="org-me-proj-row">
                <Text>{p.project_name}</Text>
                <Badge tone={p.project_uuid === auth.project_uuid ? 'accent' : 'neutral'}>
                  {p.project_uuid === auth.project_uuid ? 'active' : 'member'}
                </Badge>
              </div>
            ))
          )}
        </Stack>
      </Panel>
    </Stack>
  );
}

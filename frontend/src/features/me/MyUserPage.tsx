import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { DensityMode, ThemeMode } from '../../app/App';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Panel,
  Select,
  Stack,
  Tabs,
  Text,
  TextField,
} from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import { AuthenticatedShell } from '../auth/AuthenticatedShell';
import { useAuthStore } from '../auth/authStore';
import { MyTasksInbox } from './MyTasksInbox';
import './MyUserPage.css';

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
  const setAuth = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState('profile');
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
    <AuthenticatedShell
      theme={theme}
      onToggleTheme={onToggleTheme}
      statusText={`My User — ${auth.user.full_name}`}
    >
      <div className="org-me-page" data-ui="my-user-page">
        <Tabs
          activeId={tab}
          onChange={setTab}
          items={[
            {
              id: 'profile',
              label: 'Profile',
              content: (
                <div className="org-me-grid">
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
                              <Badge tone="neutral">
                                {auth.user.daily_capacity_hours}h / day
                              </Badge>
                            </div>
                          </div>
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="org-me-hidden-input"
                            onChange={(ev) => void handleAvatarUpload(ev)}
                          />
                          <Button
                            size="sm"
                            onClick={() => avatarInputRef.current?.click()}
                          >
                            Upload Avatar
                          </Button>
                        </div>

                        <label className="org-me-field">
                          <Text size="sm" variant="muted">Full Name</Text>
                          <TextField
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            required
                          />
                        </label>
                        <label className="org-me-field">
                          <Text size="sm" variant="muted">Email</Text>
                          <TextField
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="artist@studio.local"
                          />
                        </label>
                        <label className="org-me-field">
                          <Text size="sm" variant="muted">Timezone</Text>
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

                  <Stack gap="2">
                    <Panel title="Change Password">
                      <form onSubmit={handleChangePw} className="org-me-form">
                        <Stack gap="2">
                          {pwErr && <Banner severity="danger">{pwErr}</Banner>}
                          {pwMsg && <Banner severity="success">{pwMsg}</Banner>}
                          <label className="org-me-field">
                            <Text size="sm" variant="muted">Current Password</Text>
                            <TextField
                              type="password"
                              value={currPw}
                              onChange={(e) => setCurrPw(e.target.value)}
                              required
                            />
                          </label>
                          <label className="org-me-field">
                            <Text size="sm" variant="muted">New Password (min 10 chars)</Text>
                            <TextField
                              type="password"
                              value={newPw}
                              onChange={(e) => setNewPw(e.target.value)}
                              required
                            />
                          </label>
                          <label className="org-me-field">
                            <Text size="sm" variant="muted">Confirm New Password</Text>
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

                    <Panel title="Projects Working On">
                      <Stack gap="1">
                        {(auth.user.projects_working_on ?? []).length === 0 ? (
                          <Text size="sm" variant="muted">No indexed projects found.</Text>
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
                </div>
              ),
            },
            {
              id: 'tasks',
              label: 'My Tasks',
              content: <MyTasksInbox />,
            },
            {
              id: 'preferences',
              label: 'Preferences',
              content: (
                <div className="org-me-prefs">
                  <Panel title="UI Preferences">
                    <Stack gap="2">
                      <div className="org-me-pref-row">
                        <Text size="sm" variant="muted">Theme</Text>
                        <Button size="sm" onClick={onToggleTheme}>
                          Current: {theme === 'dark' ? 'Dark' : 'Light'} (Switch)
                        </Button>
                      </div>
                      <div className="org-me-pref-row">
                        <Text size="sm" variant="muted">Density</Text>
                        <Select
                          ariaLabel="UI Density"
                          value={density}
                          onChange={(v) =>
                            onChangeDensity(v === 'comfortable' ? 'comfortable' : 'compact')
                          }
                          options={[
                            { value: 'compact', label: 'Compact (2002 dense)' },
                            { value: 'comfortable', label: 'Comfortable' },
                          ]}
                        />
                      </div>
                    </Stack>
                  </Panel>
                </div>
              ),
            },
          ]}
        />
      </div>
    </AuthenticatedShell>
  );
}

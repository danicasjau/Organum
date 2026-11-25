import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  BrandWordmark,
  Button,
  Checkbox,
  Dialog,
  Icon,
  Panel,
  Select,
  Stack,
  Text,
  TextField,
  Topbar,
  type SelectOption,
} from '../../components/ui';
import { apiClient, type FsBrowseResponse } from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { useAuthStore } from './authStore';
import './AuthPages.css';

const DEFAULT_STARTER_DEPTS = 'Modeling, Rigging, Animation, FX, Lighting, Lookdev, Compositing';

export function LoginPage({
  theme,
  onToggleTheme,
}: {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const auth = useAuthStore((s) => s.auth);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const autoLogoutNotice = useAuthStore((s) => s.autoLogoutNotice);
  const setAuth = useAuthStore((s) => s.setAuth);
  const refreshBootstrap = useAuthStore((s) => s.refreshBootstrap);
  const clearNotice = useAuthStore((s) => s.clearNotice);

  const [selectedProjectUuid, setSelectedProjectUuid] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [projName, setProjName] = useState('');
  const [projPath, setProjPath] = useState('');
  const [addStarters, setAddStarters] = useState(true);
  const [starterList, setStarterList] = useState(DEFAULT_STARTER_DEPTS);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseData, setBrowseData] = useState<FsBrowseResponse | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    if (auth && !auth.user.must_change_password) {
      navigate('/entities', { replace: true });
    }
  }, [auth, navigate]);

  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const effectiveProjectUuid =
    selectedProjectUuid ||
    (bootstrap?.projects?.some((p) => p.uuid === activeProjectUuid)
      ? activeProjectUuid
      : null) ||
    bootstrap?.projects?.[0]?.uuid ||
    '';

  const projectOptions: SelectOption[] = (bootstrap?.projects ?? []).map((p) => ({
    value: p.uuid,
    label: p.name,
  }));

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!effectiveProjectUuid) {
      setError('Select a project first.');
      return;
    }
    setError(null);
    clearNotice();
    setSubmitting(true);
    try {
      const me = await apiClient.login(effectiveProjectUuid, username.trim(), password);
      setAuth(me);
      if (!me.user.must_change_password) {
        navigate('/entities', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const openBrowser = async (path = '') => {
    setBrowseError(null);
    try {
      const data = await apiClient.browseFs(path);
      setBrowseData(data);
      setBrowseOpen(true);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Unable to browse server filesystem');
    }
  };

  const handleCreateFirstProject = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const depts = addStarters
        ? starterList
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const created = await apiClient.createProject({
        name: projName.trim(),
        path: projPath.trim(),
        starter_departments: depts,
      });
      await refreshBootstrap();
      setSelectedProjectUuid(created.uuid);
      setUsername('admin');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const isBootstrapMode = Boolean(bootstrap?.bootstrap_allowed);

  return (
    <div className="org-login-shell" data-ui="login-page">
      <Topbar
        left={<BrandWordmark label="ORGANUM" />}
        right={
          <Button
            size="sm"
            variant="icon"
            aria-label="Toggle theme"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={onToggleTheme}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />
          </Button>
        }
      />

      <main className="org-login-main">
        <div className="org-login-card">
          <Panel title={isBootstrapMode ? 'Bootstrap First Project' : 'Sign In — ORGANUM'}>
            <Stack gap="2">
              {autoLogoutNotice && <Banner severity="warning">{autoLogoutNotice}</Banner>}
              {error && <Banner severity="danger">{error}</Banner>}
              {browseError && <Banner severity="danger">{browseError}</Banner>}

              {isBootstrapMode ? (
                <form onSubmit={handleCreateFirstProject} className="org-auth-form">
                  <Stack gap="2">
                    <Banner severity="info">
                      No projects exist yet. Create the first project to seed the initial
                      administrator account (<code>admin</code>).
                    </Banner>
                    <label className="org-auth-field">
                      <Text size="sm" variant="muted">Project Name</Text>
                      <TextField
                        value={projName}
                        onChange={(e) => setProjName(e.target.value)}
                        placeholder="My Show"
                        required
                      />
                    </label>
                    <label className="org-auth-field">
                      <Text size="sm" variant="muted">Project Directory</Text>
                      <div className="org-auth-row">
                        <TextField
                          value={projPath}
                          onChange={(e) => setProjPath(e.target.value)}
                          placeholder="M:\Projects\MyShow"
                          required
                        />
                        <Button size="sm" onClick={() => void openBrowser(projPath)}>
                          Browse…
                        </Button>
                      </div>
                    </label>
                    <Checkbox
                      label="Add starter departments"
                      checked={addStarters}
                      onChange={setAddStarters}
                    />
                    {addStarters && (
                      <label className="org-auth-field">
                        <Text size="sm" variant="muted">Starter Departments (comma-separated)</Text>
                        <TextField
                          value={starterList}
                          onChange={(e) => setStarterList(e.target.value)}
                        />
                      </label>
                    )}
                    <div className="org-auth-actions">
                      <Button type="submit" size="sm" variant="primary" disabled={submitting}>
                        {submitting ? 'Creating...' : 'Create Project'}
                      </Button>
                    </div>
                  </Stack>
                </form>
              ) : (
                <form onSubmit={handleLogin} className="org-auth-form">
                  <Stack gap="2">
                    <label className="org-auth-field">
                      <Text size="sm" variant="muted">Project</Text>
                      <Select
                        ariaLabel="Project"
                        options={projectOptions}
                        value={effectiveProjectUuid}
                        onChange={setSelectedProjectUuid}
                        placeholder="Select project..."
                      />
                    </label>
                    <label className="org-auth-field">
                      <Text size="sm" variant="muted">Username</Text>
                      <TextField
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="username"
                        autoComplete="username"
                        required
                      />
                    </label>
                    <label className="org-auth-field">
                      <Text size="sm" variant="muted">Password</Text>
                      <TextField
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••"
                        autoComplete="current-password"
                        required
                      />
                    </label>
                    <div className="org-auth-actions">
                      <Button type="submit" size="sm" variant="primary" disabled={submitting}>
                        {submitting ? 'Signing in...' : 'Sign In'}
                      </Button>
                    </div>
                  </Stack>
                </form>
              )}
            </Stack>
          </Panel>
        </div>
      </main>

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen} title="Choose Project Directory">
        <Panel title={browseData?.current_path ?? 'Filesystem'}>
          <Stack gap="2">
            <div className="org-auth-row">
              {browseData?.parent_path && (
                <Button size="sm" onClick={() => void openBrowser(browseData.parent_path ?? '')}>
                  Up
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  if (browseData) setProjPath(browseData.current_path);
                  setBrowseOpen(false);
                }}
              >
                Use Current Folder
              </Button>
            </div>
            <div className="org-fs-list">
              {(browseData?.directories ?? []).map((d) => (
                <button
                  key={d.path}
                  type="button"
                  className="org-fs-item"
                  onClick={() => void openBrowser(d.path)}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </Stack>
        </Panel>
      </Dialog>
    </div>
  );
}

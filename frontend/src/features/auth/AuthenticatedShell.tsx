import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import { getVisiblePanels } from '../../app/panels';
import { AppShell, StatusBar, StatusBarSegment } from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { SettingsDialog } from '../settings/SettingsDialog';

export function AuthenticatedShell({
  theme,
  onToggleTheme,
  statusText = 'Ready',
  children,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
  statusText?: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const openSettings = useProjectStore((s) => s.openSettings);

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.listProjects(),
    enabled: Boolean(auth),
  });

  const activeProject = useMemo(
    () => (projectsQuery.data ?? []).find((p) => p.uuid === activeProjectUuid) ?? null,
    [projectsQuery.data, activeProjectUuid],
  );

  const panels = useMemo(
    () =>
      getVisiblePanels(auth?.permissions).map((p) => ({
        id: p.id,
        label: p.label,
        active: location.pathname.startsWith(p.route),
        onClick: () => navigate(p.route),
      })),
    [auth?.permissions, location.pathname, navigate],
  );

  const canAdmin = hasPerm(auth?.permissions, 'role.manage');

  return (
    <>
      <AppShell
        menus={[
          {
            id: 'workspace',
            label: 'Workspace',
            items: [
              { id: 'ws-ent', label: 'Entities & Viewer', onSelect: () => navigate('/entities') },
              ...(hasPerm(auth?.permissions, 'user.view')
                ? [{ id: 'ws-users', label: 'Users Directory', onSelect: () => navigate('/users') }]
                : []),
              { id: 'ws-me', label: 'My User', onSelect: () => navigate('/me') },
              ...(canAdmin
                ? [{ id: 'ws-admin', label: 'Admin Console', onSelect: () => navigate('/admin') }]
                : []),
            ],
          },
        ]}
        panels={panels}
        projectName={activeProject?.name ?? null}
        onOpenSettings={auth?.user.role_name === 'client' ? undefined : () => openSettings('project')}
        theme={theme}
        onToggleTheme={onToggleTheme}
        userName={auth?.user.username ?? 'user'}
        userFullName={auth?.user.full_name}
        userRoleLabel={auth?.user.role_label}
        userAvatarUrl={
          auth?.user.avatar_file
            ? apiClient.userAvatarUrl(auth.user.id, auth.project_uuid)
            : null
        }
        canAdmin={canAdmin}
        onOpenMyUser={() => navigate('/me')}
        onOpenAdmin={canAdmin ? () => navigate('/admin') : undefined}
        onLogout={() => {
          void logout().then(() => navigate('/login', { replace: true }));
        }}
        statusBar={
          <StatusBar>
            <StatusBarSegment>{statusText}</StatusBarSegment>
            <StatusBarSegment>
              {auth ? `${auth.user.username} (${auth.user.role_label})` : 'Signed out'}
            </StatusBarSegment>
            <StatusBarSegment>
              Project: {auth?.project_status ?? 'active'}
            </StatusBarSegment>
          </StatusBar>
        }
      >
        {children}
      </AppShell>
      <SettingsDialog theme={theme} onToggleTheme={onToggleTheme} />
    </>
  );
}


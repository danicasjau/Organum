import { useNavigate } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import { useStandardMenus } from '../../app/useStandardMenus';
import { useWorkspacePanels } from '../../app/useWorkspacePanels';
import { AppShell, StatusBar, StatusBarSegment } from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';

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
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);
  const panels = useWorkspacePanels();
  const menus = useStandardMenus(theme, onToggleTheme);

  const canAdmin =
    hasPerm(auth?.permissions, 'role.manage') || hasPerm(auth?.permissions, 'rules.manage');

  return (
    <>
      <AppShell
        menus={menus}
        panels={panels}
        onOpenSettings={auth?.user.role_name === 'client' ? undefined : () => navigate('/settings')}
        theme={theme}
        onToggleTheme={onToggleTheme}
        userName={auth?.user.username ?? 'user'}
        userFullName={auth?.user.full_name}
        userRoleLabel={auth?.user.role_label}
        userAvatarUrl={
          auth?.user.avatar_file ? apiClient.userAvatarUrl(auth.user.id, auth.project_uuid) : null
        }
        canAdmin={canAdmin}
        onOpenMyUser={() => navigate('/me')}
        onOpenAdmin={
          canAdmin
            ? () =>
                navigate(
                  hasPerm(auth?.permissions, 'role.manage')
                    ? '/users?section=roles'
                    : '/users?section=rules',
                )
            : undefined
        }
        onLogout={() => {
          void logout().then(() => navigate('/login', { replace: true }));
        }}
        statusBar={
          <StatusBar>
            <StatusBarSegment>{statusText}</StatusBarSegment>
            <StatusBarSegment>
              {auth ? `${auth.user.username} (${auth.user.role_label})` : 'Signed out'}
            </StatusBarSegment>
            <StatusBarSegment>Project: {auth?.project_status ?? 'active'}</StatusBarSegment>
          </StatusBar>
        }
      >
        {children}
      </AppShell>
    </>
  );
}

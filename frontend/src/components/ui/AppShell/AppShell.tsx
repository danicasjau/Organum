import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { Avatar } from '../Avatar/Avatar';
import { Badge, StatusDot } from '../Badge/Badge';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { MenuBar, type MenuBarMenu } from '../MenuBar/MenuBar';
import { BrandWordmark, Topbar } from '../Toolbar/Toolbar';
import './AppShell.css';

export interface PanelTabItem {
  id: string;
  label: string;
  href?: string;
  active?: boolean;
  /** Optional indicator rendered on the tab corner (e.g. unread review dot). */
  indicator?: ReactNode;
  onClick?: () => void;
}

export interface AppShellProps {
  menus: ReadonlyArray<MenuBarMenu>;
  panels?: ReadonlyArray<PanelTabItem>;
  projectName?: string | null;
  onOpenSettings?: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  userName?: string;
  userFullName?: string;
  userRoleLabel?: string;
  userAvatarUrl?: string | null;
  canAdmin?: boolean;
  onOpenMyUser?: () => void;
  onOpenAdmin?: () => void;
  onLogout?: () => void;
  jobsActive?: number;
  /** v1 zone accent for the top bar underline and accent controls. Derived from the active panel when omitted. */
  zone?: 'production' | 'management' | 'settings';
  statusBar: ReactNode;
  children: ReactNode;
}

const MANAGEMENT_PANELS = new Set(['users', 'admin', 'people', 'schedule']);

function deriveZone(activePanelId: string | undefined): 'production' | 'management' | 'settings' {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/settings')) {
    return 'settings';
  }
  if (activePanelId && MANAGEMENT_PANELS.has(activePanelId)) return 'management';
  return 'production';
}

export function AppShell({
  menus,
  panels = [],
  projectName,
  onOpenSettings,
  theme,
  onToggleTheme,
  userName = 'artist',
  userFullName,
  userRoleLabel,
  userAvatarUrl,
  canAdmin = false,
  onOpenMyUser,
  onOpenAdmin,
  onLogout,
  jobsActive = 0,
  zone,
  statusBar,
  children,
}: AppShellProps) {
  const activeZone = zone ?? deriveZone(panels.find((p) => p.active)?.id);
  const hasInteractiveUserMenu = Boolean(onOpenMyUser || onOpenAdmin || onLogout);
  const displayName = userFullName || userName;

  return (
    <div data-ui="app-shell" data-zone={activeZone} className="org-shell">
      <Topbar
        left={
          <>
            <BrandWordmark label="ORGANUM" />
            {panels.length > 0 && (
              <nav className="org-panelswitch" aria-label="Workspace panels">
                {panels.map((p) => (
                  <a
                    key={p.id}
                    href={p.href ?? '#'}
                    data-active={p.active ? 'true' : undefined}
                    aria-current={p.active ? 'page' : undefined}
                    className="org-panelswitch__tab"
                    onClick={(e) => {
                      // Let the browser handle modified clicks (new tab / window).
                      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
                        return;
                      }
                      e.preventDefault();
                      p.onClick?.();
                    }}
                  >
                    {p.label}
                    {p.indicator && <span className="org-panelswitch__dot">{p.indicator}</span>}
                  </a>
                ))}
              </nav>
            )}
            <MenuBar menus={menus} />
          </>
        }
        right={
          <>
            {projectName && (
              <Button
                size="sm"
                title="Active project (click to manage projects)"
                onClick={onOpenSettings}
              >
                {projectName}
              </Button>
            )}
            <Button
              size="sm"
              variant="icon"
              aria-label="Toggle theme"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              onClick={onToggleTheme}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="lg" />
            </Button>
            {onOpenSettings && (
              <Button
                size="sm"
                variant="icon"
                aria-label="Settings"
                title="Preferences & Project Settings"
                onClick={onOpenSettings}
              >
                <Icon name="settings" size="lg" />
              </Button>
            )}
            {hasInteractiveUserMenu ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="org-usermenu__trigger"
                    aria-label="User menu"
                    title={`${displayName}${userRoleLabel ? ` (${userRoleLabel})` : ''}`}
                  >
                    <Avatar
                      username={userName}
                      fullName={displayName}
                      avatarUrl={userAvatarUrl}
                      size={24}
                    />
                    <span className="org-usermenu__name">{displayName}</span>
                    {userRoleLabel && <Badge tone="neutral">{userRoleLabel}</Badge>}
                    <Icon name="chevron-down" size="sm" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="org-menu__content org-usermenu__content"
                  >
                    <div className="org-usermenu__header">
                      <Avatar
                        username={userName}
                        fullName={displayName}
                        avatarUrl={userAvatarUrl}
                        size={40}
                      />
                      <div className="org-usermenu__who">
                        <span className="org-usermenu__who-name">{displayName}</span>
                        {userRoleLabel && (
                          <span className="org-usermenu__who-role">{userRoleLabel}</span>
                        )}
                      </div>
                      <StatusDot tone="success" label="Online" />
                    </div>
                    <DropdownMenu.Separator className="org-menu__sep" />
                    {onOpenMyUser && (
                      <DropdownMenu.Item className="org-menu__item" onSelect={onOpenMyUser}>
                        <span className="org-menu__label">
                          <Icon name="user" size="md" />
                          <span>My User</span>
                        </span>
                      </DropdownMenu.Item>
                    )}
                    {onOpenSettings && (
                      <DropdownMenu.Item className="org-menu__item" onSelect={onOpenSettings}>
                        <span className="org-menu__label">
                          <Icon name="sliders" size="md" />
                          <span>Settings</span>
                        </span>
                      </DropdownMenu.Item>
                    )}
                    {canAdmin && onOpenAdmin && (
                      <DropdownMenu.Item className="org-menu__item" onSelect={onOpenAdmin}>
                        <span className="org-menu__label">
                          <Icon name="users" size="md" />
                          <span>Users &amp; Admin</span>
                        </span>
                      </DropdownMenu.Item>
                    )}
                    {onLogout && (
                      <>
                        <DropdownMenu.Separator className="org-menu__sep" />
                        <DropdownMenu.Item className="org-menu__item" onSelect={onLogout}>
                          <span className="org-menu__label">
                            <Icon name="log-out" size="md" />
                            <span>Sign Out</span>
                          </span>
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : (
              <Badge tone="neutral">{userName}</Badge>
            )}
            <StatusDot
              tone={jobsActive > 0 ? 'accent' : 'success'}
              label={jobsActive > 0 ? `${jobsActive} background jobs running` : 'Idle'}
            />
          </>
        }
      />
      <main className="org-shell__workspace">{children}</main>
      {statusBar}
    </div>
  );
}

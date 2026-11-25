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
  statusBar: ReactNode;
  children: ReactNode;
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
  statusBar,
  children,
}: AppShellProps) {
  const hasInteractiveUserMenu = Boolean(onOpenMyUser || onOpenAdmin || onLogout);
  const displayName = userFullName || userName;

  return (
    <div data-ui="app-shell" className="org-shell">
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
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />
            </Button>
            {onOpenSettings && (
              <Button
                size="sm"
                variant="icon"
                aria-label="Settings"
                title="Preferences & Project Settings"
                onClick={onOpenSettings}
              >
                <Icon name="settings" size="sm" />
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
                      size="sm"
                    />
                    <span className="org-usermenu__name">{displayName}</span>
                    {userRoleLabel && <Badge tone="neutral">{userRoleLabel}</Badge>}
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={2} className="org-menu__content">
                    {onOpenMyUser && (
                      <DropdownMenu.Item className="org-menu__item" onSelect={onOpenMyUser}>
                        <span>My User</span>
                      </DropdownMenu.Item>
                    )}
                    {onOpenSettings && (
                      <DropdownMenu.Item className="org-menu__item" onSelect={onOpenSettings}>
                        <span>Settings</span>
                      </DropdownMenu.Item>
                    )}
                    {canAdmin && onOpenAdmin && (
                      <DropdownMenu.Item className="org-menu__item" onSelect={onOpenAdmin}>
                        <span>Users &amp; Admin</span>
                      </DropdownMenu.Item>
                    )}
                    {onLogout && (
                      <>
                        <DropdownMenu.Separator className="org-menu__sep" />
                        <DropdownMenu.Item className="org-menu__item" onSelect={onLogout}>
                          <span>Sign Out</span>
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

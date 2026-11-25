import type { ReactNode } from 'react';
import { Badge, StatusDot } from '../Badge/Badge';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { MenuBar, type MenuBarMenu } from '../MenuBar/MenuBar';
import { BrandWordmark, Topbar } from '../Toolbar/Toolbar';
import './AppShell.css';

export interface PanelTabItem {
  id: string;
  label: string;
  active?: boolean;
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
  jobsActive = 0,
  statusBar,
  children,
}: AppShellProps) {
  return (
    <div data-ui="app-shell" className="org-shell">
      <Topbar
        left={
          <>
            <BrandWordmark label="ORGANUM" />
            {panels.length > 0 && (
              <nav className="org-panelswitch" aria-label="Workspace panels">
                {panels.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-active={p.active ? 'true' : undefined}
                    aria-pressed={Boolean(p.active)}
                    className="org-panelswitch__tab"
                    onClick={p.onClick}
                  >
                    {p.label}
                  </button>
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
            <Badge tone="neutral">{userName}</Badge>
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

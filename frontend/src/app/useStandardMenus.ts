import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MenuEntry, MenuBarMenu } from '../components/ui';
import { hasPerm, useAuthStore } from '../features/auth/authStore';

export interface StandardMenuExtras {
  /** Page-specific commands appended to the Workspace menu (e.g. Reconcile). */
  workspace?: ReadonlyArray<MenuEntry>;
  /** Page-specific View items, shown above the common theme toggle. */
  view?: ReadonlyArray<MenuEntry>;
  /** Opens the page's keyboard-shortcut sheet, when it has one. */
  onShowShortcuts?: () => void;
}

/** The same Workspace / View / Help menus on every page; pages only add items. */
export function useStandardMenus(
  theme: 'dark' | 'light',
  onToggleTheme: () => void,
  extras: StandardMenuExtras = {},
): MenuBarMenu[] {
  const navigate = useNavigate();
  const auth = useAuthStore((s) => s.auth);
  const perms = auth?.permissions;
  const isClient = auth?.user.role_name === 'client';
  const { workspace, view, onShowShortcuts } = extras;

  return useMemo(() => {
    const ws: MenuEntry[] = [
      { id: 'ws-ent', label: 'Entities & Viewer', onSelect: () => navigate('/entities') },
    ];
    if (hasPerm(perms, 'task.view')) {
      ws.push({ id: 'ws-tasks', label: 'Tasks', onSelect: () => navigate('/tasks') });
    }
    if (
      hasPerm(perms, 'user.view') ||
      hasPerm(perms, 'role.manage') ||
      hasPerm(perms, 'rules.manage')
    ) {
      ws.push({ id: 'ws-users', label: 'Users & Admin', onSelect: () => navigate('/users') });
    }
    ws.push({ id: 'ws-me', label: 'My User', onSelect: () => navigate('/me') });
    if (!isClient) {
      ws.push({ id: 'ws-sep-settings', label: '', separator: true });
      ws.push({ id: 'ws-settings', label: 'Settings', onSelect: () => navigate('/settings') });
    }
    if (workspace && workspace.length > 0) {
      ws.push({ id: 'ws-sep-extra', label: '', separator: true }, ...workspace);
    }

    const viewItems: MenuEntry[] = [...(view ?? [])];
    if (viewItems.length > 0) viewItems.push({ id: 'view-sep', label: '', separator: true });
    viewItems.push({
      id: 'view-theme',
      label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`,
      onSelect: onToggleTheme,
    });

    const helpItems: MenuEntry[] = [];
    if (onShowShortcuts) {
      helpItems.push({
        id: 'help-keys',
        label: 'Keyboard Shortcuts',
        shortcut: '?',
        onSelect: onShowShortcuts,
      });
    }
    helpItems.push({
      id: 'help-gallery',
      label: 'Widget Gallery',
      onSelect: () => navigate('/gallery'),
    });

    return [
      { id: 'workspace', label: 'Workspace', items: ws },
      { id: 'view', label: 'View', items: viewItems },
      { id: 'help', label: 'Help', items: helpItems },
    ];
  }, [navigate, perms, isClient, workspace, view, onShowShortcuts, theme, onToggleTheme]);
}

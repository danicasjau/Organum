export interface RegisteredPanel {
  id: string;
  label: string;
  route: string;
  /** Path prefixes that mark this panel as active. */
  matches: ReadonlyArray<string>;
  visibleFor?: (permissions: Record<string, string>) => boolean;
}

const registry: RegisteredPanel[] = [];

export function registerPanel(panel: RegisteredPanel): void {
  if (!registry.some((p) => p.id === panel.id)) {
    registry.push(panel);
  }
}

export function getRegisteredPanels(): ReadonlyArray<RegisteredPanel> {
  return registry;
}

export function getVisiblePanels(
  permissions: Record<string, string> | undefined,
): ReadonlyArray<RegisteredPanel> {
  if (!permissions) return [];
  return registry.filter((p) => (p.visibleFor ? p.visibleFor(permissions) : true));
}

const granted = (perms: Record<string, string>, key: string) => (perms[key] ?? 'none') !== 'none';

registerPanel({
  id: 'entities',
  label: 'ENTITIES',
  route: '/entities',
  matches: ['/entities', '/viewer'],
});
registerPanel({
  id: 'tasks',
  label: 'TASKS',
  route: '/tasks',
  matches: ['/tasks'],
  visibleFor: (perms) => granted(perms, 'task.view'),
});
registerPanel({
  id: 'users',
  label: 'USERS',
  route: '/users',
  matches: ['/users', '/admin'],
  visibleFor: (perms) => granted(perms, 'user.view') || granted(perms, 'role.manage'),
});

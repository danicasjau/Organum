export interface RegisteredPanel {
  id: string;
  label: string;
  route: string;
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

registerPanel({ id: 'entities', label: 'ENTITIES', route: '/entities' });
registerPanel({
  id: 'users',
  label: 'USERS',
  route: '/users',
  visibleFor: (perms) => (perms['user.view'] ?? 'none') !== 'none',
});

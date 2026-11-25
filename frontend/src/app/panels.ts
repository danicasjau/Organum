export interface RegisteredPanel {
  id: string;
  label: string;
  route: string;
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

registerPanel({ id: 'entities', label: 'ENTITIES', route: '/entities' });


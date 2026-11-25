import { beforeEach, describe, expect, it } from 'vitest';
import { useEntitiesStore } from './entitiesStore';

describe('entitiesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useEntitiesStore.getState().resetForProjectSwitch('proj-a');
  });

  it('persists layout presets, selection, and clears on project switch', () => {
    const store = useEntitiesStore.getState();
    store.setSelectedEntity('ent-1');
    store.setSelectedTask('task-1');
    store.setLayoutPreset('review');
    store.toggleMaximized();

    expect(useEntitiesStore.getState().selectedEntityId).toBe('ent-1');
    expect(useEntitiesStore.getState().selectedTaskId).toBe('task-1');
    expect(useEntitiesStore.getState().layoutPreset).toBe('review');
    expect(useEntitiesStore.getState().entitiesMaximized).toBe(true);

    // Switch to proj-b resets maximized and loads separate preferences
    useEntitiesStore.getState().resetForProjectSwitch('proj-b');
    expect(useEntitiesStore.getState().selectedEntityId).toBeNull();
    expect(useEntitiesStore.getState().layoutPreset).toBe('browse');
    expect(useEntitiesStore.getState().entitiesMaximized).toBe(false);

    // Switching back restores proj-a persisted selection and preset
    useEntitiesStore.getState().resetForProjectSwitch('proj-a');
    expect(useEntitiesStore.getState().selectedEntityId).toBe('ent-1');
    expect(useEntitiesStore.getState().selectedTaskId).toBe('task-1');
    expect(useEntitiesStore.getState().layoutPreset).toBe('review');
  });
});


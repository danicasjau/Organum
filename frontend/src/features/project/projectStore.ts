import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { useEntitiesStore } from '../entities/entitiesStore';
import { useViewerStore } from '../viewer/viewerStore';

export type SettingsPageId =
  | 'project'
  | 'departments'
  | 'applications'
  | 'detection'
  | 'appearance';

const STORAGE_KEY = 'organum.activeProjectUuid';

function readInitialProjectUuid(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

interface ProjectStoreState {
  activeProjectUuid: string | null;
  settingsOpen: boolean;
  settingsPage: SettingsPageId;
  setActiveProject: (uuid: string | null, queryClient?: QueryClient) => void;
  openSettings: (page?: SettingsPageId) => void;
  closeSettings: () => void;
  setSettingsPage: (page: SettingsPageId) => void;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  activeProjectUuid: readInitialProjectUuid(),
  settingsOpen: false,
  settingsPage: 'project',

  setActiveProject: (uuid, queryClient) => {
    const prev = get().activeProjectUuid;
    try {
      if (uuid) localStorage.setItem(STORAGE_KEY, uuid);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    if (prev !== uuid) {
      void queryClient?.cancelQueries();
      useViewerStore.getState().resetForProjectSwitch();
      useEntitiesStore.getState().resetForProjectSwitch(uuid);
    }
    set({ activeProjectUuid: uuid });
    if (prev && prev !== uuid && queryClient) {
      queueMicrotask(() => {
        queryClient.removeQueries({
          predicate: (q) => q.queryKey[0] !== 'projects' && q.queryKey[1] !== uuid,
        });
      });
    }
  },

  openSettings: (page) =>
    set((s) => ({ settingsOpen: true, settingsPage: page ?? s.settingsPage })),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsPage: (settingsPage) => set({ settingsPage }),
}));


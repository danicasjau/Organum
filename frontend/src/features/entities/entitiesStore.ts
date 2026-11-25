import { create } from 'zustand';

export type LayoutPreset = 'browse' | 'review';
export type ScenefilesViewMode = 'grid' | 'list';
export type EntitySortMode = 'name_asc' | 'name_desc' | 'updated_desc' | 'type_asc';

export interface PersistedEntitiesPrefs {
  selectedEntityId: string | null;
  selectedDeptId: string | null;
  selectedTaskId: string | null;
  currentFolder: string;
  layoutPreset: LayoutPreset;
  scenefilesViewMode: ScenefilesViewMode;
  sortMode: EntitySortMode;
  colLayout: Record<string, number> | null;
  outerLayout: Record<string, number> | null;
  col3VertLayout: Record<string, number> | null;
}

const DEFAULT_PREFS: PersistedEntitiesPrefs = {
  selectedEntityId: null,
  selectedDeptId: null,
  selectedTaskId: null,
  currentFolder: '',
  layoutPreset: 'browse',
  scenefilesViewMode: 'grid',
  sortMode: 'name_asc',
  colLayout: null,
  outerLayout: null,
  col3VertLayout: null,
};

function storageKey(projectUuid: string | null): string | null {
  return projectUuid ? `organum.entities.${projectUuid}` : null;
}

function loadPrefs(projectUuid: string | null): PersistedEntitiesPrefs {
  const key = storageKey(projectUuid);
  if (!key) return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<PersistedEntitiesPrefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(projectUuid: string | null, prefs: PersistedEntitiesPrefs): void {
  const key = storageKey(projectUuid);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore storage quota failures
  }
}

interface EntitiesStoreState extends PersistedEntitiesPrefs {
  projectUuid: string | null;
  entitiesMaximized: boolean;
  setSelectedEntity: (entityId: string | null) => void;
  setSelectedDept: (deptId: string | null) => void;
  setSelectedTask: (taskId: string | null) => void;
  setCurrentFolder: (folder: string) => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  toggleMaximized: () => void;
  setMaximized: (v: boolean) => void;
  setScenefilesViewMode: (mode: ScenefilesViewMode) => void;
  setSortMode: (sort: EntitySortMode) => void;
  setColLayout: (layout: Record<string, number>) => void;
  setOuterLayout: (layout: Record<string, number>) => void;
  setCol3VertLayout: (layout: Record<string, number>) => void;
  resetForProjectSwitch: (nextProjectUuid: string | null) => void;
}

function extractPrefs(s: EntitiesStoreState): PersistedEntitiesPrefs {
  return {
    selectedEntityId: s.selectedEntityId,
    selectedDeptId: s.selectedDeptId,
    selectedTaskId: s.selectedTaskId,
    currentFolder: s.currentFolder,
    layoutPreset: s.layoutPreset,
    scenefilesViewMode: s.scenefilesViewMode,
    sortMode: s.sortMode,
    colLayout: s.colLayout,
    outerLayout: s.outerLayout,
    col3VertLayout: s.col3VertLayout,
  };
}

export const useEntitiesStore = create<EntitiesStoreState>((set, get) => {
  let initialUuid: string | null = null;
  try {
    initialUuid = localStorage.getItem('organum.activeProjectUuid') || null;
  } catch {
    initialUuid = null;
  }
  const initialPrefs = loadPrefs(initialUuid);

  const patchAndPersist = (partial: Partial<PersistedEntitiesPrefs>) => {
    set(partial);
    const st = get();
    savePrefs(st.projectUuid, extractPrefs(st));
  };

  return {
    projectUuid: initialUuid,
    entitiesMaximized: false,
    ...initialPrefs,

    setSelectedEntity: (selectedEntityId) =>
      patchAndPersist({ selectedEntityId, selectedDeptId: null, selectedTaskId: null }),
    setSelectedDept: (selectedDeptId) => patchAndPersist({ selectedDeptId }),
    setSelectedTask: (selectedTaskId) => patchAndPersist({ selectedTaskId }),
    setCurrentFolder: (currentFolder) => patchAndPersist({ currentFolder }),
    setLayoutPreset: (layoutPreset) => patchAndPersist({ layoutPreset }),
    toggleMaximized: () => set((s) => ({ entitiesMaximized: !s.entitiesMaximized })),
    setMaximized: (entitiesMaximized) => set({ entitiesMaximized }),
    setScenefilesViewMode: (scenefilesViewMode) => patchAndPersist({ scenefilesViewMode }),
    setSortMode: (sortMode) => patchAndPersist({ sortMode }),
    setColLayout: (colLayout) => patchAndPersist({ colLayout }),
    setOuterLayout: (outerLayout) => patchAndPersist({ outerLayout }),
    setCol3VertLayout: (col3VertLayout) => patchAndPersist({ col3VertLayout }),

    resetForProjectSwitch: (nextProjectUuid) => {
      const nextPrefs = loadPrefs(nextProjectUuid);
      set({
        projectUuid: nextProjectUuid,
        entitiesMaximized: false,
        ...nextPrefs,
      });
    },
  };
});


import { create } from 'zustand';
import type { EntityOut } from '../../lib/api/client';

type InspectTarget =
  { kind: 'entity'; entity: EntityOut } | { kind: 'task'; taskId: string } | null;

interface InspectPopupState {
  target: InspectTarget;
  showEntity: (entity: EntityOut) => void;
  showTask: (taskId: string) => void;
  close: () => void;
}

/** Entity / Task details open as a popup (right-click → Show …), not in the inspector. */
export const useInspectPopupStore = create<InspectPopupState>((set) => ({
  target: null,
  showEntity: (entity) => set({ target: { kind: 'entity', entity } }),
  showTask: (taskId) => set({ target: { kind: 'task', taskId } }),
  close: () => set({ target: null }),
}));

import { create } from 'zustand';
import { apiClient } from '../../lib/api/client';

/**
 * Tracks which task reviews (decisions / comments left by other people) the
 * signed-in user has already opened. Persisted per project + user in the
 * server-side UI prefs so the red "unread review" dot follows the user across
 * machines.
 *
 * `feedback` maps taskId -> latest feedback timestamp (from the task list API).
 * `seen` maps taskId -> the feedback timestamp the user last opened.
 */
interface ReviewSeenState {
  prefKey: string | null;
  loaded: boolean;
  seen: Record<string, string>;
  feedback: Record<string, string>;
  init: (projectUuid: string | null, userId: string | null) => Promise<void>;
  setFeedback: (entries: ReadonlyArray<{ id: string; at: string | null | undefined }>) => void;
  markSeen: (taskId: string, feedbackAt?: string | null) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(key: string, seen: Record<string, string>): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void apiClient.putUiPref(key, seen).catch(() => {
      // best effort: the dot simply reappears next session if the save fails
    });
  }, 400);
}

export const useReviewSeenStore = create<ReviewSeenState>((set, get) => ({
  prefKey: null,
  loaded: false,
  seen: {},
  feedback: {},

  init: async (projectUuid, userId) => {
    const key = projectUuid && userId ? `reviews.seen.${projectUuid}.${userId}` : null;
    if (key === get().prefKey) return;
    set({ prefKey: key, loaded: false, seen: {}, feedback: {} });
    if (!key) return;
    try {
      const prefs = await apiClient.listUiPrefs();
      const hit = prefs.find((p) => p.key === key);
      const value =
        hit && hit.value_json && typeof hit.value_json === 'object'
          ? (hit.value_json as Record<string, string>)
          : {};
      if (get().prefKey === key) set({ seen: { ...value }, loaded: true });
    } catch {
      if (get().prefKey === key) set({ loaded: true });
    }
  },

  setFeedback: (entries) => {
    const cur = get().feedback;
    let changed = false;
    const next = { ...cur };
    for (const { id, at } of entries) {
      if (at) {
        if (next[id] !== at) {
          next[id] = at;
          changed = true;
        }
      } else if (id in next) {
        delete next[id];
        changed = true;
      }
    }
    if (changed) set({ feedback: next });
  },

  markSeen: (taskId, feedbackAt) => {
    const { prefKey, seen, feedback } = get();
    const at = feedbackAt ?? feedback[taskId];
    if (!at || seen[taskId] === at) return;
    const next = { ...seen, [taskId]: at };
    set({ seen: next });
    if (prefKey) scheduleSave(prefKey, next);
  },
}));

/** True when the task has feedback from someone else that the user has not opened yet. */
export function isReviewUnread(
  state: Pick<ReviewSeenState, 'loaded' | 'seen' | 'feedback'>,
  taskId: string,
  feedbackAt?: string | null,
): boolean {
  if (!state.loaded) return false;
  const at = feedbackAt ?? state.feedback[taskId];
  if (!at) return false;
  const seenAt = state.seen[taskId];
  return !seenAt || seenAt < at;
}

export function useReviewUnread(taskId: string | null | undefined, feedbackAt?: string | null) {
  return useReviewSeenStore((s) => (taskId ? isReviewUnread(s, taskId, feedbackAt) : false));
}

export function useUnreadReviewCount(): number {
  return useReviewSeenStore((s) => {
    if (!s.loaded) return 0;
    let n = 0;
    for (const id of Object.keys(s.feedback)) {
      if (isReviewUnread(s, id)) n += 1;
    }
    return n;
  });
}

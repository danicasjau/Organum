import { create } from 'zustand';
import {
  apiClient,
  registerAuthHandlers,
  type AuthMeOut,
  type BootstrapInfoOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';

interface AuthStoreState {
  auth: AuthMeOut | null;
  bootstrap: BootstrapInfoOut | null;
  loading: boolean;
  initialized: boolean;
  autoLogoutNotice: string | null;
  setAuth: (auth: AuthMeOut | null) => void;
  clearNotice: () => void;
  bootstrapSession: () => Promise<AuthMeOut | null>;
  refreshBootstrap: () => Promise<BootstrapInfoOut>;
  logout: () => Promise<void>;
  switchProjectSession: (notice?: string) => Promise<void>;
}

export const useAuthStore = create<AuthStoreState>((set, get) => {
  registerAuthHandlers({
    onUnauthorized: () => {
      if (get().auth !== null) {
        set({
          auth: null,
          autoLogoutNotice: 'Your session expired or was signed out. Please sign in again.',
        });
      }
    },
    onPasswordChangeRequired: () => {
      const cur = get().auth;
      if (cur && !cur.user.must_change_password) {
        set({
          auth: {
            ...cur,
            user: { ...cur.user, must_change_password: true },
          },
        });
      }
    },
  });

  return {
    auth: null,
    bootstrap: null,
    loading: false,
    initialized: false,
    autoLogoutNotice: null,

    setAuth: (auth) => {
      if (auth) {
        useProjectStore.getState().setActiveProject(auth.project_uuid);
      }
      set({ auth, initialized: true, autoLogoutNotice: null });
    },

    clearNotice: () => set({ autoLogoutNotice: null }),

    refreshBootstrap: async () => {
      const boot = await apiClient.getBootstrapInfo();
      set({ bootstrap: boot });
      return boot;
    },

    bootstrapSession: async () => {
      set({ loading: true });
      try {
        const boot = await apiClient.getBootstrapInfo();
        const hasCsrfCookie =
          typeof document !== 'undefined' && document.cookie.includes('organum_csrf=');
        let me: AuthMeOut | null = null;
        if (hasCsrfCookie) {
          try {
            me = await apiClient.getAuthMe();
            useProjectStore.getState().setActiveProject(me.project_uuid);
          } catch {
            me = null;
          }
        }
        set({ bootstrap: boot, auth: me, initialized: true, loading: false });
        return me;
      } catch {
        set({ auth: null, initialized: true, loading: false });
        return null;
      }
    },

    logout: async () => {
      const cur = get().auth;
      try {
        if (cur) {
          await apiClient.logout(cur.project_uuid);
        }
      } catch {
        // ignore network failures on logout
      }
      set({ auth: null, autoLogoutNotice: null });
    },

    switchProjectSession: async (notice) => {
      const cur = get().auth;
      set({ auth: null, autoLogoutNotice: notice ?? null });
      try {
        if (cur) {
          await apiClient.logout(cur.project_uuid);
        }
      } catch {
        // ignore network failures on logout
      }
    },
  };
});

export function hasPerm(permissions: Record<string, string> | undefined, key: string): boolean {
  if (!permissions) return false;
  return (permissions[key] ?? 'none') !== 'none';
}

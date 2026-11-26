import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { UnreadDot, type PanelTabItem } from '../components/ui';
import { useAuthStore } from '../features/auth/authStore';
import { useUnreadReviewCount } from '../features/reviews/reviewSeenStore';
import { getVisiblePanels } from './panels';

/** Top-level workspace tabs (ENTITIES / TASKS / USERS) shared by every page shell. */
export function useWorkspacePanels(): PanelTabItem[] {
  const navigate = useNavigate();
  const location = useLocation();
  const permissions = useAuthStore((s) => s.auth?.permissions);
  const unread = useUnreadReviewCount();

  return useMemo(
    () =>
      getVisiblePanels(permissions).map((p) => {
        const active = p.matches.some((prefix) => location.pathname.startsWith(prefix));
        return {
          id: p.id,
          label: p.label,
          href: p.route,
          active,
          indicator:
            p.id === 'tasks' && unread > 0 ? (
              <UnreadDot label={`${unread} task(s) with unread reviews`} />
            ) : undefined,
          onClick: () => {
            if (!active || location.pathname !== p.route) navigate(p.route);
          },
        };
      }),
    [permissions, location.pathname, navigate, unread],
  );
}

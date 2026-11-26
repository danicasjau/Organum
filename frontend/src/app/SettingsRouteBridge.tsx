import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../features/project/projectStore';

/**
 * Settings is a full-screen page now. Existing callers still use
 * `useProjectStore().openSettings(page)`; this turns that request into a navigation.
 */
export function SettingsRouteBridge() {
  const navigate = useNavigate();
  const settingsOpen = useProjectStore((s) => s.settingsOpen);
  const settingsPage = useProjectStore((s) => s.settingsPage);
  const closeSettings = useProjectStore((s) => s.closeSettings);

  useEffect(() => {
    if (!settingsOpen) return;
    closeSettings();
    navigate(`/settings?section=${settingsPage}`);
  }, [settingsOpen, settingsPage, closeSettings, navigate]);

  return null;
}

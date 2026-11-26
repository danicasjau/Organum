import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import { AuthenticatedShell } from '../auth/AuthenticatedShell';
import { useProjectStore, type SettingsPageId } from '../project/projectStore';
import { SettingsContent } from './SettingsDialog';

const SECTIONS: ReadonlyArray<SettingsPageId> = [
  'project',
  'departments',
  'applications',
  'detection',
  'appearance',
];

/** Full-screen Settings workspace (left nav + content), same layout as Users. */
export function SettingsPage({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsPage = useProjectStore((s) => s.settingsPage);
  const setSettingsPage = useProjectStore((s) => s.setSettingsPage);
  const requested = searchParams.get('section') as SettingsPageId | null;

  // URL → store (deep links, back/forward).
  useEffect(() => {
    if (requested && SECTIONS.includes(requested) && requested !== settingsPage) {
      setSettingsPage(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // store → URL (nav clicks). Only when the section really changed: on mount the store
  // still holds the previous section and must not overwrite a deep link.
  const lastSynced = useRef(settingsPage);
  useEffect(() => {
    if (lastSynced.current === settingsPage) return;
    lastSynced.current = settingsPage;
    if (requested !== settingsPage) {
      setSearchParams({ section: settingsPage }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsPage]);

  return (
    <AuthenticatedShell theme={theme} onToggleTheme={onToggleTheme} statusText="Settings">
      <SettingsContent theme={theme} onToggleTheme={onToggleTheme} />
    </AuthenticatedShell>
  );
}

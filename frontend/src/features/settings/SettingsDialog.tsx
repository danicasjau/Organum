import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ThemeMode } from '../../app/App';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  Icon,
  Inline,
  RadioGroup,
  RadioItem,
  Stack,
  Text,
  TextField,
  useToast,
} from '../../components/ui';
import {
  apiClient,
  type DepartmentOut,
  type LauncherItemIn,
} from '../../lib/api/client';
import { useProjectStore, type SettingsPageId } from '../project/projectStore';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import './SettingsDialog.css';

const DEFAULT_STARTER_CSV =
  'Modeling, Rigging, Animation, FX, Lighting, Lookdev, Compositing';

function sanitizePreview(raw: string): string {
  return raw
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const NAV_PAGES: ReadonlyArray<{ id: SettingsPageId; label: string }> = [
  { id: 'project', label: 'Project' },
  { id: 'departments', label: 'Departments' },
  { id: 'applications', label: 'Applications' },
  { id: 'detection', label: 'Detection' },
  { id: 'appearance', label: 'Appearance' },
];

const EMPTY_PROJECTS: Awaited<ReturnType<typeof apiClient.listProjects>> = [];
const EMPTY_DEPARTMENTS: DepartmentOut[] = [];

export function SettingsDialog({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const settingsOpen = useProjectStore((s) => s.settingsOpen);
  const settingsPage = useProjectStore((s) => s.settingsPage);
  const closeSettings = useProjectStore((s) => s.closeSettings);
  const setSettingsPage = useProjectStore((s) => s.setSettingsPage);

  // Create/Open Project form state
  const [createPath, setCreatePath] = useState('');
  const [createName, setCreateName] = useState('');
  const [useStarters, setUseStarters] = useState(true);
  const [startersText, setStartersText] = useState(DEFAULT_STARTER_CSV);
  const [openPath, setOpenPath] = useState('');
  const [browserTarget, setBrowserTarget] = useState<'create' | 'open' | null>(null);

  // Departments state
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [newDeptName, setNewDeptName] = useState('');
  const [newTaskName, setNewTaskName] = useState('');
  const [renameDeptDraft, setRenameDeptDraft] = useState('');

  // Launchers & Detection state
  const [launcherDrafts, setLauncherDrafts] = useState<LauncherItemIn[]>([]);
  const [udimKeywords, setUdimKeywords] = useState(
    'tex, texture, textures, maps, lookdev, texturing, udim, tile',
  );

  const { data: projectsData, refetch: refetchProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.listProjects(),
    enabled: settingsOpen,
  });
  const projects = projectsData ?? EMPTY_PROJECTS;

  const activeProject = projects.find((p) => p.uuid === activeProjectUuid) ?? null;

  const { data: departmentsData, refetch: refetchDepts } = useQuery({
    queryKey: ['departments', activeProjectUuid],
    queryFn: () => apiClient.listDepartments(activeProjectUuid),
    enabled: settingsOpen && Boolean(activeProjectUuid),
  });
  const departments = departmentsData ?? EMPTY_DEPARTMENTS;

  const { data: launchersData } = useQuery({
    queryKey: ['launchers'],
    queryFn: () => apiClient.listLaunchers(),
    enabled: settingsOpen && settingsPage === 'applications',
  });

  const { data: uiPrefsData } = useQuery({
    queryKey: ['ui-prefs'],
    queryFn: () => apiClient.listUiPrefs(),
    enabled: settingsOpen && settingsPage === 'detection',
  });

  useEffect(() => {
    if (!launchersData) return;
    setLauncherDrafts(
      launchersData.map((l) => ({
        id: l.id,
        extension: l.extension,
        label: l.label,
        executable_path: l.executable_path,
        args_template: l.args_template,
        is_default: l.is_default,
      })),
    );
  }, [launchersData]);

  useEffect(() => {
    if (!uiPrefsData) return;
    const pref = uiPrefsData.find((p) => p.key === 'udim_keywords');
    if (pref && Array.isArray(pref.value_json)) {
      setUdimKeywords((pref.value_json as string[]).join(', '));
    }
  }, [uiPrefsData]);

  useEffect(() => {
    if (departments.length > 0 && !departments.some((d) => d.id === selectedDeptId)) {
      setSelectedDeptId(departments[0]!.id);
    }
  }, [departments, selectedDeptId]);

  const selectedDept: DepartmentOut | null =
    departments.find((d) => d.id === selectedDeptId) ?? null;

  useEffect(() => {
    setRenameDeptDraft(selectedDept?.name ?? '');
  }, [selectedDept?.id, selectedDept?.name]);

  const handleCreateProject = async () => {
    try {
      const starterList = useStarters
        ? startersText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const created = await apiClient.createProject({
        path: createPath.trim(),
        name: createName.trim(),
        starter_departments: starterList,
      });
      await refetchProjects();
      setActiveProject(created.uuid, queryClient);
      toast.push('success', `Created project '${created.name}'`);
      setCreateName('');
      setCreatePath('');
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Create project failed');
    }
  };

  const handleOpenProject = async () => {
    try {
      const opened = await apiClient.openProject(openPath.trim());
      await refetchProjects();
      setActiveProject(opened.uuid, queryClient);
      toast.push('success', `Opened project '${opened.name}'`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Open project failed');
    }
  };

  const moveDept = async (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= departments.length) return;
    const ids = departments.map((d) => d.id);
    const [moved] = ids.splice(idx, 1);
    if (!moved) return;
    ids.splice(target, 0, moved);
    await apiClient.reorderDepartments(ids, activeProjectUuid);
    await refetchDepts();
  };

  const moveDefaultTask = async (idx: number, delta: -1 | 1) => {
    if (!selectedDept) return;
    const tasks = selectedDept.default_tasks ?? [];
    const target = idx + delta;
    if (target < 0 || target >= tasks.length) return;
    const ids = tasks.map((t) => t.id);
    const [moved] = ids.splice(idx, 1);
    if (!moved) return;
    ids.splice(target, 0, moved);
    await apiClient.reorderDefaultTasks(selectedDept.id, ids, activeProjectUuid);
    await refetchDepts();
  };

  return (
    <>
      <Dialog
        wide
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) closeSettings();
        }}
        title="Settings — ORGANUM Preferences"
        footer={<Button onClick={closeSettings}>Close</Button>}
      >
        <div className="org-settings">
          <nav className="org-settings__nav" aria-label="Settings sections">
            {NAV_PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                data-active={settingsPage === p.id ? 'true' : undefined}
                className="org-settings__nav-btn"
                onClick={() => setSettingsPage(p.id)}
              >
                {p.label}
              </button>
            ))}
          </nav>

          <div className="org-settings__content">
            {settingsPage === 'project' && (
              <>
                <div className="org-settings__section">
                  <Text variant="accent">Active Project</Text>
                  {activeProject ? (
                    <Stack gap="1">
                      <Text>
                        <strong>{activeProject.name}</strong> ({activeProject.uuid})
                      </Text>
                      <Text size="sm" variant="mono" truncate>
                        {activeProject.path}
                      </Text>
                      <Inline gap="2">
                        <Button
                          size="sm"
                          onClick={async () => {
                            const rep = await apiClient.reconcileProject(activeProject.uuid);
                            await queryClient.invalidateQueries({ queryKey: ['entities'] });
                            toast.push(
                              'info',
                              `Reconciled: ${rep.entities_scanned} entities, ${rep.files_scanned} files`,
                            );
                          }}
                        >
                          <Icon name="refresh" size="sm" /> Reconcile Disk &amp; DB
                        </Button>
                      </Inline>
                    </Stack>
                  ) : (
                    <Text variant="muted">No active project selected.</Text>
                  )}
                </div>

                <div className="org-settings__section">
                  <Text variant="accent">Create New Project</Text>
                  <div className="org-settings__form-row">
                    <Text size="sm">Folder Path</Text>
                    <div className="org-settings__field-with-btn">
                      <TextField
                        aria-label="New project folder path"
                        placeholder="M:/Shows/MyProject"
                        value={createPath}
                        onChange={(e) => setCreatePath(e.target.value)}
                      />
                      <Button size="sm" onClick={() => setBrowserTarget('create')}>
                        Browse...
                      </Button>
                    </div>
                  </div>
                  <div className="org-settings__form-row">
                    <Text size="sm">Project Name</Text>
                    <TextField
                      aria-label="New project name"
                      placeholder="My Show"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                    />
                  </div>
                  {createName.trim() !== '' && (
                    <div className="org-settings__form-row">
                      <Text size="sm" variant="muted">
                        Safe Token Preview
                      </Text>
                      <Text size="sm" variant="mono">
                        {sanitizePreview(createName) || '(invalid)'}
                      </Text>
                    </div>
                  )}
                  <Checkbox
                    label="Add starter departments"
                    checked={useStarters}
                    onChange={setUseStarters}
                  />
                  {useStarters && (
                    <TextField
                      aria-label="Starter departments list"
                      value={startersText}
                      onChange={(e) => setStartersText(e.target.value)}
                    />
                  )}
                  <Inline gap="2">
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!createPath.trim() || !createName.trim()}
                      onClick={handleCreateProject}
                    >
                      Create Project
                    </Button>
                  </Inline>
                </div>

                <div className="org-settings__section">
                  <Text variant="accent">Open Existing Project</Text>
                  <div className="org-settings__field-with-btn">
                    <TextField
                      aria-label="Open project folder path"
                      placeholder="Select folder containing 00_Pipeline/project.json"
                      value={openPath}
                      onChange={(e) => setOpenPath(e.target.value)}
                    />
                    <Button size="sm" onClick={() => setBrowserTarget('open')}>
                      Browse...
                    </Button>
                    <Button
                      size="sm"
                      disabled={!openPath.trim()}
                      onClick={handleOpenProject}
                    >
                      Open
                    </Button>
                  </div>

                  <Text size="sm" variant="muted">
                    Recent / Known Projects ({projects.length})
                  </Text>
                  <div className="org-settings__list">
                    {projects.map((p) => (
                      <div
                        key={p.uuid}
                        className="org-settings__list-row"
                        data-selected={p.uuid === activeProjectUuid ? 'true' : undefined}
                      >
                        <div>
                          <Text>
                            {p.name}{' '}
                            {p.uuid === activeProjectUuid && <Badge tone="accent">Active</Badge>}
                          </Text>
                          <Text size="sm" variant="mono">
                            {p.path}
                          </Text>
                        </div>
                        <Inline gap="1">
                          {p.uuid !== activeProjectUuid && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setActiveProject(p.uuid, queryClient);
                                toast.push('info', `Switched to '${p.name}'`);
                              }}
                            >
                              Switch
                            </Button>
                          )}
                          <Button
                            size="sm"
                            onClick={async () => {
                              await apiClient.forgetProject(p.uuid);
                              if (p.uuid === activeProjectUuid) {
                                setActiveProject(null, queryClient);
                              }
                              await refetchProjects();
                            }}
                          >
                            Forget
                          </Button>
                        </Inline>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {settingsPage === 'departments' && (
              <>
                {!activeProjectUuid ? (
                  <Banner severity="warning" title="No active project">
                    Create or open a project in the Project tab first.
                  </Banner>
                ) : (
                  <Stack gap="2">
                    <Banner severity="info" title="Catalog scope">
                      Changes apply only to entities or departments created afterwards.
                    </Banner>
                    <div className="org-settings__split">
                      <Stack gap="1">
                        <Text size="sm" variant="muted">
                          Departments ({departments.length})
                        </Text>
                        <div className="org-settings__field-with-btn">
                          <TextField
                            aria-label="New department name"
                            placeholder="Add department..."
                            value={newDeptName}
                            onChange={(e) => setNewDeptName(e.target.value)}
                          />
                          <Button
                            size="sm"
                            disabled={!newDeptName.trim()}
                            onClick={async () => {
                              const created = await apiClient.createDepartment(
                                newDeptName.trim(),
                                activeProjectUuid,
                              );
                              setNewDeptName('');
                              await refetchDepts();
                              setSelectedDeptId(created.id);
                            }}
                          >
                            Add
                          </Button>
                        </div>
                        <div className="org-settings__list">
                          {departments.map((d, idx) => (
                            <div
                              key={d.id}
                              className="org-settings__list-row"
                              data-selected={d.id === selectedDeptId ? 'true' : undefined}
                              onClick={() => setSelectedDeptId(d.id)}
                            >
                              <span>
                                {d.name}{' '}
                                {!d.is_active && <Badge tone="neutral">Inactive</Badge>}
                              </span>
                              <Inline gap="1">
                                <Button
                                  size="sm"
                                  disabled={idx === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void moveDept(idx, -1);
                                  }}
                                >
                                  Up
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={idx === departments.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void moveDept(idx, 1);
                                  }}
                                >
                                  Dn
                                </Button>
                              </Inline>
                            </div>
                          ))}
                        </div>
                        {selectedDept && (
                          <Inline gap="1">
                            <TextField
                              aria-label="Rename selected department"
                              value={renameDeptDraft}
                              onChange={(e) => setRenameDeptDraft(e.target.value)}
                            />
                            <Button
                              size="sm"
                              onClick={async () => {
                                await apiClient.updateDepartment(
                                  selectedDept.id,
                                  { name: renameDeptDraft.trim() },
                                  activeProjectUuid,
                                );
                                await refetchDepts();
                              }}
                            >
                              Rename
                            </Button>
                            <Button
                              size="sm"
                              onClick={async () => {
                                await apiClient.updateDepartment(
                                  selectedDept.id,
                                  { is_active: !selectedDept.is_active },
                                  activeProjectUuid,
                                );
                                await refetchDepts();
                              }}
                            >
                              {selectedDept.is_active ? 'Deactivate' : 'Activate'}
                            </Button>
                          </Inline>
                        )}
                      </Stack>

                      <Stack gap="1">
                        <Text size="sm" variant="muted">
                          Default Tasks ({selectedDept?.name ?? 'None'})
                        </Text>
                        <div className="org-settings__field-with-btn">
                          <TextField
                            aria-label="New default task name"
                            placeholder="Add default task..."
                            disabled={!selectedDept}
                            value={newTaskName}
                            onChange={(e) => setNewTaskName(e.target.value)}
                          />
                          <Button
                            size="sm"
                            disabled={!selectedDept || !newTaskName.trim()}
                            onClick={async () => {
                              if (!selectedDept) return;
                              await apiClient.createDefaultTask(
                                selectedDept.id,
                                newTaskName.trim(),
                                activeProjectUuid,
                              );
                              setNewTaskName('');
                              await refetchDepts();
                            }}
                          >
                            Add
                          </Button>
                        </div>
                        <div className="org-settings__list">
                          {(selectedDept?.default_tasks ?? []).map((t, idx) => (
                            <div key={t.id} className="org-settings__list-row">
                              <span>{t.name}</span>
                              <Inline gap="1">
                                <Button
                                  size="sm"
                                  disabled={idx === 0}
                                  onClick={() => void moveDefaultTask(idx, -1)}
                                >
                                  Up
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={idx === (selectedDept?.default_tasks?.length ?? 1) - 1}
                                  onClick={() => void moveDefaultTask(idx, 1)}
                                >
                                  Dn
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    await apiClient.deleteDefaultTask(t.id, activeProjectUuid);
                                    await refetchDepts();
                                  }}
                                >
                                  Del
                                </Button>
                              </Inline>
                            </div>
                          ))}
                        </div>
                      </Stack>
                    </div>
                  </Stack>
                )}
              </>
            )}

            {settingsPage === 'applications' && (
              <div className="org-settings__section">
                <Text
                  variant="accent"
                  title="Browsers block file:// execution. Programs launch via the local loopback ORGANUM backend."
                >
                  DCC Application Launchers
                </Text>
                <Text size="sm" variant="muted">
                  Programs are launched on the local machine by the backend (browsers block file://
                  links). Placeholders: {'{file}'}.
                </Text>
                <Inline gap="2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      const detected = await apiClient.autodetectLaunchers();
                      if (detected.length === 0) {
                        toast.push('info', 'No standard DCC executables found on PATH');
                        return;
                      }
                      setLauncherDrafts((prev) => {
                        const existingExts = new Set(prev.map((x) => x.extension.toLowerCase()));
                        const additions = detected
                          .filter((d) => !existingExts.has(d.extension.toLowerCase()))
                          .map((d) => ({ ...d, is_default: true }));
                        return [...prev, ...additions];
                      });
                      toast.push('info', `Detected ${detected.length} launcher candidate(s)`);
                    }}
                  >
                    Autodetect Installed DCCs
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setLauncherDrafts((prev) => [
                        ...prev,
                        {
                          extension: '.blend',
                          label: 'Blender',
                          executable_path: '',
                          args_template: '{file}',
                          is_default: true,
                        },
                      ])
                    }
                  >
                    Add Launcher
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={async () => {
                      await apiClient.saveLaunchers(launcherDrafts);
                      toast.push('success', 'Saved application launchers');
                    }}
                  >
                    Save Launchers
                  </Button>
                </Inline>

                <Stack gap="1">
                  {launcherDrafts.map((item, idx) => (
                    <div key={idx} className="org-settings__launcher-row">
                      <TextField
                        aria-label={`Extension ${idx}`}
                        value={item.extension}
                        onChange={(e) =>
                          setLauncherDrafts((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, extension: e.target.value } : x)),
                          )
                        }
                      />
                      <TextField
                        aria-label={`Label ${idx}`}
                        value={item.label}
                        onChange={(e) =>
                          setLauncherDrafts((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                          )
                        }
                      />
                      <TextField
                        aria-label={`Executable ${idx}`}
                        value={item.executable_path}
                        onChange={(e) =>
                          setLauncherDrafts((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, executable_path: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <TextField
                        aria-label={`Args ${idx}`}
                        value={item.args_template ?? '{file}'}
                        onChange={(e) =>
                          setLauncherDrafts((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, args_template: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <Button
                        size="sm"
                        onClick={() =>
                          setLauncherDrafts((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Del
                      </Button>
                    </div>
                  ))}
                </Stack>
              </div>
            )}

            {settingsPage === 'detection' && (
              <div className="org-settings__section">
                <Text variant="accent">UDIM vs Frame-Sequence Heuristic Keywords</Text>
                <Text size="sm" variant="muted">
                  Path and filename keywords weighted toward UDIM mosaic detection (when numeric
                  runs like 1001..1004 are ambiguous):
                </Text>
                <TextField
                  aria-label="UDIM heuristic keywords"
                  value={udimKeywords}
                  onChange={(e) => setUdimKeywords(e.target.value)}
                />
                <Inline gap="2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      const list = udimKeywords
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      await apiClient.putUiPref('udim_keywords', list);
                      toast.push('success', 'Saved UDIM detection keywords');
                    }}
                  >
                    Save Keywords
                  </Button>
                </Inline>
              </div>
            )}

            {settingsPage === 'appearance' && (
              <div className="org-settings__section">
                <Text variant="accent">Theme</Text>
                <RadioGroup
                  value={theme}
                  onChange={(val) => {
                    if (val !== theme) onToggleTheme();
                  }}
                >
                  <RadioItem value="dark" label="Dark (Default 2002 DCC Slate)" />
                  <RadioItem value="light" label="Light (Qt Fusion Slate)" />
                </RadioGroup>
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <FolderBrowserDialog
        open={browserTarget !== null}
        onOpenChange={(o) => {
          if (!o) setBrowserTarget(null);
        }}
        initialPath={browserTarget === 'create' ? createPath : openPath}
        onSelect={(selected) => {
          if (browserTarget === 'create') {
            setCreatePath(selected);
            if (!createName.trim()) {
              const parts = selected.split(/[\\/]/).filter(Boolean);
              setCreateName(parts[parts.length - 1] ?? '');
            }
          } else if (browserTarget === 'open') {
            setOpenPath(selected);
          }
          setBrowserTarget(null);
        }}
      />
    </>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Button,
  Icon,
  Inline,
  SplitGroup,
  SplitHandle,
  SplitPane,
  Text,
  useToast,
} from '../../components/ui';
import {
  apiClient,
  type DepartmentOut,
  type EntityOut,
  type FileSummaryOut,
  type SceneEntryOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { DeptTaskColumn } from './DeptTaskColumn';
import { useEntitiesStore, type LayoutPreset } from './entitiesStore';
import { EntityColumn } from './EntityColumn';
import { ProductsColumn, type PendingPublish } from './ProductsColumn';
import { ScenefilesExplorer } from './ScenefilesExplorer';
import './EntitiesWorkspaceDock.css';

const EMPTY_DEPARTMENTS: DepartmentOut[] = [];

export function EntitiesWorkspaceDock({
  selectedFileId,
  onSelectFile,
  onOpenMediaScenefile,
  onSelectedEntityChange,
  onStatusMessage,
  onApplyOuterPreset,
}: {
  selectedFileId: string | null;
  onSelectFile: (file: FileSummaryOut) => void;
  onOpenMediaScenefile: (taskId: string, entry: SceneEntryOut) => void;
  onSelectedEntityChange: (entity: EntityOut | null) => void;
  onStatusMessage: (msg: string) => void;
  onApplyOuterPreset: (preset: LayoutPreset) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);

  const selectedEntityId = useEntitiesStore((s) => s.selectedEntityId);
  const selectedTaskId = useEntitiesStore((s) => s.selectedTaskId);
  const layoutPreset = useEntitiesStore((s) => s.layoutPreset);
  const entitiesMaximized = useEntitiesStore((s) => s.entitiesMaximized);
  const setSelectedEntity = useEntitiesStore((s) => s.setSelectedEntity);
  const setSelectedTask = useEntitiesStore((s) => s.setSelectedTask);
  const setSelectedDept = useEntitiesStore((s) => s.setSelectedDept);
  const setLayoutPreset = useEntitiesStore((s) => s.setLayoutPreset);
  const toggleMaximized = useEntitiesStore((s) => s.toggleMaximized);
  const setColLayout = useEntitiesStore((s) => s.setColLayout);
  const setCol3VertLayout = useEntitiesStore((s) => s.setCol3VertLayout);

  const [addDeptDialogOpen, setAddDeptDialogOpen] = useState(false);
  const [pendingPublish, setPendingPublish] = useState<PendingPublish | null>(null);

  const { data: tree } = useQuery({
    queryKey: ['entities', activeProjectUuid],
    queryFn: () => apiClient.listEntities(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const { data: deptsData } = useQuery({
    queryKey: ['departments', activeProjectUuid],
    queryFn: () => apiClient.listDepartments(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });
  const catalogDepartments = deptsData ?? EMPTY_DEPARTMENTS;

  const activeTree = tree && tree.project_uuid === activeProjectUuid ? tree : undefined;

  // Auto-select first entity & task cleanly if selection is empty/missing
  const selectedEntity =
    activeTree?.entities?.find((e) => e.id === selectedEntityId) ??
    activeTree?.entities?.[0] ??
    null;

  useEffect(() => {
    onSelectedEntityChange(selectedEntity);
  }, [selectedEntity, onSelectedEntityChange]);

  useEffect(() => {
    if (
      activeTree?.entities?.length &&
      !activeTree.entities.some((e) => e.id === selectedEntityId)
    ) {
      setSelectedEntity(activeTree.entities[0]!.id);
    }
  }, [activeTree?.entities, selectedEntityId, setSelectedEntity]);

  const allTasks = (selectedEntity?.departments ?? []).flatMap((d) =>
    (d.tasks ?? []).map((t) => ({ deptId: d.id, task: t })),
  );
  const activeTaskPair =
    allTasks.find((p) => p.task.id === selectedTaskId) ?? allTasks[0] ?? null;

  useEffect(() => {
    if (activeTaskPair && activeTaskPair.task.id !== selectedTaskId) {
      setSelectedDept(activeTaskPair.deptId);
      setSelectedTask(activeTaskPair.task.id);
    }
  }, [activeTaskPair, selectedTaskId, setSelectedDept, setSelectedTask]);

  const reviewCollapsed = layoutPreset === 'review' && !entitiesMaximized;

  const handlePresetClick = (preset: LayoutPreset) => {
    setLayoutPreset(preset);
    onApplyOuterPreset(preset);
  };

  return (
    <div className="org-edock" data-ui="entities-dock">
      <div className="org-edock__bar">
        <Inline gap="1">
          <Text size="sm" variant="accent">
            Entities
          </Text>
          <Button
            size="sm"
            variant="toggle"
            pressed={layoutPreset === 'browse'}
            onClick={() => handlePresetClick('browse')}
          >
            Browse
          </Button>
          <Button
            size="sm"
            variant="toggle"
            pressed={layoutPreset === 'review'}
            onClick={() => handlePresetClick('review')}
          >
            Review
          </Button>
        </Inline>
        <Inline gap="1">
          <Button
            size="sm"
            variant="toggle"
            pressed={entitiesMaximized}
            title="Maximize Entities Browser (Ctrl+E)"
            aria-label="Maximize Entities Browser"
            onClick={toggleMaximized}
          >
            <Icon name="maximize" size="sm" />
          </Button>
          <Button
            size="sm"
            variant="icon"
            title="Reconcile project disk & DB"
            aria-label="Reconcile project"
            onClick={async () => {
              if (!activeProjectUuid) return;
              const rep = await apiClient.reconcileProject(activeProjectUuid);
              await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
              const msg = `Reconciled ${rep.entities_scanned} entities (${rep.files_scanned} files)`;
              onStatusMessage(msg);
              toast.push('info', msg);
            }}
          >
            <Icon name="refresh" size="sm" />
          </Button>
        </Inline>
      </div>

      <div className="org-edock__cols">
        <SplitGroup
          orientation="horizontal"
          onLayoutChanged={(layout) => setColLayout(layout)}
        >
          <SplitPane id="col-entities" defaultSize={reviewCollapsed ? '100%' : '34%'} minSize="140px">
            <EntityColumn
              tree={activeTree}
              departments={catalogDepartments}
              selectedEntityId={selectedEntity?.id ?? null}
              onSelectEntity={(eid) => setSelectedEntity(eid)}
              onRequestAddDepartment={(eid) => {
                setSelectedEntity(eid);
                setAddDeptDialogOpen(true);
              }}
            />
          </SplitPane>

          {!reviewCollapsed && (
            <>
              <SplitHandle />
              <SplitPane id="col-depts" defaultSize="25%" minSize="140px">
                <DeptTaskColumn
                  entity={selectedEntity}
                  catalogDepartments={catalogDepartments}
                  selectedTaskId={activeTaskPair?.task.id ?? null}
                  onSelectTask={(deptId, taskId) => {
                    setSelectedDept(deptId);
                    setSelectedTask(taskId);
                  }}
                  addDeptDialogOpen={addDeptDialogOpen}
                  onAddDeptDialogOpenChange={setAddDeptDialogOpen}
                />
              </SplitPane>

              <SplitHandle />
              <SplitPane id="col-prod-scene" defaultSize="41%" minSize="140px">
                <SplitGroup
                  orientation="vertical"
                  onLayoutChanged={(layout) => setCol3VertLayout(layout)}
                >
                  <SplitPane id="col3-products" defaultSize="50%" minSize="120px">
                    <ProductsColumn
                      entity={selectedEntity}
                      task={activeTaskPair?.task ?? null}
                      selectedFileId={selectedFileId}
                      onSelectFile={onSelectFile}
                      pendingExternalPublish={pendingPublish}
                      onClearExternalPublish={() => setPendingPublish(null)}
                    />
                  </SplitPane>
                  <SplitHandle />
                  <SplitPane id="col3-scenefiles" defaultSize="50%" minSize="120px">
                    <ScenefilesExplorer
                      task={activeTaskPair?.task ?? null}
                      onRequestPublish={(relPaths) =>
                        setPendingPublish({
                          source: 'scenefiles',
                          scenefileRelPaths: relPaths,
                          labels: relPaths,
                        })
                      }
                      onOpenMediaScenefile={onOpenMediaScenefile}
                    />
                  </SplitPane>
                </SplitGroup>
              </SplitPane>
            </>
          )}
        </SplitGroup>
      </div>
    </div>
  );
}


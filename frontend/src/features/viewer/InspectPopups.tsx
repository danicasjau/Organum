import { Dialog } from '../../components/ui';
import { EntityInspectorTab } from '../entities/EntityInspectorTab';
import { TaskDetail } from '../tasks/TaskDetail';
import { useInspectPopupStore } from './inspectPopupStore';
import './InspectPopups.css';

export function InspectPopups() {
  const target = useInspectPopupStore((s) => s.target);
  const close = useInspectPopupStore((s) => s.close);

  return (
    <Dialog
      wide
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={
        target?.kind === 'entity'
          ? `Entity — ${target.entity.name}`
          : target?.kind === 'task'
            ? 'Task'
            : ''
      }
    >
      <div className="org-inspect-popup">
        {target?.kind === 'entity' && <EntityInspectorTab entity={target.entity} />}
        {target?.kind === 'task' && <TaskDetail taskId={target.taskId} compact />}
      </div>
    </Dialog>
  );
}

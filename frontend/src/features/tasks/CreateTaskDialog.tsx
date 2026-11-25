import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  NumberField,
  Select,
  Stack,
  Text,
  TextField,
  useToast,
  DatePicker,
} from '../../components/ui';
import { apiClient, type DepartmentOut, type EntityOut } from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { PRIORITY_OPTIONS } from './taskHelpers';
import './CreateTaskDialog.css';

export function CreateTaskDialog({
  open,
  onOpenChange,
  entities,
  departments,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: ReadonlyArray<EntityOut>;
  departments: ReadonlyArray<DepartmentOut>;
  onCreated?: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);

  const [entityId, setEntityId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('main');
  const [priority, setPriority] = useState<'normal' | 'high' | 'stopper'>('normal');
  const [bidHours, setBidHours] = useState(8);
  const [needsLead, setNeedsLead] = useState(true);
  const [needsSup, setNeedsSup] = useState(false);
  const [needsClient, setNeedsClient] = useState(false);
  const [idealStart, setIdealStart] = useState('');
  const [idealFinish, setIdealFinish] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setEntityId(entities[0]?.id ?? '');
      setDepartmentId(departments[0]?.id ?? '');
      setName('main');
      setPriority('normal');
      setBidHours(8);
      setNeedsLead(true);
      setNeedsSup(false);
      setNeedsClient(false);
      setIdealStart('');
      setIdealFinish('');
      setErr(null);
    }
  }, [open, entities, departments]);

  const handleSubmit = async () => {
    if (!entityId || !departmentId || !name.trim()) {
      setErr('Entity, department, and task name are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await apiClient.createFullTask(
        {
          entity_id: entityId,
          department_id: departmentId,
          name: name.trim(),
          description: '',
          priority,
          bid_hours: bidHours,
          needs_lead_review: needsLead,
          needs_sup_review: needsSup,
          needs_client_review: needsClient,
          ideal_start_date: idealStart || null,
          ideal_finish_date: idealFinish || null,
        },
        activeProjectUuid,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] }),
      ]);
      toast.push('success', `Created task ${created.task_code}`);
      onCreated?.(created.id);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to create task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New Task"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? 'Creating...' : 'Create Task'}
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-ctdlg">
        {err && <Banner severity="danger">{err}</Banner>}
        <div className="org-ctdlg__grid2">
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Entity
            </Text>
            <Select
              ariaLabel="Task entity"
              value={entityId}
              onChange={setEntityId}
              options={entities.map((e) => ({
                value: e.id,
                label: `${e.name}${e.entity_type ? ` (${e.entity_type})` : ''}`,
              }))}
            />
          </Stack>
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Department
            </Text>
            <Select
              ariaLabel="Task department"
              value={departmentId}
              onChange={setDepartmentId}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </Stack>
        </div>

        <div className="org-ctdlg__grid2">
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Task Name
            </Text>
            <TextField
              aria-label="New task name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Stack>
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Priority
            </Text>
            <Select
              ariaLabel="New task priority"
              value={priority}
              onChange={(v) => setPriority(v as 'normal' | 'high' | 'stopper')}
              options={[...PRIORITY_OPTIONS]}
            />
          </Stack>
        </div>

        <div className="org-ctdlg__grid2">
          <NumberField
            label="Bid Hours"
            ariaLabel="Bid hours"
            value={bidHours}
            min={0}
            max={2000}
            step={2}
            precision={1}
            onChange={setBidHours}
          />
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Planned Start / Finish
            </Text>
            <div className="org-ctdlg__dates">
              <DatePicker
                ariaLabel="Planned start date"
                placeholder="Planned start"
                value={idealStart}
                max={idealFinish || null}
                onChange={(v) => setIdealStart(v ?? '')}
              />
              <DatePicker
                ariaLabel="Planned finish date"
                placeholder="Planned finish"
                value={idealFinish}
                min={idealStart || null}
                onChange={(v) => setIdealFinish(v ?? '')}
              />
            </div>
          </Stack>
        </div>

        <div className="org-ctdlg__checks">
          <Checkbox label="Needs Lead review" checked={needsLead} onChange={setNeedsLead} />
          <Checkbox label="Needs Sup review" checked={needsSup} onChange={setNeedsSup} />
          <Checkbox label="Needs Client review" checked={needsClient} onChange={setNeedsClient} />
        </div>
      </Stack>
    </Dialog>
  );
}

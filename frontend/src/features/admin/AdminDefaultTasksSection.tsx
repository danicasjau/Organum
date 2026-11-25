import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  Checkbox,
  Panel,
  Select,
  Stack,
  Text,
  TextField,
} from '../../components/ui';
import { apiClient, type DepartmentOut } from '../../lib/api/client';

const EMPTY_DEPTS: DepartmentOut[] = [];

export function AdminDefaultTasksSection({ projectUuid }: { projectUuid: string | null }) {
  const queryClient = useQueryClient();
  const deptsQuery = useQuery({
    queryKey: ['departments', projectUuid],
    queryFn: () => apiClient.listDepartments(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const departments: DepartmentOut[] = useMemo(
    () => deptsQuery.data ?? EMPTY_DEPTS,
    [deptsQuery.data],
  );

  const [deptId, setDeptId] = useState('');
  const [taskName, setTaskName] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high' | 'stopper'>('normal');
  const [bidHours, setBidHours] = useState('8');
  const [leadRev, setLeadRev] = useState(true);
  const [supRev, setSupRev] = useState(false);
  const [clientRev, setClientRev] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!deptId && departments[0]) {
      setDeptId(departments[0].id);
    }
  }, [departments, deptId]);

  const activeDept = departments.find((d) => d.id === deptId) ?? null;

  const handleAdd = async () => {
    if (!deptId || !taskName.trim()) {
      setErrorMsg('Select a department and enter a task name.');
      return;
    }
    setErrorMsg(null);
    try {
      await apiClient.createDefaultTask(
        deptId,
        {
          name: taskName.trim(),
          needs_lead_review: leadRev,
          needs_sup_review: supRev,
          needs_client_review: clientRev,
          default_priority: priority,
          default_bid_hours: bidHours ? Number(bidHours) : null,
        },
        projectUuid,
      );
      setTaskName('');
      await queryClient.invalidateQueries({ queryKey: ['departments', projectUuid] });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create default task');
    }
  };

  return (
    <div data-ui="admin-default-tasks">
      <Panel title="Department Default Tasks">
      <Stack gap="2">
        {errorMsg && <Banner severity="danger">{errorMsg}</Banner>}
        <div className="org-admin-toolbar">
          <Select
            ariaLabel="Department for default tasks"
            value={deptId}
            onChange={setDeptId}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          <TextField
            aria-label="Default task name"
            placeholder="Task name (e.g. main)"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
          />
          <Select
            ariaLabel="Default task priority"
            value={priority}
            onChange={(v) => setPriority(v as 'normal' | 'high' | 'stopper')}
            options={[
              { value: 'normal', label: 'normal' },
              { value: 'high', label: 'high' },
              { value: 'stopper', label: 'stopper' },
            ]}
          />
          <TextField
            aria-label="Default bid hours"
            type="number"
            placeholder="Bid h"
            value={bidHours}
            onChange={(e) => setBidHours(e.target.value)}
          />
          <Checkbox label="Lead" checked={leadRev} onChange={setLeadRev} />
          <Checkbox label="Sup" checked={supRev} onChange={setSupRev} />
          <Checkbox label="Client" checked={clientRev} onChange={setClientRev} />
          <Button size="sm" variant="primary" onClick={() => void handleAdd()}>
            Add Default Task
          </Button>
        </div>

        <div className="org-admin-table-wrap">
          <table className="org-admin-matrix" aria-label="Department default tasks">
            <thead>
              <tr>
                <th>Task Name</th>
                <th>Priority</th>
                <th>Bid (h)</th>
                <th>Lead</th>
                <th>Sup</th>
                <th>Client</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(activeDept?.default_tasks ?? []).map((dt) => (
                <tr key={dt.id}>
                  <td className="org-admin-matrix__perm">{dt.name}</td>
                  <td>{dt.default_priority ?? 'normal'}</td>
                  <td>{dt.default_bid_hours ?? '—'}</td>
                  <td>
                    <Checkbox
                      ariaLabel={`${dt.name} lead review`}
                      checked={Boolean(dt.needs_lead_review)}
                      onChange={(v) => {
                        void apiClient
                          .updateDefaultTask(dt.id, { needs_lead_review: v }, projectUuid)
                          .then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ['departments', projectUuid],
                            }),
                          );
                      }}
                    />
                  </td>
                  <td>
                    <Checkbox
                      ariaLabel={`${dt.name} sup review`}
                      checked={Boolean(dt.needs_sup_review)}
                      onChange={(v) => {
                        void apiClient
                          .updateDefaultTask(dt.id, { needs_sup_review: v }, projectUuid)
                          .then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ['departments', projectUuid],
                            }),
                          );
                      }}
                    />
                  </td>
                  <td>
                    <Checkbox
                      ariaLabel={`${dt.name} client review`}
                      checked={Boolean(dt.needs_client_review)}
                      onChange={(v) => {
                        void apiClient
                          .updateDefaultTask(dt.id, { needs_client_review: v }, projectUuid)
                          .then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ['departments', projectUuid],
                            }),
                          );
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void apiClient
                          .deleteDefaultTask(dt.id, projectUuid)
                          .then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ['departments', projectUuid],
                            }),
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
              {(!activeDept || (activeDept.default_tasks ?? []).length === 0) && (
                <tr>
                  <td colSpan={7}>
                    <Text size="sm" variant="muted">
                      No default tasks configured for this department.
                    </Text>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Stack>
    </Panel>
    </div>
  );
}

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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

export function AdminDepTemplatesSection({ projectUuid }: { projectUuid: string | null }) {
  const queryClient = useQueryClient();
  const [upDeptId, setUpDeptId] = useState('');
  const [upTaskName, setUpTaskName] = useState('');
  const [dnDeptId, setDnDeptId] = useState('');
  const [dnTaskName, setDnTaskName] = useState('');
  const [threshold, setThreshold] = useState<'APP' | 'PUBLISHED' | 'ANY_STATUS'>('APP');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const deptsQuery = useQuery({
    queryKey: ['departments', projectUuid],
    queryFn: () => apiClient.listDepartments(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const tplsQuery = useQuery({
    queryKey: ['dep-templates', projectUuid],
    queryFn: () => apiClient.listDependencyTemplates(projectUuid),
    enabled: Boolean(projectUuid),
  });

  const departments: DepartmentOut[] = deptsQuery.data ?? [];
  const templates = tplsQuery.data ?? [];

  const handleCreate = async () => {
    if (!upDeptId || !dnDeptId) {
      setErrorMsg('Select both upstream and downstream departments.');
      return;
    }
    setErrorMsg(null);
    try {
      await apiClient.createDependencyTemplate(
        {
          upstream_department_id: upDeptId,
          upstream_task_name: upTaskName.trim() || null,
          downstream_department_id: dnDeptId,
          downstream_task_name: dnTaskName.trim() || null,
          threshold,
          enabled: true,
        },
        projectUuid,
      );
      setUpTaskName('');
      setDnTaskName('');
      await queryClient.invalidateQueries({ queryKey: ['dep-templates', projectUuid] });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create template');
    }
  };

  return (
    <div data-ui="admin-dep-templates">
      <Panel title="Entity-Link Dependency Templates">
      <Stack gap="2">
        {errorMsg && <Banner severity="danger">{errorMsg}</Banner>}
        <Text size="sm" variant="muted">
          Templates map upstream → downstream departments when suggesting dependencies from entity links.
        </Text>
        <div className="org-admin-toolbar">
          <Select
            ariaLabel="Upstream department"
            value={upDeptId}
            onChange={setUpDeptId}
            options={[
              { value: '', label: 'Upstream dept…' },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <TextField
            aria-label="Upstream task filter"
            placeholder="Upstream task (optional)"
            value={upTaskName}
            onChange={(e) => setUpTaskName(e.target.value)}
          />
          <Select
            ariaLabel="Downstream department"
            value={dnDeptId}
            onChange={setDnDeptId}
            options={[
              { value: '', label: 'Downstream dept…' },
              ...departments.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
          <TextField
            aria-label="Downstream task filter"
            placeholder="Downstream task (optional)"
            value={dnTaskName}
            onChange={(e) => setDnTaskName(e.target.value)}
          />
          <Select
            ariaLabel="Template threshold"
            value={threshold}
            onChange={(v) => setThreshold(v as 'APP' | 'PUBLISHED' | 'ANY_STATUS')}
            options={[
              { value: 'APP', label: 'APP' },
              { value: 'PUBLISHED', label: 'PUBLISHED' },
              { value: 'ANY_STATUS', label: 'ANY_STATUS' },
            ]}
          />
          <Button size="sm" variant="primary" onClick={() => void handleCreate()}>
            Add Template
          </Button>
        </div>

        <div className="org-admin-table-wrap">
          <table className="org-admin-matrix" aria-label="Dependency templates">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Upstream</th>
                <th>Downstream</th>
                <th>Threshold</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Checkbox
                      ariaLabel={`Enable template ${t.id}`}
                      checked={t.enabled}
                      onChange={(checked) => {
                        void apiClient
                          .updateDependencyTemplate(t.id, { enabled: checked }, projectUuid)
                          .then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ['dep-templates', projectUuid],
                            }),
                          );
                      }}
                    />
                  </td>
                  <td>
                    {t.upstream_department_name}
                    {t.upstream_task_name ? ` / ${t.upstream_task_name}` : ' / *'}
                  </td>
                  <td>
                    {t.downstream_department_name}
                    {t.downstream_task_name ? ` / ${t.downstream_task_name}` : ' / *'}
                  </td>
                  <td>{t.threshold}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void apiClient
                          .deleteDependencyTemplate(t.id, projectUuid)
                          .then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ['dep-templates', projectUuid],
                            }),
                          );
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Stack>
    </Panel>
    </div>
  );
}


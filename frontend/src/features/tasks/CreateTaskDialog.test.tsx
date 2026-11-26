import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui';
import {
  apiClient,
  type AuthMeOut,
  type DepartmentOut,
  type EntityOut,
  type TaskDetailOut,
} from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { CreateTaskDialog } from './CreateTaskDialog';

const customDepartment: DepartmentOut = {
  id: 'department-custom',
  name: 'Lighting',
  folder_name: 'Lighting',
  short_code: 'LIG',
  color: '--series-1',
  sort_order: 1,
  is_active: true,
  default_tasks: [],
};

const entities = [
  {
    id: 'entity-selected',
    name: 'Hero',
    entity_type: null,
  } as EntityOut,
];

describe('CreateTaskDialog custom department', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useProjectStore.setState({ activeProjectUuid: null });
    useAuthStore.setState({ auth: null });
  });

  it('creates a typed department and uses it for the selected entity task', async () => {
    useProjectStore.setState({ activeProjectUuid: 'project-1' });
    useAuthStore.setState({
      auth: {
        user: {
          id: 'user-1',
          username: 'admin',
          full_name: 'Admin',
          role_id: 'role-1',
          role_name: 'admin',
          role_label: 'Admin',
          daily_capacity_hours: 8,
          timezone: 'UTC',
          is_active: true,
          must_change_password: false,
        },
        project_uuid: 'project-1',
        project_status: 'active',
        permissions: { 'entity.manage': 'all' },
        capacity_permissions: {},
      } satisfies AuthMeOut,
    });
    const createDepartment = vi
      .spyOn(apiClient, 'createDepartment')
      .mockResolvedValue(customDepartment);
    const createFullTask = vi.spyOn(apiClient, 'createFullTask').mockResolvedValue({
      id: 'task-1',
      task_code: 'HERO_LIG_MAIN',
    } as TaskDetailOut);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CreateTaskDialog open onOpenChange={vi.fn()} entities={entities} departments={[]} />
        </ToastProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Task department' }));
    fireEvent.click(screen.getByRole('option', { name: 'Create custom department...' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom department name' }), {
      target: { value: 'Lighting' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => {
      expect(createDepartment).toHaveBeenCalledWith('Lighting', 'project-1');
      expect(createFullTask).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_id: 'entity-selected',
          department_id: 'department-custom',
          name: 'main',
        }),
        'project-1',
      );
    });
  });
});

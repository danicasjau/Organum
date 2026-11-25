import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { useDeptColorStore } from './deptColors';

/** Root-level sync of the department catalog colors (shared by every view). */
export function DepartmentColorSync() {
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const setDepartments = useDeptColorStore((s) => s.setDepartments);
  const enabled = Boolean(auth && activeProjectUuid && auth.project_uuid === activeProjectUuid);

  const { data } = useQuery({
    queryKey: ['departments', activeProjectUuid],
    queryFn: () => apiClient.listDepartments(activeProjectUuid),
    enabled,
  });

  useEffect(() => {
    setDepartments(data ?? []);
  }, [data, setDepartments]);

  return null;
}

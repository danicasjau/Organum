import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  formatDisplayDate,
  Icon,
  Panel,
  Stack,
  Text,
  toIsoDate,
} from '../../components/ui';
import { apiClient, type UserOut } from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

/**
 * "Time" section of the Users panel: project working time plus each person's
 * daily capacity and the hours planned for them in the selected week.
 */
export function TimeCapacitySection({
  users,
  onOpenProjectSettings,
}: {
  users: ReadonlyArray<UserOut>;
  onOpenProjectSettings?: () => void;
}) {
  const auth = useAuthStore((s) => s.auth);
  const projectUuid = auth?.project_uuid ?? null;
  const canWorkload = hasPerm(auth?.permissions, 'views.workload');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const fromIso = toIsoDate(weekStart);
  const toIso = toIsoDate(weekEnd);

  const settingsQuery = useQuery({
    queryKey: ['project-settings', projectUuid],
    queryFn: () => apiClient.getProjectSettings(projectUuid),
    enabled: Boolean(projectUuid),
  });

  const workloadQuery = useQuery({
    queryKey: ['workload', projectUuid, 'users-time', fromIso, toIso],
    queryFn: () => apiClient.getWorkload({ date_from: fromIso, date_to: toIso }, projectUuid),
    enabled: Boolean(projectUuid && canWorkload),
  });

  const plannedByUser = useMemo(() => {
    const m = new Map<string, { hours: number; capacity: number }>();
    for (const row of workloadQuery.data?.rows ?? []) {
      let hours = 0;
      let capacity = 0;
      for (const c of row.cells ?? []) {
        hours += c.hours;
        capacity += c.capacity_hours;
      }
      m.set(row.user_id, { hours, capacity });
    }
    return m;
  }, [workloadQuery.data]);

  const settings = settingsQuery.data;
  const workingDays = (settings?.working_days ?? [])
    .map((d) => WEEKDAY_NAMES[d % 7] ?? String(d))
    .join(', ');

  const shiftWeek = (delta: number) =>
    setWeekStart((w) => new Date(w.getFullYear(), w.getMonth(), w.getDate() + delta * 7));

  const activeUsers = users.filter((u) => u.is_active);

  return (
    <Stack gap="4" className="org-users-time">
      <Panel title="Project working time">
        <div className="org-users-time__facts">
          <div className="org-users-time__fact">
            <span className="org-users-time__fact-label">Hours per day</span>
            <span className="org-users-time__fact-value">{settings?.hours_per_day ?? '—'}h</span>
          </div>
          <div className="org-users-time__fact">
            <span className="org-users-time__fact-label">Working days</span>
            <span className="org-users-time__fact-value">{workingDays || '—'}</span>
          </div>
          <div className="org-users-time__fact">
            <span className="org-users-time__fact-label">Team daily capacity</span>
            <span className="org-users-time__fact-value">
              {activeUsers.reduce((acc, u) => acc + (u.daily_capacity_hours ?? 0), 0)}h
            </span>
          </div>
          {onOpenProjectSettings && (
            <Button size="sm" onClick={onOpenProjectSettings}>
              <Icon name="settings" size="sm" /> Edit project time settings
            </Button>
          )}
        </div>
      </Panel>

      <Panel title="Team time">
        <Stack gap="3">
          <div className="org-users-time__weekbar">
            <Button
              size="sm"
              variant="icon"
              aria-label="Previous week"
              onClick={() => shiftWeek(-1)}
            >
              <Icon name="chevron-left" size="sm" />
            </Button>
            <Text size="sm" variant="mono">
              {formatDisplayDate(fromIso)} — {formatDisplayDate(toIso)}
            </Text>
            <Button size="sm" variant="icon" aria-label="Next week" onClick={() => shiftWeek(1)}>
              <Icon name="chevron-right" size="sm" />
            </Button>
            <Button size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
              This week
            </Button>
          </div>
          {!canWorkload && (
            <Banner severity="info">
              Planned hours need the workload view permission; capacities are still listed.
            </Banner>
          )}
          <div className="org-users-table-wrap">
            <table className="org-users-table" aria-label="Team time">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Daily capacity</th>
                  <th>Timezone</th>
                  <th>Planned this week</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u) => {
                  const planned = plannedByUser.get(u.id);
                  const pct =
                    planned && planned.capacity > 0
                      ? Math.round((planned.hours / planned.capacity) * 100)
                      : null;
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className="org-users-time__person">
                          <Avatar
                            username={u.username}
                            fullName={u.full_name}
                            avatarUrl={
                              u.avatar_file ? apiClient.userAvatarUrl(u.id, projectUuid) : null
                            }
                            size="md"
                          />
                          <span>{u.full_name}</span>
                        </span>
                      </td>
                      <td>{u.role_label}</td>
                      <td className="org-users-time__num">{u.daily_capacity_hours}h</td>
                      <td>{u.timezone}</td>
                      <td className="org-users-time__num">
                        {planned ? `${planned.hours.toFixed(1)}h` : '—'}
                      </td>
                      <td>
                        {pct === null ? (
                          <Text size="sm" variant="muted">
                            —
                          </Text>
                        ) : (
                          <Badge tone={pct > 100 ? 'danger' : pct >= 80 ? 'warning' : 'success'}>
                            {pct}%
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Stack>
      </Panel>
    </Stack>
  );
}

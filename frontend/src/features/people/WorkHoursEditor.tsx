import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  DatePicker,
  Icon,
  Text,
  TextField,
  useToast,
} from '../../components/ui';
import { apiClient, type WorkException, type WorkHoursOut } from '../../lib/api/client';
import {
  WEEKDAYS,
  averageDailyHours,
  dayHours,
  dayProblem,
  normalizeWeek,
  summarizeWeek,
  weeklyHours,
  type Day,
} from './workHoursModel';
import './people.css';

/** One-line read-only summary of a person's working hours (used in lists and side panels). */
export function WorkHoursSummary({
  userId,
  projectUuid,
}: {
  userId: string;
  projectUuid: string | null;
}) {
  const q = useQuery({
    queryKey: ['work-hours', projectUuid, userId],
    queryFn: () => apiClient.getWorkHours(userId, projectUuid),
    enabled: Boolean(projectUuid),
    retry: false,
  });
  if (!q.data)
    return (
      <Text size="sm" variant="muted">
        …
      </Text>
    );
  return (
    <span className="org-wh-summary" data-ui="work-hours-summary">
      <Text size="sm">{summarizeWeek(normalizeWeek(q.data.weekly))}</Text>
      <Badge tone="neutral">{q.data.weekly_hours}h/week</Badge>
      {q.data.is_default && <Badge tone="info">project default</Badge>}
      <Text size="sm" variant="muted">
        {q.data.timezone}
      </Text>
    </span>
  );
}

/**
 * CR04 §8: per-weekday working intervals, timezone and dated exceptions (day off / special
 * hours). Daily capacity is derived from these hours on save.
 */
export function WorkHoursEditor({
  userId,
  projectUuid,
  editable,
}: {
  userId: string;
  projectUuid: string | null;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = ['work-hours', projectUuid, userId];
  const q = useQuery({
    queryKey,
    queryFn: () => apiClient.getWorkHours(userId, projectUuid),
    enabled: Boolean(projectUuid),
  });
  const [week, setWeek] = useState<Day[]>(normalizeWeek([]));
  const [timezone, setTimezone] = useState('UTC');
  const [exceptions, setExceptions] = useState<WorkException[]>([]);
  const [dirty, setDirtyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server data never overwrites unsaved local edits.
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  };

  const applyServer = (data: WorkHoursOut) => {
    setWeek(normalizeWeek(data.weekly));
    setTimezone(data.timezone);
    setExceptions(data.exceptions ?? []);
    setDirty(false);
  };

  useEffect(() => {
    if (!q.data || dirtyRef.current) return;
    applyServer(q.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  const patchDay = (weekday: number, next: Day) => {
    setWeek((prev) => prev.map((d) => (d.weekday === weekday ? next : d)));
    setDirty(true);
  };
  const problems = week.map(dayProblem);
  const hasProblem = problems.some(Boolean);

  const save = async (useDefault = false) => {
    setError(null);
    try {
      const res = await apiClient.putWorkHours(
        userId,
        {
          timezone,
          use_project_default: useDefault,
          weekly: week.filter((d) => d.intervals.length > 0),
          // A reset is a full reset: weekly hours and dated exceptions.
          exceptions: useDefault ? [] : exceptions,
        },
        projectUuid,
      );
      queryClient.setQueryData(queryKey, res);
      applyServer(res);
      await queryClient.invalidateQueries({ queryKey: ['users', projectUuid] });
      toast.push('success', useDefault ? 'Reset to project default hours' : 'Working hours saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save working hours');
    }
  };

  if (!q.data)
    return (
      <Text size="sm" variant="muted">
        Loading working hours…
      </Text>
    );

  return (
    <div className="org-wh" data-ui="work-hours-editor">
      {error && <Banner severity="danger">{error}</Banner>}
      <div className="org-wh__head">
        <label className="org-wh__tz">
          <Text size="sm" variant="muted">
            Timezone
          </Text>
          <TextField
            aria-label="Timezone"
            value={timezone}
            disabled={!editable}
            placeholder="Europe/Madrid"
            onChange={(e) => {
              setTimezone(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <Badge tone="neutral">{weeklyHours(week)}h / week</Badge>
        <Badge tone="neutral">≈ {averageDailyHours(week)}h / working day</Badge>
        {q.data.is_default && !dirty && <Badge tone="info">project default</Badge>}
      </div>

      <table className="org-wh__table" aria-label="Weekly working hours">
        <tbody>
          {week.map((day, i) => (
            <tr key={day.weekday} data-off={day.intervals.length === 0 ? 'true' : undefined}>
              <th scope="row">{WEEKDAYS[day.weekday - 1]}</th>
              <td>
                <div className="org-wh__intervals">
                  {day.intervals.length === 0 && (
                    <Text size="sm" variant="muted">
                      Off
                    </Text>
                  )}
                  {day.intervals.map((iv, j) => (
                    <span key={j} className="org-wh__iv">
                      <input
                        type="time"
                        className="org-wh__time"
                        aria-label={`${WEEKDAYS[day.weekday - 1]} interval ${j + 1} start`}
                        value={iv.start}
                        disabled={!editable}
                        onChange={(e) =>
                          patchDay(day.weekday, {
                            ...day,
                            intervals: day.intervals.map((x, k) =>
                              k === j ? { ...x, start: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      –
                      <input
                        type="time"
                        className="org-wh__time"
                        aria-label={`${WEEKDAYS[day.weekday - 1]} interval ${j + 1} end`}
                        value={iv.end}
                        disabled={!editable}
                        onChange={(e) =>
                          patchDay(day.weekday, {
                            ...day,
                            intervals: day.intervals.map((x, k) =>
                              k === j ? { ...x, end: e.target.value } : x,
                            ),
                          })
                        }
                      />
                      {editable && (
                        <Button
                          size="sm"
                          variant="icon"
                          aria-label={`Remove ${WEEKDAYS[day.weekday - 1]} interval ${j + 1}`}
                          onClick={() =>
                            patchDay(day.weekday, {
                              ...day,
                              intervals: day.intervals.filter((_, k) => k !== j),
                            })
                          }
                        >
                          <Icon name="close" size="sm" />
                        </Button>
                      )}
                    </span>
                  ))}
                  {editable && (
                    <Button
                      size="sm"
                      aria-label={`Add ${WEEKDAYS[day.weekday - 1]} interval`}
                      onClick={() => {
                        const last = day.intervals[day.intervals.length - 1];
                        patchDay(day.weekday, {
                          ...day,
                          intervals: [
                            ...day.intervals,
                            last
                              ? { start: last.end, end: last.end }
                              : { start: '09:00', end: '17:00' },
                          ],
                        });
                      }}
                    >
                      <Icon name="plus" size="sm" />
                    </Button>
                  )}
                </div>
                {problems[i] && (
                  <Text size="sm" variant="danger" role="alert">
                    ⚠ {problems[i]}
                  </Text>
                )}
              </td>
              <td className="org-wh__hours">{dayHours(day).toFixed(1)}h</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="org-wh__exc">
        <Text size="sm" variant="accent">
          Exceptions (days off, special hours)
        </Text>
        {exceptions.length === 0 && (
          <Text size="sm" variant="muted">
            None.
          </Text>
        )}
        {exceptions.map((ex, i) => (
          <div key={`${ex.day}-${i}`} className="org-wh__exc-row">
            <DatePicker
              ariaLabel={`Exception ${i + 1} date`}
              value={ex.day}
              disabled={!editable}
              onChange={(v) => {
                if (!v) return;
                setExceptions((prev) => prev.map((x, k) => (k === i ? { ...x, day: v } : x)));
                setDirty(true);
              }}
            />
            <Checkbox
              label="Day off"
              disabled={!editable}
              checked={Boolean(ex.off)}
              onChange={(off) => {
                setExceptions((prev) =>
                  prev.map((x, k) =>
                    k === i
                      ? { ...x, off, intervals: off ? [] : [{ start: '09:00', end: '13:00' }] }
                      : x,
                  ),
                );
                setDirty(true);
              }}
            />
            {!ex.off &&
              (ex.intervals ?? []).map((iv, j) => (
                <span key={j} className="org-wh__iv">
                  <input
                    type="time"
                    className="org-wh__time"
                    aria-label={`Exception ${i + 1} start`}
                    value={iv.start}
                    disabled={!editable}
                    onChange={(e) => {
                      setExceptions((prev) =>
                        prev.map((x, k) =>
                          k === i
                            ? {
                                ...x,
                                intervals: (x.intervals ?? []).map((y, m) =>
                                  m === j ? { ...y, start: e.target.value } : y,
                                ),
                              }
                            : x,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                  –
                  <input
                    type="time"
                    className="org-wh__time"
                    aria-label={`Exception ${i + 1} end`}
                    value={iv.end}
                    disabled={!editable}
                    onChange={(e) => {
                      setExceptions((prev) =>
                        prev.map((x, k) =>
                          k === i
                            ? {
                                ...x,
                                intervals: (x.intervals ?? []).map((y, m) =>
                                  m === j ? { ...y, end: e.target.value } : y,
                                ),
                              }
                            : x,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                </span>
              ))}
            <TextField
              aria-label={`Exception ${i + 1} note`}
              placeholder="note"
              value={ex.note ?? ''}
              disabled={!editable}
              onChange={(e) => {
                setExceptions((prev) =>
                  prev.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)),
                );
                setDirty(true);
              }}
            />
            {editable && (
              <Button
                size="sm"
                variant="icon"
                aria-label={`Remove exception ${i + 1}`}
                onClick={() => {
                  setExceptions((prev) => prev.filter((_, k) => k !== i));
                  setDirty(true);
                }}
              >
                <Icon name="trash" size="sm" />
              </Button>
            )}
          </div>
        ))}
        {editable && (
          <Button
            size="sm"
            onClick={() => {
              // First date from today that has no exception yet.
              const used = new Set(exceptions.map((x) => x.day));
              const d = new Date();
              while (used.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() + 1);
              const day = d.toISOString().slice(0, 10);
              setExceptions((prev) => [...prev, { day, off: true, intervals: [], note: '' }]);
              setDirty(true);
            }}
          >
            + Add exception
          </Button>
        )}
      </div>

      {editable && (
        <div className="org-wh__actions">
          <Button size="sm" onClick={() => void save(true)}>
            Reset to project default
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || hasProblem}
            onClick={() => void save(false)}
          >
            Save working hours
          </Button>
        </div>
      )}
    </div>
  );
}

/** CR04 §8: client-side helpers for weekly working hours (mirrors the server rules). */

export interface Interval {
  start: string;
  end: string;
}

export interface Day {
  weekday: number;
  intervals: Interval[];
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function intervalHours(iv: Interval): number {
  const s = toMinutes(iv.start);
  const e = toMinutes(iv.end);
  return s === null || e === null || e <= s ? 0 : (e - s) / 60;
}

export function dayHours(day: Day): number {
  return day.intervals.reduce((acc, iv) => acc + intervalHours(iv), 0);
}

export function weeklyHours(days: ReadonlyArray<Day>): number {
  return Math.round(days.reduce((acc, d) => acc + dayHours(d), 0) * 100) / 100;
}

/** Average hours over days that have any work (what the server stores as daily capacity). */
export function averageDailyHours(days: ReadonlyArray<Day>): number {
  const worked = days.filter((d) => dayHours(d) > 0);
  if (worked.length === 0) return 0;
  return Math.round((weeklyHours(worked) / worked.length) * 100) / 100;
}

/** First problem in a day's intervals, or null when valid. */
export function dayProblem(day: Day): string | null {
  const parsed = day.intervals.map((iv) => [toMinutes(iv.start), toMinutes(iv.end)] as const);
  for (const [s, e] of parsed) {
    if (s === null || e === null) return 'Use HH:MM times';
    if (e <= s) return 'Start must be before end';
  }
  const sorted = [...parsed].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i]![0] ?? 0) < (sorted[i - 1]![1] ?? 0)) return 'Intervals overlap';
  }
  return null;
}

export function summarizeWeek(days: ReadonlyArray<Day>): string {
  const parts = days
    .filter((d) => d.intervals.length > 0)
    .map(
      (d) =>
        `${WEEKDAYS[d.weekday - 1]} ${d.intervals.map((iv) => `${iv.start}–${iv.end}`).join(', ')}`,
    );
  return parts.length ? parts.join(' · ') : 'No working hours';
}

/** Always 7 entries (Mon..Sun), filling gaps with empty days. */
export function normalizeWeek(
  days: ReadonlyArray<{ weekday: number; intervals?: Interval[] }>,
): Day[] {
  return [1, 2, 3, 4, 5, 6, 7].map((wd) => ({
    weekday: wd,
    intervals: [...(days.find((d) => d.weekday === wd)?.intervals ?? [])],
  }));
}

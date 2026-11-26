import { describe, expect, it } from 'vitest';
import {
  averageDailyHours,
  dayProblem,
  normalizeWeek,
  summarizeWeek,
  toMinutes,
  weeklyHours,
} from './workHoursModel';

describe('workHoursModel', () => {
  const week = normalizeWeek([
    {
      weekday: 1,
      intervals: [
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ],
    },
    { weekday: 5, intervals: [{ start: '10:00', end: '14:00' }] },
  ]);

  it('normalizes to seven days', () => {
    expect(week).toHaveLength(7);
    expect(week[2]).toEqual({ weekday: 3, intervals: [] });
  });

  it('computes weekly and average daily hours', () => {
    expect(weeklyHours(week)).toBe(12);
    expect(averageDailyHours(week)).toBe(6);
    expect(averageDailyHours(normalizeWeek([]))).toBe(0);
  });

  it('parses times and finds problems', () => {
    expect(toMinutes('9:30')).toBe(570);
    expect(toMinutes('24:00')).toBe(1440);
    expect(toMinutes('24:30')).toBeNull();
    expect(dayProblem({ weekday: 1, intervals: [{ start: '10:00', end: '09:00' }] })).toBe(
      'Start must be before end',
    );
    expect(
      dayProblem({
        weekday: 1,
        intervals: [
          { start: '09:00', end: '12:00' },
          { start: '11:00', end: '13:00' },
        ],
      }),
    ).toBe('Intervals overlap');
    expect(dayProblem(week[0]!)).toBeNull();
  });

  it('summarizes', () => {
    expect(summarizeWeek(week)).toBe('Mon 09:00–13:00, 14:00–18:00 · Fri 10:00–14:00');
    expect(summarizeWeek(normalizeWeek([]))).toBe('No working hours');
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, calendarDays, onDay, shiftCalendar } from './calendar-model';
describe('project calendar local dates', () => {
  it('starts on Monday and includes the selected week and a complete month grid', () => {
    expect(calendarDays('2026-11-18', 'week')).toEqual([
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
    ]);
    const days = calendarDays('2026-11-18', 'month');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-10-26');
    expect(days[41]).toBe('2026-12-06');
  });
  it('crosses year, leap day and DST using local calendar days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(shiftCalendar('2026-12-31', 1, 'month')).toBe('2027-01-01');
    expect(shiftCalendar('2026-03-31', -1, 'month')).toBe('2026-02-01');
  });
  it('includes both boundary days for multi-day appointments', () => {
    const event = { start_date: '2026-12-31', end_date: '2027-01-02' };
    expect(onDay(event, '2026-12-30')).toBe(false);
    expect(onDay(event, '2026-12-31')).toBe(true);
    expect(onDay(event, '2027-01-01')).toBe(true);
    expect(onDay(event, '2027-01-02')).toBe(true);
    expect(onDay(event, '2027-01-03')).toBe(false);
  });
});

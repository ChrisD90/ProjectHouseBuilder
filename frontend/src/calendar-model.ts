// Local dates, never UTC timestamps: calendar days must survive DST boundaries.
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDay = (value: string) => new Date(value + 'T12:00:00');
export function addDays(value: string, delta: number) {
  const date = localDay(value);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}
export function calendarDays(anchor: string, view: string) {
  const date = localDay(anchor);
  if (view === 'month') date.setDate(1);
  const first = addDays(dayKey(date), -((date.getDay() + 6) % 7));
  return Array.from({ length: view === 'month' ? 42 : 7 }, (_, index) => addDays(first, index));
}
export function shiftCalendar(anchor: string, delta: number, view: string) {
  if (view === 'week') return addDays(anchor, delta * 7);
  const date = localDay(anchor);
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  return dayKey(date);
}
export const onDay = (event: { start_date: string; end_date: string }, day: string) =>
  event.start_date <= day && event.end_date >= day;

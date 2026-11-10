import { describe, expect, it } from 'vitest';
import { sortProjectDocuments } from './document-sorting';
const documents = [
  {
    id: 1,
    title: 'Plan 10',
    uploaded_at: '2026-11-01T12:00:00',
    size_bytes: 100,
    status: 'Aktuell',
  },
  {
    id: 2,
    title: 'Plan 2',
    uploaded_at: '2026-11-03T12:00:00',
    size_bytes: 30,
    status: 'Überholt',
  },
  { id: 3, title: 'Antrag', uploaded_at: '', size_bytes: 200, status: 'Aktuell' },
];
const ids = (order: string) => sortProjectDocuments(documents, order).map((row) => row.id);
describe('project document sorting', () => {
  it('uses upload dates with missing dates last in either direction', () => {
    expect(ids('newest')).toEqual([2, 1, 3]);
    expect(ids('oldest')).toEqual([1, 2, 3]);
  });
  it('sorts titles naturally and files by actual byte size', () => {
    expect(ids('az')).toEqual([3, 2, 1]);
    expect(ids('za')).toEqual([1, 2, 3]);
    expect(ids('size-desc')).toEqual([3, 1, 2]);
    expect(ids('size-asc')).toEqual([2, 1, 3]);
  });
  it('keeps source data unchanged', () => {
    const before = JSON.stringify(documents);
    ids('newest');
    expect(JSON.stringify(documents)).toBe(before);
  });
});

import type { Row } from './core';
import { compareDate, compareText } from './list-sorting';
export function sortProjectDocuments(documents: Row[], order: string): Row[] {
  return [...documents].sort((a, b) => {
    const title = compareText(a.title, b.title);
    if (order === 'az') return title || a.id - b.id;
    if (order === 'za') return -title || a.id - b.id;
    if (order === 'size-desc')
      return Number(b.size_bytes || 0) - Number(a.size_bytes || 0) || title || a.id - b.id;
    if (order === 'size-asc')
      return Number(a.size_bytes || 0) - Number(b.size_bytes || 0) || title || a.id - b.id;
    return (
      compareDate(a.uploaded_at, b.uploaded_at, order !== 'oldest') ||
      (order === 'oldest' ? a.id - b.id : b.id - a.id)
    );
  });
}

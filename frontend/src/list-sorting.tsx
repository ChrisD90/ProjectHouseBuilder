import { Select } from '@mantine/core';
import { IconArrowsSort } from '@tabler/icons-react';

export const basicSortOptions = [
  { value: 'az', label: 'A–Z' },
  { value: 'za', label: 'Z–A' },
  { value: 'newest', label: 'Neueste zuerst' },
  { value: 'oldest', label: 'Älteste zuerst' },
];
export const compareText = (a: unknown, b: unknown) =>
  String(a || '').localeCompare(String(b || ''), 'de', { numeric: true, sensitivity: 'base' });

// Missing dates always stay at the end, in either direction.
export function compareDate(a: unknown, b: unknown, descending = false) {
  const first = Date.parse(String(a || '')),
    second = Date.parse(String(b || ''));
  if (!Number.isFinite(first)) return Number.isFinite(second) ? 1 : 0;
  if (!Number.isFinite(second)) return -1;
  return (first - second) * (descending ? -1 : 1);
}
export function SortSelect({
  value,
  onChange,
  extra = [],
  defaultLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  extra?: { value: string; label: string }[];
  defaultLabel?: string;
}) {
  return (
    <Select
      aria-label="Sortierung"
      data-control-kind="sort"
      title="Sortierung"
      leftSection={<IconArrowsSort size={17} aria-hidden="true" />}
      leftSectionPointerEvents="none"
      value={value}
      onChange={(v) => onChange(v || (defaultLabel ? 'default' : 'newest'))}
      allowDeselect={false}
      w={210}
      maw="100%"
      data={[
        ...(defaultLabel ? [{ value: 'default', label: defaultLabel }] : []),
        ...basicSortOptions,
        ...extra,
      ]}
    />
  );
}

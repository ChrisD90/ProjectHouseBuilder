import { Accordion, Anchor, Badge, Group, Pagination, Stack, Text } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { useState } from 'react';
import { api, ErrorBox, type Row } from './core';
import { useQuery } from '@tanstack/react-query';
import { displayDate } from './presentation';
import { FilterSelect, SearchField } from './ui';
import './glossary.css';

export function glossaryEntries(data: Row): Row[] {
  return [
    ...(data.glossary || []),
    ...(data.records || [])
      .filter((row: Row) => row.kind === 'glossary' && row.status !== 'Archiviert')
      .map((row: Row) => ({
        ...row,
        id: 'own-' + row.id,
        personal: true,
        category: row.data?.category || 'own',
        sources: row.data?.source_url
          ? [{ url: row.data.source_url, title: 'Eigene Quelle öffnen' }]
          : [],
      })),
  ];
}

export function glossarySourceURL(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password)
      return url.href;
  } catch {
    /* A legacy note can have no source. */
  }
  return undefined;
}

export function GlossarySources({ sources }: { sources: Row[] }) {
  return (
    <Stack gap={4} mt="sm">
      {sources.map((source, index) => {
        const url = glossarySourceURL(source.url);
        if (!url) return null;
        return (
          <div key={url + index}>
            <Anchor
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              className="glossary-source"
            >
              <IconExternalLink size={14} aria-hidden="true" />
              <span>
                {source.publisher ? source.publisher + ' · ' : ''}
                {source.title || 'Quelle öffnen'}
              </span>
            </Anchor>
            {source.checked_on && (
              <Text size="10px" c="dimmed">
                Geprüft am {displayDate(source.checked_on)}
              </Text>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

export function GlossaryBrowser({
  entries,
  categories,
  search,
  onSearchChange,
  compact = false,
}: {
  entries: Row[];
  categories: Row[];
  search: string;
  onSearchChange: (value: string) => void;
  compact?: boolean;
}) {
  const catalog = useQuery({
    queryKey: ['glossary-catalog'],
    queryFn: () => api('/api/glossary'),
    staleTime: Infinity,
  });
  entries = [...(catalog.data?.entries || []), ...entries];
  categories = catalog.data?.categories || categories;
  const [category, setCategory] = useState<string | null>(null),
    [page, setPage] = useState(1);
  const needle = search.trim().toLocaleLowerCase('de-DE');
  const categoryLabel = (value: string) =>
    categories.find((row) => row.id === value)?.label || 'Eigene Wissensnotiz';
  const rows = entries
    .filter(
      (row) =>
        (!category || row.category === category) &&
        [row.title, row.body, ...(row.aliases || []), categoryLabel(row.category)]
          .join(' ')
          .toLocaleLowerCase('de-DE')
          .includes(needle),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  const perPage = compact ? 10 : 24,
    pages = Math.max(1, Math.ceil(rows.length / perPage)),
    currentPage = Math.min(page, pages);
  const visible = rows.slice((currentPage - 1) * perPage, currentPage * perPage);
  return (
    <Stack gap="sm" className="glossary-browser">
      <ErrorBox value={catalog.error} />
      <Group className="glossary-toolbar" wrap="nowrap" gap="sm">
        <SearchField
          placeholder="Begriff, Werkzeug oder Synonym suchen"
          aria-label="Glossar durchsuchen"
          maxLength={200}
          value={search}
          onChange={(e) => {
            onSearchChange(e.currentTarget.value);
            setPage(1);
          }}
        />
        <FilterSelect
          aria-label="Glossarkategorie"
          placeholder="Alle Kategorien"
          searchable
          clearable
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
          data={[
            ...categories.map((row) => ({ value: row.id, label: row.label })),
            ...(entries.some((row) => row.category === 'own')
              ? [{ value: 'own', label: 'Eigene Wissensnotizen' }]
              : []),
          ]}
        />
      </Group>
      <Text size="xs" c="dimmed" role="status">
        {rows.length} von {entries.length} Begriffen · A–Z
      </Text>
      <Accordion multiple variant="separated" className="glossary-entries">
        {visible.map((row) => (
          <Accordion.Item value={String(row.id)} key={row.id}>
            <Accordion.Control>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text size="sm" fw={600}>
                  {row.title}
                </Text>
                <Badge variant="light" size="xs" className="glossary-category">
                  {categoryLabel(row.category)}
                </Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {row.body}
              </Text>
              {!!row.aliases?.length && (
                <Text size="xs" c="dimmed" mt={6}>
                  Auch bekannt als: {row.aliases.join(' · ')}
                </Text>
              )}
              <GlossarySources sources={row.sources || []} />
              {row.personal && !row.sources?.length && (
                <Text size="xs" c="dimmed" mt={6}>
                  Eigene Notiz · keine Fachquelle hinterlegt.
                </Text>
              )}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      {!rows.length && (
        <Text size="sm" c="dimmed">
          Keine passenden Begriffe. Ändere die Suche oder die Kategorie.
        </Text>
      )}
      {pages > 1 && (
        <Group justify="center">
          <Pagination
            size="sm"
            total={pages}
            value={currentPage}
            onChange={setPage}
            getItemProps={(page) => ({ 'aria-label': 'Glossarseite ' + page })}
          />
        </Group>
      )}
    </Stack>
  );
}

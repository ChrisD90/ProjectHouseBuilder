import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Editor, ErrorBox, Row, api, money } from './core';
import { Metrics, PageHeader } from './page-layout';
import { RowAction, SearchField, useViewState } from './ui';
import { LegacyCosts } from './legacy-costs';
export function Costs() {
  const query = useQuery({
      queryKey: ['cost-dashboard'],
      queryFn: () => api('/api/cost-dashboard'),
      staleTime: 0,
    }),
    navigate = useNavigate();
  const [search, setSearch] = useViewState('search', ''),
    [group, setGroup] = useState<string | null>('category'),
    [detail, setDetail] = useState<Row | null>(null);
  const [legacy, setLegacy] = useState<Row | null>(null);
  const data = query.data || {},
    rows: Row[] = data.dashboard?.rows || [],
    summary = data.summary || {};
  const filtered = rows.filter((r) =>
    [r.title, r.category, r.trade, r.kind, r.phase, r.task, r.company, r.basis].some((v) =>
      String(v || '')
        .toLocaleLowerCase('de')
        .includes(search.toLocaleLowerCase('de')),
    ),
  );
  const groups = new Map<string, Row>();
  for (const r of filtered) {
    const name =
      (group === 'category' ? r.trade || r.category : r[group || 'category']) || 'Nicht zugeordnet';
    if (!groups.has(name))
      groups.set(name, {
        name,
        rows: [],
        forecast: 0,
        committed: 0,
        invoiced: 0,
        paid: 0,
        open: 0,
      });
    const g = groups.get(name)!;
    g.rows.push(r);
    for (const key of ['forecast', 'committed', 'invoiced', 'paid', 'open'])
      g[key] += Number(r[key]) || 0;
  }
  const grouped = [...groups.values()].sort((a, b) => b.forecast - a.forecast);
  const issues = (data.dashboard?.issues || []).filter(
    (issue: Row) => !['unassigned', 'schedule'].includes(issue.kind),
  );
  const gap = Number(summary.budget || 0) - Number(summary.planned || 0);
  return (
    <div className="page">
      <PageHeader
        title="Kosten & Budget"
        description="Angebote, Rechnungen und Zahlungen – zusammengeführt zum aktuellen Kostenstand."
      />
      <Group justify="flex-end" mb="sm">
        <Button variant="subtle" size="xs" onClick={() => setLegacy({})}>
          Alte Planpositionen bereinigen
        </Button>
      </Group>
      {legacy && (
        <LegacyCosts
          selected={legacy}
          onClose={() => {
            setLegacy(null);
            setDetail(null);
          }}
        />
      )}
      {query.isPending ? <Loader /> : <ErrorBox value={query.error} />}
      <Metrics
        loading={query.isPending}
        values={[
          ['Finanzierungsrahmen', money(summary.budget)],
          ['Prognose', money(summary.planned)],
          ['Bezahlt', money(summary.paid)],
          [gap < 0 ? 'Finanzierungslücke' : 'Puffer', money(Math.abs(gap))],
        ]}
      />
      <Paper className="paper" mb="lg">
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          {['forecast', 'committed', 'invoiced', 'paid'].map((key, i) => (
            <div key={key}>
              <Text size="xs" c="dimmed">
                {['Prognose', 'Beauftragt', 'Abgerechnet', 'Bezahlt'][i]}
              </Text>
              <Text fw={650} mb="sm">
                {money(data.dashboard?.totals?.[key])}
              </Text>
              <Progress
                size={5}
                value={Math.min(
                  100,
                  (Number(data.dashboard?.totals?.[key] || 0) /
                    Math.max(1, Number(data.dashboard?.totals?.forecast || 0))) *
                    100,
                )}
              />
            </div>
          ))}
        </SimpleGrid>
      </Paper>
      {!!issues.length && (
        <Stack mb="lg" gap="xs">
          {issues.map((issue: Row) => (
            <Alert color="yellow" key={issue.title} title={issue.title}>
              <Group justify="space-between">
                <Text size="sm">
                  {issue.text} ({issue.count})
                </Text>
                <Button size="xs" variant="light" onClick={() => navigate(issue.url)}>
                  Prüfen
                </Button>
              </Group>
            </Alert>
          ))}
        </Stack>
      )}
      <Paper className="paper">
        <Group justify="space-between" mb="lg">
          <Title order={3} size="h5">
            Kostenübersicht
          </Title>
          <Group>
            <SearchField
              aria-label="Kosten suchen"
              placeholder="Kosten suchen"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label="Kosten gruppieren"
              value={group}
              onChange={setGroup}
              data={[
                { value: 'category', label: 'Gewerk / Kategorie' },
                { value: 'kind', label: 'Ausführungsart' },
                { value: 'phase', label: 'Bauphase' },
                { value: 'task', label: 'Arbeitspaket' },
                { value: 'company', label: 'Firma' },
              ]}
            />
          </Group>
        </Group>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Gruppe</Table.Th>
                {['Prognose', 'Beauftragt', 'Abgerechnet', 'Bezahlt', 'Offen'].map((k) => (
                  <Table.Th key={k} ta="right">
                    {k}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {grouped.map((g) => (
                <Table.Tr key={g.name} className="table-button" onClick={() => setDetail(g)}>
                  <Table.Td>
                    <RowAction onActivate={() => setDetail(g)}>
                      <Text fw={600} size="sm">
                        {g.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {g.rows.length} Positionen
                      </Text>
                    </RowAction>
                  </Table.Td>
                  {['forecast', 'committed', 'invoiced', 'paid', 'open'].map((k) => (
                    <Table.Td key={k} ta="right">
                      {money(g[k])}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!grouped.length && (
          <Text size="sm" c="dimmed" mt="md">
            Keine passenden Kostenpositionen vorhanden.
          </Text>
        )}
      </Paper>
      <Editor
        opened={!!detail}
        title={detail?.name || 'Kostenpositionen'}
        onClose={() => setDetail(null)}
      >
        <Stack>
          {detail?.rows.map((r: Row, i: number) => (
            <Paper key={i} withBorder p="md">
              <Group justify="space-between">
                <div>
                  <Text size="sm" fw={600}>
                    {r.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {[r.source, r.company, r.basis].filter(Boolean).join(' · ')}
                  </Text>
                </div>
                <Button
                  variant="subtle"
                  size="xs"
                  rightSection={<IconArrowRight size={15} />}
                  onClick={() => {
                    if (r.legacy) {
                      setDetail(null);
                      setLegacy(r.legacy);
                      return;
                    }
                    setDetail(null);
                    navigate(r.url);
                  }}
                >
                  Öffnen
                </Button>
              </Group>
              <Group mt="sm">
                <Text size="xs">Prognose {money(r.forecast)}</Text>
                <Text size="xs">Abgerechnet {money(r.invoiced)}</Text>
                <Text size="xs">Bezahlt {money(r.paid)}</Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Editor>
    </div>
  );
}

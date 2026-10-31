import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
  NumberInput,
  Accordion,
  FileInput,
} from '@mantine/core';
import {
  IconPlus,
  IconPencil,
  IconTrash,
  IconSearch,
  IconRestore,
  IconArrowRight,
} from '@tabler/icons-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, Row, Editor, ErrorBox, error, money, success, useConfirm } from './core';
import { useDirtyGuard } from './shell';
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Group className="page-header" justify="space-between" align="start">
      <div>
        <Title order={1}>{title}</Title>
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      </div>
      {children}
    </Group>
  );
}
export function Metrics({
  values,
  loading = false,
}: {
  values: [string, string][];
  loading?: boolean;
}) {
  return (
    <SimpleGrid cols={{ base: 2, md: values.length }} spacing="sm" mb="lg">
      {values.map(([label, value]) => (
        <div className="metric" key={label}>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <strong>{loading ? '—' : value}</strong>
        </div>
      ))}
    </SimpleGrid>
  );
}
const companyFields = [
  ['name', 'Firmenname'],
  ['contact', 'Ansprechpartner'],
  ['contact_secondary', 'Weiterer Ansprechpartner'],
  ['phone', 'Telefon'],
  ['mobile', 'Mobiltelefon'],
  ['phone_other', 'Weitere Telefonnummer'],
  ['email', 'E-Mail'],
  ['website', 'Website'],
  ['address', 'Adresse'],
] as const;
const emptyCompany = Object.fromEntries([
  ...companyFields.map(([key]) => [key, '']),
  ['trade', ''],
  ['notes', ''],
]);
export function MasterData() {
  const { hash } = useLocation();
  const cache = useQueryClient(),
    ask = useConfirm(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const query = useQuery({
    queryKey: ['master'],
    staleTime: 0,
    queryFn: async () => {
      const [cost, tr, cat] = await Promise.all([
        api('/api/costs'),
        api('/api/trades'),
        api('/api/categories'),
      ]);
      return {
        companies: cost.contractors,
        trades: tr.trades,
        categories: cat.categories,
      };
    },
  });
  const [search, setSearch] = useState(''),
    [tab, setTab] = useState<string | null>('companies'),
    [record, setRecord] = useState<Row | null>(null),
    [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [reference, setReference] = useState<{
      kind: string;
      id?: number;
      name: string;
      original?: string;
    } | null>(null);
  const [research, setResearch] = useState(false),
    [researchName, setResearchName] = useState(''),
    [place, setPlace] = useState(''),
    [results, setResults] = useState<Row[]>([]);
  useEffect(() => {
    if (hash === '#gewerke') setTab('trades');
    else if (hash === '#kategorien') setTab('categories');
    else if (hash === '#firmen') setTab('companies');
  }, [hash]);
  const form = useForm<Row>({
    initialValues: emptyCompany,
    validate: {
      name: (v) => (!String(v || '').trim() ? 'Firmenname fehlt.' : null),
    },
  });
  useDirtyGuard(
    (opened && form.isDirty()) || (!!reference && reference.name !== (reference.original || '')),
  );
  function open(company: Row | null = null) {
    setRecord(company);
    setFailure(null);
    setResearch(false);
    setResearchName('');
    setResults([]);
    setPlace('');
    form.setValues({ ...emptyCompany, ...company });
    form.resetDirty({ ...emptyCompany, ...company });
    setOpened(true);
  }
  useEffect(() => {
    if (query.data && params.get('new_company') === '1') open();
  }, [!!query.data]);
  async function save() {
    if (busy) return;
    if (form.validate().hasErrors) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/contractors' + (record ? '/' + record.id : ''),
        record ? 'PUT' : 'POST',
        form.values,
      );
      await cache.invalidateQueries({ queryKey: ['master'] });
      setOpened(false);
      success('Firma gespeichert.');
      const receipt = params.get('receipt_id');
      if (receipt) setTimeout(() => navigate('/belege?receipt_id=' + receipt), 0);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    if (
      !record ||
      !(await ask('Firma endgültig löschen? Verknüpfte Firmen können nicht gelöscht werden.'))
    )
      return;
    setBusy(true);
    try {
      await api('/api/contractors/' + record.id, 'DELETE');
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['master'] });
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function referenceSave() {
    if (busy) return;
    if (!reference) return;
    setBusy(true);
    try {
      await api(
        '/api/' + reference.kind + (reference.id ? '/' + reference.id : ''),
        reference.id ? 'PATCH' : 'POST',
        { name: reference.name },
      );
      setReference(null);
      await cache.invalidateQueries({ queryKey: ['master'] });
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function restore(kind: string) {
    if (
      !(await ask('Standardliste wiederherstellen? Verwendete eigene Einträge bleiben erhalten.'))
    )
      return;
    try {
      const result = await api('/api/' + kind + '/restore-defaults', 'POST', {
        confirm: true,
      });
      await cache.invalidateQueries({ queryKey: ['master'] });
      success(result.message);
    } catch (e) {
      error(e);
    }
  }
  async function researchCompany() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const selection = (window as any).PHBReactBridge.ai.selection();
      const data = await api(
        '/api/contractors/research',
        'POST',
        {
          query: [form.values.name, place].filter(Boolean).join(' '),
          consent: true,
          ...selection,
        },
        true,
      );
      setResults(data.results);
      if (!data.results.length)
        setFailure(new Error('Keine belegten Treffer gefunden. Namen oder Ort präzisieren.'));
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  const data: Row = query.data || { companies: [], trades: [], categories: [] };
  const filtered = (data.companies as Row[]).filter((c) =>
    Object.values(c).some((v) =>
      String(v || '')
        .toLocaleLowerCase('de')
        .includes(search.toLocaleLowerCase('de')),
    ),
  );
  return (
    <div className="page">
      <PageHeader
        title="Stammdaten"
        description="Firmen, Gewerke und Kostenkategorien zentral verwalten."
      />
      <Paper className="paper">
        <Tabs value={tab} onChange={setTab}>
          <Group justify="space-between" mb="lg">
            <Tabs.List>
              <Tabs.Tab value="companies">Firmen</Tabs.Tab>
              <Tabs.Tab value="trades">Gewerke</Tabs.Tab>
              <Tabs.Tab value="categories">Kategorien</Tabs.Tab>
            </Tabs.List>
            <Group gap="xs">
              {tab !== 'companies' && (
                <Tooltip label="Standardliste wiederherstellen">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    aria-label="Standardliste wiederherstellen"
                    onClick={() => restore(tab!)}
                  >
                    <IconRestore size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label={tab === 'companies' ? 'Firma anlegen' : 'Eintrag hinzufügen'}>
                <ActionIcon
                  size="lg"
                  aria-label={tab === 'companies' ? 'Firma anlegen' : 'Eintrag hinzufügen'}
                  onClick={() =>
                    tab === 'companies' ? open() : setReference({ kind: tab!, name: '' })
                  }
                >
                  <IconPlus size={19} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>
          <TextInput
            leftSection={<IconSearch size={17} />}
            placeholder="Stammdaten durchsuchen"
            aria-label="Stammdaten durchsuchen"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            mb="lg"
          />
          {query.isPending ? <Loader size="sm" /> : <ErrorBox value={query.error} />}
          <Tabs.Panel value="companies">
            <Text size="xs" c="dimmed" mb="sm">
              {filtered.length} von {data.companies.length} Firmen
            </Text>
            <Table.ScrollContainer minWidth={650}>
              <Table verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Firma</Table.Th>
                    <Table.Th>Gewerk</Table.Th>
                    <Table.Th>Kontakt</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.map((c) => (
                    <Table.Tr key={c.id} className="table-button" onClick={() => open(c)}>
                      <Table.Td>
                        <Text fw={600} size="sm">
                          {c.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {c.address}
                        </Text>
                      </Table.Td>
                      <Table.Td>{c.trade || '–'}</Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {[c.contact, c.contact_secondary].filter(Boolean).join(' · ') || '–'}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {[c.phone, c.mobile, c.email].filter(Boolean).join(' · ')}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label="Firma bearbeiten">
                          <ActionIcon variant="subtle" aria-label="Firma bearbeiten">
                            <IconPencil size={17} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {!filtered.length && !query.isPending && (
              <Text c="dimmed" size="sm">
                Keine passenden Firmen.
              </Text>
            )}
          </Tabs.Panel>
          {['trades', 'categories'].map((kind) => (
            <Tabs.Panel value={kind} key={kind}>
              <Stack gap="xs">
                {(data[kind] as Row[])
                  .filter((r) =>
                    r.name.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')),
                  )
                  .map((r) => (
                    <Group key={r.id} justify="space-between" py="xs">
                      <Text size="sm">{r.name}</Text>
                      <Group gap="xs">
                        <Tooltip label="Umbenennen">
                          <ActionIcon
                            variant="default"
                            aria-label="Umbenennen"
                            onClick={() =>
                              setReference({
                                kind,
                                id: r.id,
                                name: r.name,
                                original: r.name,
                              })
                            }
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Löschen">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label="Löschen"
                            disabled={kind === 'categories' && r.name === 'Sonstiges'}
                            onClick={async () => {
                              if (await ask('„' + r.name + '“ löschen?'))
                                try {
                                  await api('/api/' + kind + '/' + r.id, 'DELETE');
                                  await cache.invalidateQueries({
                                    queryKey: ['master'],
                                  });
                                } catch (e) {
                                  error(e);
                                }
                            }}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  ))}
              </Stack>
            </Tabs.Panel>
          ))}
        </Tabs>
      </Paper>
      <Editor
        opened={opened}
        title={record ? 'Firma bearbeiten' : 'Neue Firma'}
        dirty={form.isDirty()}
        busy={busy}
        onClose={() => setOpened(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {companyFields.map(([name, label]) => (
                <TextInput
                  key={name}
                  label={label}
                  required={name === 'name'}
                  maxLength={
                    name === 'address'
                      ? 400
                      : name === 'website'
                        ? 240
                        : ['phone', 'mobile', 'phone_other'].includes(name)
                          ? 100
                          : 200
                  }
                  {...form.getInputProps(name)}
                  onBlur={
                    name === 'name'
                      ? () => {
                          const value = form.values.name?.trim();
                          if (
                            !record &&
                            value &&
                            value !== researchName &&
                            (window as any).PHBReactBridge?.ai.connected()
                          ) {
                            setResearch(true);
                            setResearchName(value);
                          }
                        }
                      : undefined
                  }
                />
              ))}
              <Select
                label="Gewerk"
                clearable
                searchable
                data={(data.trades as Row[]).map((t) => t.name)}
                {...form.getInputProps('trade')}
              />
            </SimpleGrid>
            <Textarea
              label="Notizen"
              maxLength={3000}
              autosize
              minRows={3}
              {...form.getInputProps('notes')}
            />
            {research && (
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Text size="sm" fw={600}>
                    Firmendaten mit ChatGPT vervollständigen?
                  </Text>
                  <Text size="xs" c="dimmed">
                    Firmenname und optionaler Ort werden erst nach deiner Zustimmung zur Recherche
                    übertragen.
                  </Text>
                  <TextInput
                    label="Ort / Postleitzahl (optional)"
                    value={place}
                    onChange={(e) => setPlace(e.target.value)}
                  />
                  <Group>
                    <Button variant="light" size="xs" loading={busy} onClick={researchCompany}>
                      Mit ChatGPT recherchieren
                    </Button>
                    <Button variant="subtle" size="xs" onClick={() => setResearch(false)}>
                      Manuell fortfahren
                    </Button>
                  </Group>
                  {results.map((r, i) => (
                    <Paper withBorder p="sm" key={i}>
                      <Text size="sm" fw={600}>
                        {r.name}
                      </Text>
                      <Text size="xs">{r.snippet}</Text>
                      <Text size="xs" c="dimmed">
                        {[r.address, r.phone, r.email].filter(Boolean).join(' · ')}
                      </Text>
                      <Group mt="sm">
                        <Anchor size="xs" href={r.source_url} target="_blank" rel="noreferrer">
                          Quelle prüfen
                        </Anchor>
                        <Button
                          size="xs"
                          onClick={() => {
                            const changes: Row = {};
                            for (const key of [
                              'name',
                              'website',
                              'phone',
                              'email',
                              'address',
                              'contact',
                            ])
                              if (
                                r[key] &&
                                (!form.values[key] ||
                                  (key === 'name' && form.values[key] === researchName))
                              )
                                changes[key] = r[key];
                            form.setValues(changes);
                            setResearch(false);
                          }}
                        >
                          Treffer übernehmen
                        </Button>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Paper>
            )}
            <ErrorBox value={failure} />
            <div className="actions">
              {record && (
                <Button variant="subtle" color="red" mr="auto" disabled={busy} onClick={remove}>
                  Löschen
                </Button>
              )}
              <Button
                variant="default"
                disabled={busy}
                onClick={async () => {
                  if (!form.isDirty() || (await ask('Ungespeicherte Änderungen verwerfen?')))
                    setOpened(false);
                }}
              >
                Abbrechen
              </Button>
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={!!reference}
        title={reference?.id ? 'Eintrag umbenennen' : 'Eintrag hinzufügen'}
        dirty={!!reference && reference.name !== (reference.original || '')}
        busy={busy}
        onClose={() => setReference(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            referenceSave();
          }}
        >
          <TextInput
            label="Name"
            required
            maxLength={reference?.kind === 'trades' ? 140 : 120}
            value={reference?.name || ''}
            onChange={(e) => setReference((r) => (r ? { ...r, name: e.target.value } : null))}
          />
          <div className="actions">
            <Button type="submit" loading={busy}>
              Speichern
            </Button>
          </div>
        </form>
      </Editor>
    </div>
  );
}

export function Costs() {
  const query = useQuery({
      queryKey: ['cost-dashboard'],
      queryFn: () => api('/api/cost-dashboard'),
      staleTime: 0,
    }),
    navigate = useNavigate();
  const [search, setSearch] = useState(''),
    [group, setGroup] = useState<string | null>('category'),
    [detail, setDetail] = useState<Row | null>(null);
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
  const gap = Number(summary.budget || 0) - Number(summary.planned || 0);
  return (
    <div className="page">
      <PageHeader
        title="Kosten & Budget"
        description="Angebote, Rechnungen und Zahlungen – zusammengeführt zum aktuellen Kostenstand."
      />
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
      {!!data.dashboard?.issues?.length && (
        <Stack mb="lg" gap="xs">
          {data.dashboard.issues.map((issue: Row) => (
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
            <TextInput
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
                    <Text fw={600} size="sm">
                      {g.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {g.rows.length} Positionen
                    </Text>
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
const emptyFunding: Row = {
  name: '',
  provider: '',
  program: '',
  status: 'In Prüfung',
  expected: 0,
  confirmed: 0,
  received: 0,
  deadline: '',
  applied_on: '',
  reference: '',
  offer_id: null,
  budget_line_id: null,
  source_url: '',
  notes: '',
};
export function Energy() {
  const query = useQuery({
      queryKey: ['energy'],
      staleTime: 0,
      queryFn: () => api('/api/energy-planning'),
    }),
    cache = useQueryClient(),
    ask = useConfirm(),
    [params] = useSearchParams();
  const [search, setSearch] = useState(''),
    [opened, setOpened] = useState(false),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const form = useForm<Row>({ initialValues: emptyFunding });
  useDirtyGuard(opened && form.isDirty());
  const data: Row = query.data || {};
  function open(row: Row | null = null, offer?: number) {
    setID(row?.id || null);
    const values = { ...emptyFunding, ...row };
    if (offer && !row) {
      const found = data.offers?.find((o: Row) => o.id === offer);
      values.offer_id = String(offer);
      values.name = found ? 'Förderprüfung: ' + found.category : '';
    }
    for (const key of ['offer_id', 'budget_line_id'])
      values[key] = values[key] ? String(values[key]) : null;
    form.setValues(values);
    form.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  useEffect(() => {
    const offer = Number(params.get('offer_id'));
    if (query.data && offer) open(null, offer);
  }, [!!query.data]);
  async function save(remove = false) {
    if (busy) return;
    if (remove && !(await ask('Diese Förderung endgültig löschen?'))) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/funding' + (id ? '/' + id : ''),
        remove ? 'DELETE' : id ? 'PUT' : 'POST',
        remove ? undefined : form.values,
      );
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['energy'] });
      success(remove ? 'Förderung gelöscht.' : 'Förderung gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  const rows: Row[] = (data.funding || []).filter((r: Row) =>
    [r.name, r.program, r.provider, r.status].some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  return (
    <div className="page">
      <PageHeader
        title="Energetische Planung"
        description="Förderungen planen, Fristen festhalten und Angeboten zuordnen."
      >
        <Button leftSection={<IconPlus size={17} />} onClick={() => open()}>
          Förderung erfassen
        </Button>
      </PageHeader>
      <ErrorBox value={query.error} />
      {query.isPending && <Loader />}
      <Metrics
        loading={query.isPending}
        values={[
          ['Erwartet', money(data.summary?.funding_expected)],
          ['Bewilligt', money(data.summary?.funding_confirmed)],
          ['Erhalten', money(data.received)],
          ['Prognose nach Förderung', money(data.summary?.net_after_confirmed)],
        ]}
      />
      <Text size="xs" c="dimmed" mb="lg">
        Erwartete Förderungen werden nicht von den Bruttokosten abgezogen. Bewilligungen und
        Auszahlungen erzeugen keine automatischen Finanzierungsbuchungen.
      </Text>
      <Paper className="paper">
        <Group justify="space-between" mb="lg">
          <Title order={3} size="h5">
            Förderplanung
          </Title>
          <TextInput
            aria-label="Förderungen suchen"
            placeholder="Förderungen suchen"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Group>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                {['Maßnahme / Programm', 'Status / Frist', 'Erwartet', 'Bewilligt', 'Erhalten'].map(
                  (k) => (
                    <Table.Th key={k}>{k}</Table.Th>
                  ),
                )}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id} className="table-button" onClick={() => open(r)}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {r.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[r.provider, r.program].filter(Boolean).join(' · ')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{r.status}</Badge>
                    <Text size="xs" c="dimmed">
                      {r.deadline || 'Keine Frist erfasst'}
                    </Text>
                  </Table.Td>
                  {['expected', 'confirmed', 'received'].map((key) => (
                    <Table.Td key={key}>{money(r[key])}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!rows.length && (
          <Text size="sm" c="dimmed">
            Keine passenden Förderungen.
          </Text>
        )}
      </Paper>
      <Paper className="paper" mt="lg">
        <Title order={3} size="h5" mb="sm">
          Fördercheck vorbereiten
        </Title>
        <Text size="sm" c="dimmed">
          Vor Auftrag und Maßnahmenbeginn Programmbedingungen, Antragstermin und technische
          Nachweise prüfen. Eine Kategorie allein belegt keine Förderfähigkeit.
        </Text>
        <Group mt="md">
          {(data.sources || []).map((s: Row) => (
            <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" size="sm">
              {s.name} ↗
            </Anchor>
          ))}
        </Group>
      </Paper>
      <Editor
        opened={opened}
        title={id ? 'Förderung bearbeiten' : 'Förderung erfassen'}
        dirty={form.isDirty()}
        busy={busy}
        onClose={() => setOpened(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Maßnahme"
                required
                maxLength={200}
                {...form.getInputProps('name')}
              />
              <TextInput label="Fördergeber" maxLength={200} {...form.getInputProps('provider')} />
              <TextInput
                label="Programm / Nummer"
                maxLength={200}
                {...form.getInputProps('program')}
              />
              <Select label="Status" data={data.statuses || []} {...form.getInputProps('status')} />
              {[
                ['expected', 'Erwartet'],
                ['confirmed', 'Bewilligt'],
                ['received', 'Ausgezahlt'],
              ].map(([key, label]) => (
                <NumberInput
                  key={key}
                  label={label + ' (€)'}
                  decimalScale={2}
                  decimalSeparator=","
                  thousandSeparator="."
                  min={0}
                  required
                  {...form.getInputProps(key)}
                />
              ))}
              <TextInput type="date" label="Antragsfrist" {...form.getInputProps('deadline')} />
              <TextInput
                type="date"
                label="Antrag gestellt am"
                {...form.getInputProps('applied_on')}
              />
              <TextInput
                label="Aktenzeichen"
                maxLength={160}
                {...form.getInputProps('reference')}
              />
              <Select
                label="Angebot"
                clearable
                searchable
                data={(data.offers || []).map((o: Row) => ({
                  value: String(o.id),
                  label: o.vendor + ' · ' + o.category + ' · ' + o.status,
                }))}
                {...form.getInputProps('offer_id')}
              />
              <Select
                label="Planposition"
                clearable
                searchable
                data={(data.budget_lines || []).map((b: Row) => ({
                  value: String(b.id),
                  label: b.category + ' · ' + b.title,
                }))}
                {...form.getInputProps('budget_line_id')}
              />
            </SimpleGrid>
            <TextInput
              label="Programmquelle"
              type="url"
              maxLength={1000}
              {...form.getInputProps('source_url')}
            />
            <Textarea
              label="Notizen / Voraussetzungen"
              minRows={3}
              maxLength={3000}
              {...form.getInputProps('notes')}
            />
            <ErrorBox value={failure} />
            <div className="actions">
              {id && (
                <Button
                  color="red"
                  variant="subtle"
                  mr="auto"
                  onClick={() => save(true)}
                  disabled={busy}
                >
                  Löschen
                </Button>
              )}
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
    </div>
  );
}

const emptyDocument: Row = {
  title: '',
  category: 'Bauplan',
  area: 'Allgemein',
  status: 'Aktuell',
  tags: '',
  description: '',
};
export function Documents() {
  const query = useQuery({
    queryKey: ['documents'],
    staleTime: 0,
    queryFn: async () => {
      const [docs, library] = await Promise.all([
        api('/api/project-documents'),
        api('/api/document-library'),
      ]);
      return { ...docs, library: library.documents || library.entries || [] };
    },
  });
  const cache = useQueryClient(),
    navigate = useNavigate(),
    ask = useConfirm(),
    [params] = useSearchParams();
  const [search, setSearch] = useState(''),
    [area, setArea] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [tab, setTab] = useState<string | null>('project'),
    [source, setSource] = useState<string | null>(null),
    [opened, setOpened] = useState(false),
    [upload, setUpload] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [mode, setMode] = useState<string | null>('foreground'),
    [record, setRecord] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const edit = useForm<Row>({ initialValues: emptyDocument }),
    metadata = useForm<Row>({ initialValues: emptyDocument });
  const data: Row = query.data || {};
  useDirtyGuard((opened && edit.isDirty()) || (upload && (files.length > 0 || metadata.isDirty())));
  function open(row: Row) {
    setRecord(row);
    const values = { ...emptyDocument, ...row };
    edit.setValues(values);
    edit.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  useEffect(() => {
    const id = Number(params.get('document_id'));
    const row = data.documents?.find((d: Row) => d.id === id);
    if (row && record?.id !== id) open(row);
  }, [data.documents, params.get('document_id')]);
  const documents: Row[] = (data.documents || []).filter(
    (d: Row) =>
      (!area || d.area === area) &&
      (!status || d.status === status) &&
      [d.title, d.filename, d.category, d.tags, d.description].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  const library: Row[] = (data.library || []).filter(
    (d: Row) =>
      d.source !== 'Projektdokumente' &&
      (!source || d.source === source) &&
      [d.title, d.filename, d.type, d.source, d.status, d.description].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  async function save(remove = false) {
    if (busy) return;
    if (!record) return;
    if (remove && !(await ask('Dieses Projektdokument endgültig löschen?'))) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/project-documents/' + record.id,
        remove ? 'DELETE' : 'PATCH',
        remove
          ? undefined
          : Object.fromEntries(Object.keys(emptyDocument).map((key) => [key, edit.values[key]])),
      );
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['documents'] });
      await (window as any).PHBReactBridge.imports.refresh();
      success(remove ? 'Dokument gelöscht.' : 'Dokument gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy) return;
    if (!files.length) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await (window as any).PHBReactBridge.imports.run({
        kind: 'documents',
        files,
        analysisMode: 'local',
        processingMode: mode,
        fields: metadata.values,
      });
      setUpload(false);
      setFiles([]);
      await cache.invalidateQueries({ queryKey: ['documents'] });
      if (!result.background && result.jobs[0]?.result_id)
        setTimeout(() => navigate('/dokumente?document_id=' + result.jobs[0].result_id), 0);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <PageHeader
        title="Dokumente"
        description="Projektunterlagen und Originalbelege an einem Ort."
      >
        <Button
          leftSection={<IconPlus size={17} />}
          onClick={() => {
            metadata.setValues({
              ...emptyDocument,
              area: data.areas?.[0] || 'Allgemein',
            });
            metadata.resetDirty();
            setFiles([]);
            setFailure(null);
            setUpload(true);
          }}
        >
          Dokumente hochladen
        </Button>
      </PageHeader>
      <ErrorBox value={query.error} />
      {query.isPending && <Loader />}
      <Paper className="paper">
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="project">Projektunterlagen</Tabs.Tab>
            <Tabs.Tab value="linked">Angebote, Rechnungen & Kreditunterlagen</Tabs.Tab>
          </Tabs.List>
          <Group mb="lg">
            <TextInput
              aria-label="Dokumente suchen"
              placeholder="Dokumente suchen"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            {tab === 'project' ? (
              <>
                <Select
                  aria-label="Bereich"
                  placeholder="Alle Bereiche"
                  clearable
                  data={data.areas || []}
                  value={area}
                  onChange={setArea}
                />
                <Select
                  aria-label="Dokumentstatus"
                  placeholder="Alle Status"
                  clearable
                  data={data.statuses || []}
                  value={status}
                  onChange={setStatus}
                />
              </>
            ) : (
              <Select
                aria-label="Dokumentquelle"
                placeholder="Alle Bereiche"
                clearable
                data={
                  [
                    ...new Set(
                      (data.library || [])
                        .filter((d: Row) => d.source !== 'Projektdokumente')
                        .map((d: Row) => d.source),
                    ),
                  ] as string[]
                }
                value={source}
                onChange={setSource}
              />
            )}
          </Group>
          <Tabs.Panel value="project">
            <Stack>
              {documents.map((d) => (
                <Paper withBorder p="md" key={d.id}>
                  <Group justify="space-between">
                    <div>
                      <Text fw={600} size="sm">
                        {d.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[d.category, d.area, d.filename].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                    <Badge variant="light" color={d.status === 'Aktuell' ? 'teal' : 'gray'}>
                      {d.status}
                    </Badge>
                  </Group>
                  {d.description && (
                    <Text size="sm" mt="xs">
                      {d.description}
                    </Text>
                  )}
                  <Group mt="sm">
                    {['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt'].includes(d.extension) && (
                      <Button
                        variant="light"
                        size="xs"
                        component="a"
                        href={'/api/project-documents/' + d.id + '/preview'}
                        target="_blank"
                      >
                        Ansehen
                      </Button>
                    )}
                    <Button
                      variant="default"
                      size="xs"
                      component="a"
                      href={'/api/project-documents/' + d.id + '/download'}
                    >
                      Herunterladen
                    </Button>
                    <Button variant="subtle" size="xs" onClick={() => open(d)}>
                      Bearbeiten
                    </Button>
                  </Group>
                </Paper>
              ))}
              {!documents.length && (
                <Text c="dimmed" size="sm">
                  Keine passenden Projektdokumente.
                </Text>
              )}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="linked">
            <Text size="xs" c="dimmed" mb="md">
              Originale bleiben in ihrem Fachbereich. Eine Änderung erfolgt dort.
            </Text>
            <Stack>
              {library.map((d) => (
                <Paper withBorder p="md" key={d.id}>
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" fw={600}>
                        {d.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {d.source} · {d.type} · {d.status}
                      </Text>
                    </div>
                    <Button variant="subtle" size="xs" onClick={() => navigate(d.module_url)}>
                      Im Bereich öffnen
                    </Button>
                  </Group>
                  <Group mt="sm">
                    {d.view_url && (
                      <Anchor size="xs" href={d.view_url} target="_blank">
                        Original ansehen
                      </Anchor>
                    )}
                    <Anchor size="xs" href={d.download_url}>
                      Herunterladen
                    </Anchor>
                  </Group>
                </Paper>
              ))}
              {!library.length && (
                <Text size="sm" c="dimmed">
                  Keine passenden Originalbelege.
                </Text>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Paper>
      <Editor
        opened={opened}
        title="Dokument pflegen"
        dirty={edit.isDirty()}
        busy={busy}
        onClose={() => setOpened(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Stack>
            <DocumentFields form={edit} options={data} />
            <Text size="xs" c="dimmed">
              Überholte Unterlagen bleiben archiviert und werden nicht automatisch mit ChatGPT
              geteilt.
            </Text>
            <ErrorBox value={failure} />
            <div className="actions">
              <Button
                variant="subtle"
                color="red"
                mr="auto"
                disabled={busy}
                onClick={() => save(true)}
              >
                Löschen
              </Button>
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={upload}
        title="Dokumente hochladen"
        dirty={files.length > 0 || metadata.isDirty()}
        busy={busy}
        onClose={() => setUpload(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Stack>
            <FileInput
              label="Dateien"
              description="Bis zu 8 Dateien à 12 MB. Dateien werden lokal eingelesen."
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx"
              multiple
              required
              value={files}
              onChange={(values) => {
                setFiles(values);
                if (!metadata.values.title && values[0])
                  metadata.setFieldValue('title', values[0].name.replace(/\.[^.]+$/, ''));
              }}
            />
            <DocumentFields form={metadata} options={data} />
            <Select
              label="Verarbeitung"
              value={mode}
              onChange={setMode}
              data={[
                {
                  value: 'foreground',
                  label: 'Im Vordergrund – direkt prüfen',
                },
                {
                  value: 'background',
                  label: 'Im Hintergrund – später prüfen',
                },
              ]}
            />
            <ErrorBox value={failure} />
            <div className="actions">
              <Button type="submit" loading={busy}>
                Dateien einlesen
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
    </div>
  );
}
function DocumentFields({
  form,
  options,
}: {
  form: ReturnType<typeof useForm<Row>>;
  options: Row;
}) {
  return (
    <>
      <TextInput label="Titel" required maxLength={200} {...form.getInputProps('title')} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Kategorie"
          data={options.categories || []}
          {...form.getInputProps('category')}
        />
        <Select label="Bereich" data={options.areas || []} {...form.getInputProps('area')} />
        <Select label="Status" data={options.statuses || []} {...form.getInputProps('status')} />
        <TextInput label="Schlagworte" maxLength={400} {...form.getInputProps('tags')} />
      </SimpleGrid>
      <Textarea
        label="Beschreibung"
        maxLength={1500}
        minRows={3}
        {...form.getInputProps('description')}
      />
    </>
  );
}

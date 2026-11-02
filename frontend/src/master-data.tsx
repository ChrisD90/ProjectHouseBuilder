import {
  ActionIcon,
  Anchor,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconRestore, IconSearch, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { CompanyRecord, ReferenceRecord } from './contracts';
import { Editor, ErrorBox, Row, api, error, success, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { useDirtyGuard } from './shell';
import { ActionBar, RowAction, SearchField, useViewState } from './ui';
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
        api<{ contractors: CompanyRecord[] }>('/api/costs'),
        api<{ trades: ReferenceRecord[] }>('/api/trades'),
        api<{ categories: ReferenceRecord[] }>('/api/categories'),
      ]);
      return {
        companies: cost.contractors,
        trades: tr.trades,
        categories: cat.categories,
      };
    },
  });
  const [search, setSearch] = useViewState('search', ''),
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
    form.setInitialValues({ ...emptyCompany, ...company });
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
      const savedCompany = await api(
        '/api/contractors' + (record ? '/' + record.id : ''),
        record ? 'PUT' : 'POST',
        form.values,
      );
      await cache.invalidateQueries({ queryKey: ['master'] });
      setOpened(false);
      success('Firma gespeichert.');
      const receipt = params.get('receipt_id');
      if (receipt && /^[1-9]\d*$/.test(receipt))
        setTimeout(
          () =>
            navigate(
              '/belege?receipt_id=' + receipt + '&new_company_id=' + savedCompany.contractor.id,
            ),
          0,
        );
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
  const data = query.data || { companies: [], trades: [], categories: [] };
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
          <SearchField
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
                        <RowAction onActivate={() => open(c)}>
                          <Text fw={600} size="sm">
                            {c.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {c.address}
                          </Text>
                        </RowAction>
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
          {(['trades', 'categories'] as const).map((kind) => (
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
        changes={form.values}
        original={form.getInitialValues()}
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
            <ActionBar>
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
            </ActionBar>
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
          <ActionBar>
            <Button type="submit" loading={busy}>
              Speichern
            </Button>
          </ActionBar>
        </form>
      </Editor>
    </div>
  );
}

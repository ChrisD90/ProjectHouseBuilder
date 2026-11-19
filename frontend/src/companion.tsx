import {
  ActionIcon,
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowRight,
  IconBookmark,
  IconCheck,
  IconClipboard,
  IconDownload,
  IconPlus,
  IconSearch,
  IconStar,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, Editor, ErrorBox, error, money, Row, success, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { projectID, projectURL, workspaceURL } from './project-context';
import { useDirtyGuard } from './shell';
import { SearchField } from './ui';
import { useWorkActions } from './work';
import './companion.css';
import { TilePlanner } from './tile-planner';

const labels: Record<string, string> = {
  journal: 'Bautagebuch',
  defect: 'Mängel & Abnahme',
  house: 'Hausakte',
  dossier: 'Terminmappe',
  addendum: 'Nachträge',
  terms: 'Zahlungsfristen',
  glossary: 'Eigene Wissensnotizen',
  tool_return: 'Werkzeugrückgaben',
  reminder: 'Fristen',
  template: 'Vorlagen',
};
const sourceLabels: Record<string, string> = {
  event: 'Termin',
  company: 'Firma',
  offer: 'Angebot',
  receipt: 'Beleg',
  funding: 'Förderung',
  self_work: 'Eigenleistung',
  document: 'Dokument',
};
const fresh = (kind: string, source?: { type: string; id: number }): Row => ({
  kind,
  title: '',
  body: '',
  status: kind === 'addendum' ? 'Entwurf' : 'Offen',
  day: new Date().toLocaleDateString('sv-SE'),
  until: '',
  location: '',
  source_type: source?.type || '',
  source_id: source?.id || null,
  amount: 0,
  data: { document_ids: [] },
});
const useCompanion = () =>
  useQuery({ queryKey: ['companion'], queryFn: () => api('/api/companion'), staleTime: 0 });
const day = (s: string) =>
  s
    ? new Intl.DateTimeFormat('de-DE').format(new Date(s.slice(0, 10) + 'T12:00:00'))
    : 'Ohne Termin';
async function download(path: string, body: unknown, name: string) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PHB-Project': String(projectID) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json();
    throw Error(result.error || 'Export fehlgeschlagen.');
  }
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const goURL = (kind: string, id: number) =>
  ({
    event: `/?calendar_event=${id}`,
    offer: `/angebote?offer_id=${id}`,
    receipt: `/belege?receipt_id=${id}`,
    funding: `/energieplanung?funding_id=${id}`,
    self_work: `/eigenleistungen?plan_id=${id}`,
    document: `/dokumente?document_id=${id}`,
    company: `/projektwerkstatt?tab=companies&company=${id}`,
  })[kind as 'event'];

export function CompanionPanel({
  kind,
  source,
  onEditingChange,
}: {
  kind: string;
  source?: { type: string; id: number };
  onEditingChange?: (value: boolean) => void;
}) {
  const query = useCompanion(),
    cache = useQueryClient(),
    ask = useConfirm(),
    navigate = useNavigate(),
    work = useWorkActions();
  const docs = useQuery({
    queryKey: ['companion-documents'],
    queryFn: () => api('/api/project-documents'),
  });
  const [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [archived, setArchived] = useState(false),
    [file, setFile] = useState<File | null>(null);
  const form = useForm<Row>({ initialValues: fresh(kind, source) });
  const [routeParams, setRouteParams] = useSearchParams();
  const handledRecord = useRef('');
  useEffect(() => {
    const id = routeParams.get('record');
    if (!id || !query.data || handledRecord.current === id) return;
    const row = query.data.records.find((x: Row) => String(x.id) === id && x.kind === kind);
    if (row) {
      handledRecord.current = id;
      edit(row);
    }
  }, [routeParams.get('record'), query.dataUpdatedAt]);
  useEffect(() => {
    if (editing || !handledRecord.current) return;
    handledRecord.current = '';
    const next = new URLSearchParams(routeParams);
    next.delete('record');
    setRouteParams(next, { replace: true });
  }, [editing]);
  useDirtyGuard(editing && form.isDirty());
  const setOpen = (value: boolean) => {
    setEditing(value);
    onEditingChange?.(value);
  };
  const rows = (query.data?.records || []).filter(
    (x: Row) =>
      x.kind === kind &&
      (!source || (x.source_type === source.type && x.source_id === source.id)) &&
      (archived ? x.status === 'Archiviert' : x.status !== 'Archiviert'),
  );
  function edit(row?: Row) {
    const values = row ? { ...row, data: { ...row.data } } : fresh(kind, source);
    setSelected(row?.id || null);
    form.setValues(values);
    form.resetDirty(values);
    setFile(null);
    setFailure(null);
    setOpen(true);
  }
  async function refresh() {
    await Promise.all(
      [
        'companion',
        'companion-overview',
        'cost-dashboard',
        'costs',
        'projects',
        'companion-search',
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    );
  }
  async function save(values: Row) {
    setBusy(true);
    setFailure(null);
    try {
      const {
        kind,
        title,
        body,
        status,
        day,
        until,
        location,
        source_type,
        source_id,
        amount,
        data,
      } = values;
      await api(
        '/api/companion/records' + (selected ? '/' + selected : ''),
        selected ? 'PATCH' : 'POST',
        { kind, title, body, status, day, until, location, source_type, source_id, amount, data },
      );
      form.resetDirty();
      setOpen(false);
      await refresh();
      success('Gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: Row) {
    if (
      !(await ask(
        '„' + row.title + '“ endgültig löschen? Verknüpfte Originaldateien bleiben erhalten.',
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/companion/records/' + row.id, 'DELETE');
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function decision(row: Row) {
    if (
      !(await ask(
        row.status === 'Freigegeben'
          ? 'Nachtragsfreigabe zurücknehmen?'
          : 'Nachtrag verbindlich freigeben? Der Betrag fließt zusätzlich in die Kostenprognose ein.',
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/companion/records/' + row.id + '/decision', 'POST', {
        approve: row.status !== 'Freigegeben',
        confirm: true,
      });
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function archive(row: Row) {
    setBusy(true);
    try {
      const data = { ...row.data };
      const previous = data.archived_status || 'Offen';
      if (row.status === 'Archiviert') delete data.archived_status;
      else data.archived_status = row.status;
      await api('/api/companion/records/' + row.id, 'PATCH', {
        status: row.status === 'Archiviert' ? previous : 'Archiviert',
        data,
      });
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!file) return;
    setBusy(true);
    setFailure(null);
    try {
      const data = new FormData();
      data.set('file', file);
      data.set('category', kind === 'journal' || kind === 'defect' ? 'Protokoll' : 'Sonstiges');
      data.set('title', file.name);
      const result = await api('/api/project-documents', 'POST', data);
      form.setFieldValue('data.document_ids', [
        ...(form.values.data.document_ids || []),
        result.document.id,
      ]);
      setFile(null);
      await cache.invalidateQueries({ queryKey: ['companion-documents'] });
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={650}>{labels[kind]}</Text>
        <Group gap="xs">
          <Checkbox
            size="xs"
            label="Archiv"
            checked={archived}
            onChange={(e) => setArchived(e.currentTarget.checked)}
          />
          <Button size="compact-sm" leftSection={<IconPlus size={14} />} onClick={() => edit()}>
            Hinzufügen
          </Button>
          {['journal', 'defect', 'house', 'dossier'].includes(kind) && (
            <Button
              component="a"
              href={projectURL(
                '/api/companion/report?kind=' +
                  kind +
                  (source ? '&source_type=' + source.type + '&source_id=' + source.id : ''),
              )}
              target="_blank"
              variant="default"
              size="compact-sm"
            >
              Drucken / PDF
            </Button>
          )}
        </Group>
      </Group>
      <ErrorBox value={query.error} />
      {query.isPending && <Loader size="sm" />}
      <div className="companion-records">
        {rows.map((row: Row) => (
          <Paper key={row.id} withBorder p="sm">
            <Group justify="space-between" align="start">
              <UnstyledButton
                className="companion-record-open"
                onClick={() => edit(row)}
                disabled={row.status === 'Freigegeben'}
              >
                <Text fw={600} size="sm">
                  {row.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {[row.day && day(row.day), row.location, row.until && 'Frist: ' + day(row.until)]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </UnstyledButton>
              <Badge
                size="sm"
                variant="light"
                color={row.status === 'Erledigt' || row.status === 'Freigegeben' ? 'teal' : 'gray'}
              >
                {row.status}
              </Badge>
            </Group>
            {row.body && (
              <Text size="sm" mt={6} lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>
                {row.body}
              </Text>
            )}
            {row.amount > 0 && (
              <Text size="sm" fw={600} mt={5}>
                {money(row.amount)}
              </Text>
            )}
            {(row.data.document_ids || []).length > 0 && (
              <Group gap={6} mt={8}>
                {row.data.document_ids.map((id: number) => {
                  const doc = docs.data?.documents.find((d: Row) => d.id === id);
                  return (
                    <Anchor
                      key={id}
                      size="xs"
                      href={projectURL('/api/project-documents/' + id + '/preview')}
                      target="_blank"
                    >
                      {doc && ['.jpg', '.jpeg', '.png', '.webp'].includes(doc.extension) && (
                        <img
                          className="companion-thumbnail"
                          src={projectURL('/api/project-documents/' + id + '/preview')}
                          alt={doc.title}
                          loading="lazy"
                        />
                      )}
                      {doc?.title || 'Unterlage'}
                    </Anchor>
                  );
                })}
              </Group>
            )}
            <Group gap={6} mt={8}>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() =>
                  work.edit({
                    kind: 'todo',
                    title: row.title,
                    body: row.body,
                    due_on: row.until || '',
                    source_type: row.source_type,
                    source_id: row.source_id,
                    done: false,
                  })
                }
              >
                To-do erstellen
              </Button>
              {row.data.self_work_id && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => navigate('/eigenleistungen?plan_id=' + row.data.self_work_id)}
                >
                  Vorbereitung / Materialien
                </Button>
              )}
              {(row.data.document_ids || []).length > 0 && (
                <Button
                  variant="subtle"
                  size="compact-xs"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await download(
                        '/api/companion/package',
                        {
                          document_ids: row.data.document_ids,
                          title: row.title,
                          summary: row.body,
                        },
                        'Unterlagen.zip',
                      );
                    } catch (e) {
                      error(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Unterlagenpaket
                </Button>
              )}
              {row.source_type && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => navigate(goURL(row.source_type, row.source_id))}
                >
                  Bezug öffnen
                </Button>
              )}
              {kind === 'addendum' && (
                <Button
                  variant="light"
                  size="compact-xs"
                  disabled={busy}
                  onClick={() => void decision(row)}
                >
                  {row.status === 'Freigegeben' ? 'Freigabe zurücknehmen' : 'Freigeben'}
                </Button>
              )}
              {row.status !== 'Freigegeben' && (
                <>
                  <Button size="compact-xs" variant="subtle" onClick={() => edit(row)}>
                    Bearbeiten
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => void archive(row)}
                    disabled={busy}
                  >
                    {row.status === 'Archiviert' ? 'Wiederherstellen' : 'Archivieren'}
                  </Button>
                  <Tooltip label="Eintrag löschen">
                    <ActionIcon
                      aria-label={'Löschen: ' + row.title}
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() => void remove(row)}
                      disabled={busy}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
            </Group>
          </Paper>
        ))}
      </div>
      {!rows.length && !query.isPending && (
        <Text size="sm" c="dimmed">
          Noch keine Einträge in dieser Auswahl.
        </Text>
      )}
      <Editor
        opened={editing}
        title={labels[kind]}
        onClose={() => setOpen(false)}
        dirty={form.isDirty()}
        busy={busy}
        zIndex={260}
        size="lg"
      >
        <form onSubmit={form.onSubmit(save)}>
          <Stack gap="sm">
            <ErrorBox value={failure} />
            <TextInput label="Titel" required maxLength={200} {...form.getInputProps('title')} />
            <SimpleGrid cols={2}>
              <TextInput label="Datum" type="date" {...form.getInputProps('day')} />
              <TextInput
                label={
                  kind === 'house'
                    ? 'Wartung / Garantie bis'
                    : kind === 'tool_return'
                      ? 'Rückgabe bis'
                      : 'Frist'
                }
                type="date"
                {...form.getInputProps('until')}
              />
            </SimpleGrid>
            <TextInput label="Raum / Ort" maxLength={200} {...form.getInputProps('location')} />
            <Select
              label="Status"
              data={
                kind === 'addendum'
                  ? ['Entwurf', 'Abgelehnt']
                  : ['Offen', 'In Arbeit', 'Erledigt', 'Archiviert']
              }
              {...form.getInputProps('status')}
            />
            {!source && (
              <SimpleGrid cols={2}>
                <Select
                  label="Bezug"
                  clearable
                  data={Object.entries(sourceLabels).map(([value, label]) => ({ value, label }))}
                  value={form.values.source_type || null}
                  onChange={(value) =>
                    form.setValues({ source_type: value || '', source_id: null })
                  }
                />
                <Select
                  label="Verknüpfter Eintrag"
                  searchable
                  clearable
                  disabled={!form.values.source_type}
                  data={(query.data?.references?.[form.values.source_type] || []).map((x: Row) => ({
                    value: String(x.id),
                    label: x.title,
                  }))}
                  value={form.values.source_id ? String(form.values.source_id) : null}
                  onChange={(value) =>
                    form.setFieldValue('source_id', value ? Number(value) : null)
                  }
                />
              </SimpleGrid>
            )}
            {kind === 'addendum' && (
              <NumberInput
                decimalSeparator=","
                thousandSeparator="."
                label="Zusätzlicher Bruttobetrag (€)"
                min={0}
                decimalScale={2}
                {...form.getInputProps('amount')}
              />
            )}
            {kind === 'dossier' && (
              <Select
                label="Eigenleistung / Vorbereitung"
                searchable
                clearable
                value={form.values.data.self_work_id ? String(form.values.data.self_work_id) : null}
                onChange={(v) => form.setFieldValue('data.self_work_id', v ? Number(v) : null)}
                data={(query.data?.references.self_work || []).map((x: Row) => ({
                  value: String(x.id),
                  label: x.title,
                }))}
              />
            )}
            <Textarea
              label={
                kind === 'defect'
                  ? 'Mangel, Vereinbarung und Abnahmevorbehalt'
                  : 'Beschreibung / Checkliste'
              }
              autosize
              minRows={4}
              maxLength={10000}
              {...form.getInputProps('body')}
            />
            <MultiSelect
              label="Unterlagen / Fotos"
              searchable
              clearable
              value={(form.values.data.document_ids || []).map(String)}
              onChange={(ids) => form.setFieldValue('data.document_ids', ids.map(Number))}
              data={(docs.data?.documents || []).map((d: Row) => ({
                value: String(d.id),
                label: d.title,
              }))}
            />
            <Group align="end" wrap="nowrap">
              <FileInput
                label="Foto oder Unterlage ergänzen"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx"
                value={file}
                onChange={setFile}
                style={{ flex: 1 }}
              />
              <Button variant="default" onClick={() => void upload()} disabled={!file || busy}>
                Hochladen
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Hochgeladene Originale bleiben auch im Bereich Dokumente erhalten.
            </Text>
            <Group justify="flex-end">
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        </form>
      </Editor>
    </Stack>
  );
}

export function CheckpointButton() {
  const q = useQuery({
      queryKey: ['companion-backup'],
      queryFn: () => api('/api/companion/backup-state'),
      staleTime: 30000,
    }),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      await api('/api/backup/create', 'POST', {});
      await cache.invalidateQueries({ queryKey: ['companion-backup'] });
      success('Projekt gesichert.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper withBorder p="sm">
      <Group justify="space-between">
        <div>
          <Text size="sm" fw={600}>
            Projektsicherung
          </Text>
          <Text size="xs" c="dimmed">
            {q.isPending
              ? 'Status wird geladen …'
              : q.data?.configured
                ? q.data.latest
                  ? `${q.data.created ? new Date(q.data.created).toLocaleString('de-DE') : q.data.latest} · ${q.data.changes || 0} geänderte Einträge seitdem`
                  : 'Noch keine Projektsicherung.'
                : 'Sicherungsordner unter Daten & Sicherung einrichten.'}
          </Text>
        </div>
        <Button
          variant="default"
          size="compact-sm"
          loading={busy}
          onClick={() => void create()}
          disabled={!q.data?.configured}
        >
          Wiederherstellungspunkt
        </Button>
      </Group>
    </Paper>
  );
}

export function Overview() {
  const q = useQuery({
      queryKey: ['companion-overview'],
      queryFn: () => api('/api/companion/overview'),
      staleTime: 0,
    }),
    navigate = useNavigate(),
    work = useWorkActions();
  return (
    <div className="page">
      <PageHeader title="Was steht an?" description="Deine nächsten Schritte im Projekt.">
        <Group>
          <Button variant="default" onClick={() => work.create('note')}>
            Notiz
          </Button>
          <Button onClick={() => work.create('todo')}>To-do</Button>
        </Group>
      </PageHeader>
      <ErrorBox value={q.error} />
      {q.isPending ? (
        <Loader />
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Paper withBorder p="md">
            <Title order={3}>Nächste Termine</Title>
            <Stack gap={6} mt="sm">
              {(q.data?.events || []).map((e: Row) => (
                <Button
                  key={e.id}
                  className="companion-action-row"
                  variant="subtle"
                  justify="space-between"
                  rightSection={<IconArrowRight size={14} />}
                  onClick={() => navigate('/?calendar_event=' + e.id)}
                >
                  {day(e.start_date)} · {e.title}
                </Button>
              ))}
              {!q.data?.events.length && (
                <Text size="sm" c="dimmed">
                  Keine Termine in den nächsten sieben Tagen.
                </Text>
              )}
            </Stack>
          </Paper>
          <Paper withBorder p="md">
            <Title order={3}>Offene Aufgaben</Title>
            <Stack mt="sm" gap={5}>
              {(q.data?.todos || []).slice(0, 8).map((x: Row) => (
                <Group key={x.id} wrap="nowrap">
                  <Checkbox
                    aria-label={'Erledigen: ' + x.title}
                    checked={false}
                    onChange={() => void work.mutate(x, 'done')}
                  />
                  <UnstyledButton onClick={() => work.edit(x)}>
                    <Text size="sm">{x.title}</Text>
                    <Text size="xs" c="dimmed">
                      {x.due_on ? day(x.due_on) : 'Ohne Fälligkeit'}
                    </Text>
                  </UnstyledButton>
                </Group>
              ))}
              {!q.data?.todos.length && (
                <Text size="sm" c="dimmed">
                  Alles erledigt.
                </Text>
              )}
            </Stack>
          </Paper>
          <Paper withBorder p="md">
            <Title order={3}>Zu bezahlen</Title>
            <Stack mt="sm" gap={5}>
              {(q.data?.receipts || []).slice(0, 8).map((x: Row) => (
                <UnstyledButton key={x.id} onClick={() => navigate(x.url)}>
                  <Group justify="space-between">
                    <Text size="sm">{x.title}</Text>
                    <Text size="sm" fw={600}>
                      {money(x.amount)}
                    </Text>
                  </Group>
                  <Text c="dimmed" size="xs">
                    {x.due_on ? 'Fällig: ' + day(x.due_on) : 'Zahlungsziel offen'}
                  </Text>
                </UnstyledButton>
              ))}
              {!q.data?.receipts.length && (
                <Text size="sm" c="dimmed">
                  Keine offenen Rechnungen.
                </Text>
              )}
            </Stack>
          </Paper>
          <Paper withBorder p="md">
            <Title order={3}>Fristen & Vorbereitung</Title>
            <Stack mt="sm" gap={6}>
              {(q.data?.reminders || []).map((x: Row) => (
                <Button
                  variant="subtle"
                  className="companion-action-row"
                  key={x.id}
                  onClick={() =>
                    navigate(
                      x.url ||
                        '/projektwerkstatt?tab=' +
                          ({
                            defect: 'defect',
                            house: 'house',
                            tool_return: 'shopping',
                            reminder: 'funding',
                          }[x.kind as 'defect'] || 'journal'),
                    )
                  }
                >
                  {day(x.until)} · {x.title}
                </Button>
              ))}
              <Button variant="default" onClick={() => navigate('/projektwerkstatt?tab=shopping')}>
                Einkauf & Werkzeugrückgaben
              </Button>
              <Button variant="default" onClick={() => navigate('/daten')}>
                Dokumenteneingang & Datenverwaltung
              </Button>
            </Stack>
          </Paper>
        </SimpleGrid>
      )}
      <div style={{ marginTop: 16 }}>
        <CheckpointButton />
      </div>
    </div>
  );
}

function Shopping() {
  const q = useQuery({
      queryKey: ['companion-shopping'],
      queryFn: () => api('/api/companion/shopping'),
      staleTime: 0,
    }),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState<string | null>('Benötigt');
  async function change(row: Row, status: string) {
    setBusy(true);
    try {
      await api('/api/companion/shopping/status', 'POST', { items: row.items, status });
      await Promise.all(
        ['companion-shopping', 'self-work', 'cost-dashboard'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Group justify="space-between">
        <Select
          aria-label="Beschaffungsstatus"
          clearable
          value={status}
          onChange={setStatus}
          data={['Benötigt', 'Bestellt', 'Vorhanden']}
        />
        <Button variant="default" onClick={() => window.print()}>
          Einkaufsliste drucken
        </Button>
      </Group>
      <ErrorBox value={q.error} />
      {(q.data?.materials || [])
        .filter((m: Row) => !status || m.status === status)
        .map((m: Row) => (
          <Paper withBorder p="sm" key={m.key}>
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={600}>
                  {m.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {m.unknown_quantity ? 'Menge teilweise offen · ' : ''}
                  {m.quantity} {m.unit} ·{' '}
                  {m.unknown_price ? 'Preis teilweise offen' : money(m.estimated)}
                </Text>
              </div>
              <Select
                aria-label={'Status: ' + m.title}
                size="xs"
                w={135}
                data={['Benötigt', 'Bestellt', 'Vorhanden']}
                value={m.status}
                disabled={busy}
                onChange={(v) => v && void change(m, v)}
              />
            </Group>
            <Group gap={6} mt={5}>
              {m.items.map((i: Row) => (
                <Anchor
                  key={i.plan_id + ':' + i.row_id}
                  size="xs"
                  onClick={() => navigate('/eigenleistungen?plan_id=' + i.plan_id)}
                >
                  {i.plan}
                </Anchor>
              ))}
            </Group>
          </Paper>
        ))}
      {!q.data?.materials.length && (
        <Text c="dimmed" size="sm">
          Materialien deiner aktiven Eigenleistungen erscheinen hier automatisch.
        </Text>
      )}
      <Accordion chevronPosition="left">
        <Accordion.Item value="tools">
          <Accordion.Control>Werkzeuge aus Eigenleistungen</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {(q.data?.tools || []).map((t: Row) => (
                <Group key={t.plan_id + ':' + t.id} justify="space-between">
                  <div>
                    <Text size="sm">{t.title}</Text>
                    <Text size="xs" c="dimmed">
                      {t.source} · {t.ready ? 'Bereit' : 'Fehlt'} · {t.plan}
                    </Text>
                  </div>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() => navigate('/eigenleistungen?plan_id=' + t.plan_id)}
                  >
                    Öffnen
                  </Button>
                </Group>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <CompanionPanel kind="tool_return" />
    </Stack>
  );
}

function House() {
  const q = useQuery({
      queryKey: ['companion-documents'],
      queryFn: () => api('/api/project-documents'),
    }),
    comp = useCompanion();
  const [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  async function pack() {
    setBusy(true);
    try {
      await download(
        '/api/companion/package',
        {
          document_ids: ids.map(Number),
          title: 'Hausakte',
          summary: (comp.data?.records || [])
            .filter((x: Row) => x.kind === 'house')
            .map((x: Row) =>
              [x.title, x.location, x.until && 'Frist: ' + x.until, x.body]
                .filter(Boolean)
                .join('\n'),
            )
            .join('\n\n'),
        },
        'Hausakte.zip',
      );
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <CompanionPanel kind="house" />
      <Paper withBorder p="sm">
        <Stack gap="sm">
          <Text fw={600}>Übergabepaket</Text>
          <MultiSelect
            label="Unterlagen für den Export"
            searchable
            clearable
            data={(q.data?.documents || []).map((d: Row) => ({
              value: String(d.id),
              label: d.title,
            }))}
            value={ids}
            onChange={setIds}
          />
          <Group justify="flex-end">
            <Button
              leftSection={<IconDownload size={15} />}
              loading={busy}
              onClick={() => void pack()}
              disabled={!ids.length}
            >
              Hausakte als ZIP
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

function Companies() {
  const q = useCompanion(),
    navigate = useNavigate(),
    [params, setParams] = useSearchParams();
  const [id, setID] = useState<string | null>(params.get('company'));
  const detail = useQuery({
    queryKey: ['companion-company', id],
    enabled: !!id,
    queryFn: () => api('/api/companion/company/' + id),
  });
  return (
    <Stack>
      <Select
        label="Firma"
        searchable
        clearable
        value={id}
        onChange={(value) => {
          setID(value);
          setParams(value ? { tab: 'companies', company: value } : { tab: 'companies' });
        }}
        data={(q.data?.references.company || []).map((x: Row) => ({
          value: String(x.id),
          label: x.title,
        }))}
      />
      <ErrorBox value={detail.error} />
      {detail.data && (
        <>
          <Paper withBorder p="sm">
            <Title order={3}>{detail.data.company.name}</Title>
            <Text size="sm" c="dimmed">
              {detail.data.company.address}
            </Text>
            <Group gap="md">
              {detail.data.company.phone && (
                <Anchor href={'tel:' + detail.data.company.phone}>
                  {detail.data.company.phone}
                </Anchor>
              )}
              {detail.data.company.email && (
                <Anchor href={'mailto:' + detail.data.company.email}>
                  {detail.data.company.email}
                </Anchor>
              )}
            </Group>
            <Text size="sm">{detail.data.company.notes}</Text>
          </Paper>
          {['events', 'offers', 'receipts'].map((kind) => (
            <Paper key={kind} withBorder p="sm">
              <Text fw={600}>
                {{ events: 'Termine', offers: 'Angebote', receipts: 'Belege' }[kind]}
              </Text>
              <Stack mt="xs" gap={4}>
                {detail.data[kind].map((x: Row) => (
                  <Button
                    key={x.id}
                    variant="subtle"
                    className="companion-action-row"
                    onClick={() =>
                      navigate(
                        goURL(
                          { events: 'event', offers: 'offer', receipts: 'receipt' }[kind]!,
                          x.id,
                        ),
                      )
                    }
                  >
                    {x.title}
                    {x.amount ? ' · ' + money(x.amount) : ''}
                  </Button>
                ))}
              </Stack>
            </Paper>
          ))}
          <Paper withBorder p="sm">
            <Text fw={600}>Stunden</Text>
            <Stack gap={5} mt="sm">
              {detail.data.people.map((person: Row) => (
                <Button
                  key={person.id}
                  variant="subtle"
                  className="companion-action-row"
                  onClick={() => navigate('/stunden?person_id=' + person.id)}
                >
                  {person.name} · {(person.total_minutes / 60).toLocaleString('de-DE')} Std.
                  bestätigt
                  {person.planned_minutes
                    ? ' · ' +
                      (person.planned_minutes / 60).toLocaleString('de-DE') +
                      ' Std. geplant'
                    : ''}
                </Button>
              ))}
              <Button variant="default" onClick={() => navigate('/stunden')}>
                Zur Stundenerfassung
              </Button>
            </Stack>
          </Paper>
        </>
      )}
    </Stack>
  );
}

function Liquidity() {
  const q = useQuery({
      queryKey: ['companion-liquidity'],
      queryFn: () => api('/api/companion/liquidity'),
    }),
    finance = useQuery({ queryKey: ['companion-finance'], queryFn: () => api('/api/financing') }),
    navigate = useNavigate();
  const available =
    (finance.data?.equity || []).reduce(
      (sum: number, x: Row) => sum + Math.max(0, Number(x.balance?.after_reserve) || 0),
      0,
    ) +
    (finance.data?.loans || []).reduce(
      (sum: number, x: Row) => sum + Math.max(0, Number(x.balance?.unallocated_drawn) || 0),
      0,
    );
  const need = (q.data?.weeks || []).reduce((sum: number, x: Row) => sum + Number(x.outgoing), 0);
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Vorschau auf Basis bereits gebuchter Rechnungen und ihrer Zahlungsziele. Erwartete
        Förderungen und noch nicht bestätigte Mittelabrufe sind kein verfügbares Guthaben.
      </Text>
      <ErrorBox value={q.error || finance.error} />
      <Group justify="space-between">
        <Text fw={600}>Frei verfügbar nach EK-Reserve: {money(available)}</Text>
        <Text fw={600}>In 8 Wochen fällig: {money(need)}</Text>
      </Group>
      {need > available && (
        <Alert color="orange">
          Für die bekannten Fälligkeiten fehlen aktuell {money(need - available)}. Noch nicht
          bestätigte Mittel sind hier nicht eingerechnet.
        </Alert>
      )}
      <Accordion>
        <Accordion.Item value="incoming">
          <Accordion.Control>Erwartete Mittel (noch nicht verfügbar)</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {(q.data?.funding || []).map((f: Row) => (
                <Text size="sm" key={f.id}>
                  {f.title}: {money(Math.max(0, Math.max(f.expected, f.confirmed) - f.received))}{' '}
                  erwartet, davon {money(Math.max(0, f.confirmed - f.received))} bewilligt und noch
                  offen.
                </Text>
              ))}
              {(q.data?.pending_drawdowns || []).map((d: Row) => (
                <Text size="sm" key={d.id}>
                  {d.title}: {money(d.amount)} angefragt für {day(d.requested_date)}.
                </Text>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Zeitraum</Table.Th>
            <Table.Th ta="right">Fällige Zahlungen</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data?.weeks || []).map((w: Row) => (
            <Table.Tr key={w.from_date}>
              <Table.Td>
                {day(w.from_date)} – {day(w.to_date)}
              </Table.Td>
              <Table.Td ta="right">{money(w.outgoing)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm">{(q.data?.undated || []).length} offene Rechnungen ohne Zahlungsziel</Text>
      {(q.data?.undated || []).map((x: Row) => (
        <Button
          key={x.id}
          variant="subtle"
          onClick={() => navigate('/belege?receipt_id=' + x.id + '&financing=1')}
        >
          {x.title} · {money(x.amount)}
        </Button>
      ))}
      <Button variant="default" onClick={() => navigate('/finanzierung')}>
        Guthaben und Mittelabrufe prüfen
      </Button>
    </Stack>
  );
}

function VersionCompare() {
  const q = useCompanion(),
    [id, setID] = useState<string | null>(new URLSearchParams(location.search).get('offer')),
    [left, setLeft] = useState<string | null>(null),
    [right, setRight] = useState<string | null>(null);
  const versions = useQuery({
    queryKey: ['companion-versions', id],
    enabled: !!id,
    queryFn: () => api('/api/companion/offers/' + id + '/compare'),
  });
  const list: Row[] = versions.data?.versions || [],
    a = list.find((x) => String(x.id) === left) || list[0],
    b = list.find((x) => String(x.id) === right) || list.at(-1);
  const fields = [
    ['vendor', 'Anbieter'],
    ['number', 'Angebotsnummer'],
    ['gross', 'Brutto'],
    ['net', 'Netto'],
    ['date', 'Datum'],
    ['notes', 'Notizen'],
  ];
  const positions = (snapshot: Row) =>
    new Map((snapshot.positions || []).map((p: Row) => [String(p.number || p.description), p]));
  const ap = positions(a?.snapshot || {}),
    bp = positions(b?.snapshot || {});
  return (
    <Stack>
      <CompanionPanel kind="addendum" source={id ? { type: 'offer', id: Number(id) } : undefined} />
      <Accordion>
        <Accordion.Item value="compare">
          <Accordion.Control>Angebotsversionen gegenüberstellen</Accordion.Control>
          <Accordion.Panel>
            <Stack>
              <Select
                label="Angebot"
                searchable
                clearable
                value={id}
                onChange={(v) => {
                  setID(v);
                  setLeft(null);
                  setRight(null);
                }}
                data={(q.data?.references.offer || []).map((x: Row) => ({
                  value: String(x.id),
                  label: x.title,
                }))}
              />
              <ErrorBox value={versions.error} />
              {list.length > 0 && (
                <>
                  <SimpleGrid cols={2}>
                    {[
                      [left, setLeft, 'Vorher'],
                      [right, setRight, 'Nachher'],
                    ].map(([value, setter, label], i) => (
                      <Select
                        key={String(label)}
                        label={String(label)}
                        value={(value as string | null) || String((i ? b : a)?.id)}
                        onChange={setter as any}
                        data={list.map((x) => ({
                          value: String(x.id),
                          label: 'Version ' + x.version,
                        }))}
                      />
                    ))}
                  </SimpleGrid>
                  <Table withTableBorder>
                    <Table.Tbody>
                      {fields.map(([key, label]) => (
                        <Table.Tr
                          key={key}
                          bg={
                            String(a?.snapshot[key]) !== String(b?.snapshot[key])
                              ? 'var(--brand-soft)'
                              : undefined
                          }
                        >
                          <Table.Td>{label}</Table.Td>
                          <Table.Td>
                            {['gross', 'net'].includes(key)
                              ? a?.snapshot[key] == null
                                ? '—'
                                : money(a.snapshot[key])
                              : String(a?.snapshot[key] ?? '—')}
                          </Table.Td>
                          <Table.Td>
                            {['gross', 'net'].includes(key)
                              ? b?.snapshot[key] == null
                                ? '—'
                                : money(b.snapshot[key])
                              : String(b?.snapshot[key] ?? '—')}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {[...new Set([...ap.keys(), ...bp.keys()])].map((key) => {
                        const before = ap.get(key) as Row | undefined,
                          after = bp.get(key) as Row | undefined;
                        return (
                          <Table.Tr
                            key={'position-' + key}
                            bg={
                              JSON.stringify(before) !== JSON.stringify(after)
                                ? 'var(--brand-soft)'
                                : undefined
                            }
                          >
                            <Table.Td>Position {String(key)}</Table.Td>
                            <Table.Td>
                              {before
                                ? `${before.description} · ${before.quantity ?? ''} ${before.unit || ''} · ${money(before.net_amount)}`
                                : 'Neu'}
                            </Table.Td>
                            <Table.Td>
                              {after
                                ? `${after.description} · ${after.quantity ?? ''} ${after.unit || ''} · ${money(after.net_amount)}`
                                : 'Entfallen'}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

function PaymentTerms() {
  const q = useCompanion(),
    finance = useQuery({ queryKey: ['companion-finance'], queryFn: () => api('/api/financing') }),
    cache = useQueryClient(),
    ask = useConfirm();
  const [id, setID] = useState<string | null>(new URLSearchParams(location.search).get('receipt')),
    [percent, setPercent] = useState<number | string>(2),
    [until, setUntil] = useState(''),
    [paidOn, setPaidOn] = useState(new Date().toLocaleDateString('sv-SE')),
    [source, setSource] = useState<string | null>('unassigned'),
    [account, setAccount] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const terms = useQuery({
    queryKey: ['receipt-terms', id],
    enabled: !!id,
    queryFn: () => api('/api/receipts/' + id + '/terms'),
  });
  useEffect(() => {
    if (terms.data) {
      setPercent(terms.data.percent);
      setUntil(terms.data.until);
    }
  }, [terms.data]);
  async function action(kind: string) {
    if (!id) return;
    setBusy(true);
    try {
      if (kind === 'save') {
        await api('/api/receipts/' + id + '/terms', 'PUT', { percent: Number(percent), until });
      } else {
        if (
          !(await ask(
            kind === 'pay'
              ? `${money(terms.data?.payment)} verbindlich bezahlen und ${money(terms.data?.discount)} Skonto verrechnen?`
              : 'Skontoabzug zurücknehmen? Bereits gebuchte Geldbewegungen bleiben bestehen.',
          ))
        )
          return;
        await api(
          '/api/receipts/' + id + (kind === 'pay' ? '/pay-discount' : '/discount-reverse'),
          'POST',
          {
            confirm: true,
            source,
            account_id: account ? Number(account) : null,
            payment_date: paidOn,
            expected_payment: terms.data?.payment,
            expected_discount: terms.data?.discount,
          },
        );
      }
      await Promise.all(
        [
          'receipt-terms',
          'companion-finance',
          'companion-overview',
          'companion-liquidity',
          'receipts',
          'cost-dashboard',
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
      success('Gespeichert.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  const accounts = source === 'loan' ? finance.data?.loans : finance.data?.equity;
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        Skontokonditionen nur aus der Rechnung oder Vereinbarung übernehmen. Der Originalbetrag
        bleibt erhalten; nur die bestätigte Zahlung und der getrennte Abzug ändern den offenen
        Betrag.
      </Text>
      <Select
        label="Rechnung"
        searchable
        clearable
        value={id}
        onChange={setID}
        data={(q.data?.references.receipt || []).map((x: Row) => ({
          value: String(x.id),
          label: x.title,
        }))}
      />
      <ErrorBox value={terms.error} />
      {id && (
        <>
          <SimpleGrid cols={2}>
            <NumberInput
              decimalSeparator=","
              thousandSeparator="."
              label="Skonto (%)"
              min={0}
              max={100}
              decimalScale={2}
              value={percent}
              onChange={setPercent}
            />
            <TextInput
              type="date"
              label="Skontofrist"
              value={until}
              onChange={(e) => setUntil(e.currentTarget.value)}
            />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={busy || terms.data?.settled > 0}
              onClick={() => void action('save')}
            >
              Konditionen speichern
            </Button>
          </Group>
          {terms.data?.settled > 0 ? (
            <Paper withBorder p="sm">
              <Text>Verrechneter Skontoabzug: {money(terms.data?.settled)}</Text>
              <Button
                variant="subtle"
                color="red"
                disabled={busy}
                onClick={() => void action('reverse')}
              >
                Skontoverrechnung zurücknehmen
              </Button>
            </Paper>
          ) : (
            <Paper withBorder p="sm">
              <Stack>
                <Text fw={600}>
                  Zahlbetrag: {money(terms.data?.payment)} · Skonto: {money(terms.data?.discount)}
                </Text>
                <TextInput
                  label="Zahlungsdatum"
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.currentTarget.value)}
                />
                <Select
                  label="Finanzierung"
                  value={source}
                  onChange={(v) => {
                    setSource(v);
                    setAccount(null);
                  }}
                  data={[
                    { value: 'unassigned', label: 'Später zuordnen' },
                    { value: 'equity', label: 'Eigenkapital' },
                    { value: 'loan', label: 'Kredit' },
                  ]}
                />
                {source !== 'unassigned' && (
                  <Select
                    label="Konto / Kredit"
                    value={account}
                    onChange={setAccount}
                    data={(accounts || []).map((x: Row) => ({
                      value: String(x.id),
                      label: x.name,
                    }))}
                  />
                )}
                <Group justify="flex-end">
                  <Button
                    disabled={busy || !terms.data?.discount}
                    loading={busy}
                    onClick={() => void action('pay')}
                  >
                    Mit Skonto bezahlen
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}
        </>
      )}
    </Stack>
  );
}

function Knowledge() {
  const q = useCompanion(),
    [search, setSearch] = useState(''),
    [context, setContext] = useState(''),
    [answer, setAnswer] = useState(''),
    [busy, setBusy] = useState(false),
    ask = useConfirm();
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api('/api/ai/status') });
  async function explain() {
    if (!(await ask('Begriff und deinen Kontext zur Erklärung an ChatGPT senden?'))) return;
    setBusy(true);
    try {
      const result = await api(
        '/api/companion/glossary/explain',
        'POST',
        {
          term: search,
          context,
          consent: true,
          ...((window as any).PHBReactBridge?.ai.selection() || {}),
        },
        true,
      );
      setAnswer(result.answer);
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <SearchField
        placeholder="Begriff oder Werkzeug suchen"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Accordion multiple>
        {(q.data?.glossary || [])
          .filter((x: Row) =>
            (x.title + ' ' + x.body).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
          )
          .map((x: Row) => (
            <Accordion.Item value={x.title} key={x.title}>
              <Accordion.Control>{x.title}</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm">{x.body}</Text>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
      </Accordion>
      <Textarea
        label="Dein Vorhaben für eine passende Erklärung (optional)"
        value={context}
        onChange={(e) => setContext(e.currentTarget.value)}
      />
      <Button
        variant="default"
        disabled={!search.trim() || !ai.data?.sharing}
        loading={busy}
        onClick={() => void explain()}
      >
        Mit ChatGPT erklären
      </Button>
      {answer && (
        <Paper withBorder p="md">
          <Text style={{ whiteSpace: 'pre-wrap' }}>{answer}</Text>
        </Paper>
      )}
      <CompanionPanel kind="glossary" />
    </Stack>
  );
}

function Calculator() {
  const q = useCompanion(),
    cache = useQueryClient(),
    [length, setLength] = useState<number | string>(1),
    [width, setWidth] = useState<number | string>(1),
    [height, setHeight] = useState<number | string>(1),
    [waste, setWaste] = useState<number | string>(10),
    [pack, setPack] = useState<number | string>(1),
    [mode, setMode] = useState<string | null>('area'),
    [plan, setPlan] = useState<string | null>(null),
    [title, setTitle] = useState('Materialbedarf'),
    [busy, setBusy] = useState(false);
  const amount =
      Number(length) *
      Number(width) *
      (mode === 'volume' ? Number(height) : 1) *
      (1 + Number(waste) / 100),
    packs = Number(pack) > 0 ? Math.ceil(amount / Number(pack)) : 0;
  async function transfer() {
    if (!plan || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) return;
    setBusy(true);
    try {
      const result = await api('/api/self-work/' + plan);
      const materials = [
        ...result.plan.materials,
        {
          id: crypto.randomUUID(),
          title,
          quantity: Number(amount.toFixed(3)),
          unit: mode === 'volume' ? 'm³' : 'm²',
          unit_price: null,
          status: 'Benötigt',
          notes: `Berechnet mit ${waste} % Verschnitt; ${packs} Packungen à ${pack}.`,
        },
      ];
      await api('/api/self-work/' + plan, 'PATCH', { materials });
      await cache.invalidateQueries({ queryKey: ['self-work'] });
      await cache.invalidateQueries({ queryKey: ['companion-shopping'] });
      success('In Materialliste übernommen.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Select
        label="Berechnung"
        value={mode}
        onChange={setMode}
        data={[
          { value: 'area', label: 'Fläche' },
          { value: 'volume', label: 'Volumen' },
        ]}
      />
      <SimpleGrid cols={{ base: 2, sm: 3 }}>
        <NumberInput label="Länge (m)" min={0} value={length} onChange={setLength} />
        <NumberInput label="Breite (m)" min={0} value={width} onChange={setWidth} />
        {mode === 'volume' && (
          <NumberInput label="Höhe / Stärke (m)" min={0} value={height} onChange={setHeight} />
        )}
        <NumberInput label="Verschnitt (%)" min={0} max={100} value={waste} onChange={setWaste} />
        <NumberInput
          decimalSeparator=","
          thousandSeparator="."
          label={'Inhalt je Packung (' + (mode === 'volume' ? 'm³' : 'm²') + ')'}
          min={0.001}
          value={pack}
          onChange={setPack}
        />
      </SimpleGrid>
      <Paper withBorder p="md">
        <Text fw={650}>
          {amount.toLocaleString('de-DE', { maximumFractionDigits: 3 })}{' '}
          {mode === 'volume' ? 'm³' : 'm²'} · {packs} Packungen
        </Text>
      </Paper>
      <Button
        variant="subtle"
        leftSection={<IconClipboard size={15} />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              `${amount.toLocaleString('de-DE', { maximumFractionDigits: 3 })} ${mode === 'volume' ? 'm³' : 'm²'} · ${packs} Packungen`,
            );
            success('In Zwischenablage kopiert.');
          } catch (e) {
            error(e);
          }
        }}
      >
        Ergebnis kopieren
      </Button>
      <TextInput
        label="Materialbezeichnung"
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />
      <Select
        label="In Eigenleistung übernehmen"
        searchable
        clearable
        value={plan}
        onChange={setPlan}
        data={(q.data?.references.self_work || []).map((x: Row) => ({
          value: String(x.id),
          label: x.title,
        }))}
      />
      <Button
        disabled={
          !plan ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 10000000 ||
          Number(pack) <= 0 ||
          !title.trim()
        }
        loading={busy}
        onClick={() => void transfer()}
      >
        In Materialliste übernehmen
      </Button>
    </Stack>
  );
}

function Templates() {
  const q = useCompanion(),
    cache = useQueryClient(),
    ask = useConfirm(),
    [busy, setBusy] = useState(false);
  async function apply(id: string) {
    if (
      !(await ask(
        'Checkliste und ein neues Eigenleistungsvorhaben in dieses Projekt übernehmen? Vorhandene Daten bleiben erhalten.',
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/companion/templates/apply', 'POST', { template: id, confirm: true });
      await Promise.all(
        ['companion', 'work', 'work-sources', 'self-work', 'companion-overview'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
      success('Vorlage übernommen.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      {(q.data?.templates || []).map((t: Row) => (
        <Paper withBorder p="md" key={t.id}>
          <Title order={3}>{t.title}</Title>
          <Stack mt="sm" gap={5}>
            {t.steps.map((s: string) => (
              <Text key={s} size="sm">
                • {s}
              </Text>
            ))}
            <Button
              disabled={
                busy ||
                (q.data?.records || []).some(
                  (x: Row) => x.kind === 'template' && x.title === 'Vorlage:' + t.id,
                )
              }
              onClick={() => void apply(t.id)}
            >
              Vorlage übernehmen
            </Button>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

function FundingTools() {
  const comp = useCompanion(),
    q = useQuery({
      queryKey: ['companion-documents'],
      queryFn: () => api('/api/project-documents'),
    }),
    receipts = useQuery({ queryKey: ['companion-receipts'], queryFn: () => api('/api/receipts') }),
    [funding, setFunding] = useState<string | null>(null),
    [docs, setDocs] = useState<string[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  async function pack() {
    setBusy(true);
    try {
      await download(
        '/api/companion/package',
        {
          title: 'Foerdernachweise',
          document_ids: docs.map(Number),
          receipt_ids: ids.map(Number),
          summary:
            'Förderung: ' +
            (comp.data?.references.funding.find((x: Row) => String(x.id) === funding)?.title || ''),
        },
        'Foerdernachweise.zip',
      );
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <CompanionPanel kind="reminder" />
      <Paper withBorder p="md">
        <Stack>
          <Title order={3}>Nachweise zusammenstellen</Title>
          <Select
            label="Förderung"
            searchable
            value={funding}
            onChange={setFunding}
            data={(comp.data?.references.funding || []).map((x: Row) => ({
              value: String(x.id),
              label: x.title,
            }))}
          />
          <MultiSelect
            label="Unterlagen"
            searchable
            data={(q.data?.documents || []).map((x: Row) => ({
              value: String(x.id),
              label: x.title,
            }))}
            value={docs}
            onChange={setDocs}
          />
          <MultiSelect
            label="Rechnungen"
            searchable
            data={(receipts.data?.receipts || [])
              .filter((x: Row) => x.status === 'Gebucht')
              .map((x: Row) => ({
                value: String(x.id),
                label: (x.supplier || x.filename) + ' · ' + money(x.gross_amount),
              }))}
            value={ids}
            onChange={setIds}
          />
          <Group justify="flex-end">
            <Button
              disabled={!funding || (!docs.length && !ids.length)}
              loading={busy}
              onClick={() => void pack()}
            >
              Nachweispaket als ZIP
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

const views = [
  { value: 'shopping', label: 'Einkauf & Werkzeuge' },
  { value: 'journal', label: 'Bautagebuch' },
  { value: 'defect', label: 'Mängel & Abnahme' },
  { value: 'house', label: 'Hausakte & Übergabe' },
  { value: 'companies', label: 'Firmenchronik' },
  { value: 'changes', label: 'Nachträge & Versionsvergleich' },
  { value: 'terms', label: 'Skonto & Zahlungsfristen' },
  { value: 'liquidity', label: 'Liquiditätsvorschau' },
  { value: 'funding', label: 'Förderfristen & Nachweise' },
  { value: 'knowledge', label: 'Begriffe & Werkzeuge' },
  { value: 'tools', label: 'Mengenrechner' },
  { value: 'tiles', label: 'Fliesen-Verlegeplan' },
  { value: 'templates', label: 'Projektvorlagen' },
];
export function Workshop() {
  const [params, setParams] = useSearchParams(),
    view = params.get('tab') || 'shopping';
  return (
    <div className="page">
      <PageHeader
        title="Projektwerkstatt"
        description="Praktische Helfer für Planung, Ausführung und Übergabe."
      >
        <Select
          aria-label="Werkstattbereich"
          w={290}
          value={view}
          onChange={(v) => setParams({ tab: v || 'shopping' })}
          data={views}
        />
      </PageHeader>
      <Paper withBorder p="md">
        {view === 'shopping' ? (
          <Shopping />
        ) : view === 'journal' ? (
          <CompanionPanel kind="journal" />
        ) : view === 'defect' ? (
          <CompanionPanel kind="defect" />
        ) : view === 'house' ? (
          <House />
        ) : view === 'companies' ? (
          <Companies />
        ) : view === 'changes' ? (
          <VersionCompare />
        ) : view === 'terms' ? (
          <PaymentTerms />
        ) : view === 'liquidity' ? (
          <Liquidity />
        ) : view === 'funding' ? (
          <FundingTools />
        ) : view === 'knowledge' ? (
          <Knowledge />
        ) : view === 'tools' ? (
          <Calculator />
        ) : view === 'tiles' ? (
          <TilePlanner />
        ) : view === 'templates' ? (
          <Templates />
        ) : (
          <Text>Bitte einen Bereich auswählen.</Text>
        )}
      </Paper>
    </div>
  );
}

export function GlobalTools() {
  const [opened, setOpened] = useState(false),
    [search, setSearch] = useState(''),
    [favs, setFavs] = useState<Row[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('phb-favs:' + projectID) || '[]');
      } catch {
        return [];
      }
    }),
    [recent, setRecent] = useState<Row[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('phb-recent:' + projectID) || '[]');
      } catch {
        return [];
      }
    });
  const q = useQuery({
      queryKey: ['companion-search'],
      enabled: opened,
      queryFn: () => api('/api/companion/search'),
      staleTime: 0,
    }),
    navigate = useNavigate(),
    work = useWorkActions();
  useEffect(() => {
    const canOpen = () =>
      !Array.from(document.querySelectorAll('[role=dialog],dialog[open]')).some(
        (node) => node.getClientRects().length > 0,
      );
    const key = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setOpened((v) => (v ? false : canOpen()));
        }
      },
      open = () => {
        if (canOpen()) setOpened(true);
      };
    window.addEventListener('keydown', key);
    window.addEventListener('phb-command-open', open);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('phb-command-open', open);
    };
  }, []);
  function go(item: Row) {
    setOpened(false);
    setSearch('');
    const rows = [item, ...recent.filter((x) => x.url !== item.url)].slice(0, 12);
    setRecent(rows);
    localStorage.setItem('phb-recent:' + projectID, JSON.stringify(rows));
    navigate(item.url);
  }
  function favorite(item: Row) {
    const rows = favs.some((x) => x.url === item.url)
      ? favs.filter((x) => x.url !== item.url)
      : [item, ...favs];
    setFavs(rows);
    localStorage.setItem('phb-favs:' + projectID, JSON.stringify(rows));
  }
  const items = search.trim()
    ? (q.data?.items || [])
        .filter((x: Row) =>
          (x.title + ' ' + x.kind).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .slice(0, 50)
    : [...favs, ...recent.filter((x) => !favs.some((f) => f.url === x.url))];
  return (
    <>
      <Tooltip label="Suche & Schnellerfassung (Strg / ⌘ K)">
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Suche und Schnellerfassung"
          onClick={() => setOpened(true)}
        >
          <IconSearch size={18} />
        </ActionIcon>
      </Tooltip>
      <Editor
        opened={opened}
        onClose={() => setOpened(false)}
        title="Suche & Schnellerfassung"
        size="lg"
      >
        <Stack>
          <SearchField
            placeholder="Firma, Rechnung, Dokument oder Termin suchen"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            data-autofocus
          />
          <Group gap="xs">
            <Button
              size="compact-sm"
              onClick={() => {
                setOpened(false);
                work.create('todo');
              }}
            >
              To-do
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => {
                setOpened(false);
                work.create('note');
              }}
            >
              Notiz
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => go({ title: 'Neuer Termin', url: '/?new_event=1' })}
            >
              Termin
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => go({ title: 'Beleg erfassen', url: '/belege?upload=1' })}
            >
              Beleg
            </Button>
            <Button
              size="compact-sm"
              variant="default"
              onClick={() => go({ title: 'Mengenrechner', url: '/projektwerkstatt?tab=tools' })}
            >
              Rechner
            </Button>
          </Group>
          <ErrorBox value={q.error} />
          {!search && <CheckpointButton />}
          <div className="companion-command-results">
            {items.map((x: Row) => (
              <Group key={x.url} wrap="nowrap" justify="space-between">
                <UnstyledButton className="companion-command-item" onClick={() => go(x)}>
                  <Text size="sm" fw={600}>
                    {x.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {x.kind || (favs.some((f) => f.url === x.url) ? 'Favorit' : 'Zuletzt geöffnet')}
                  </Text>
                </UnstyledButton>
                <ActionIcon
                  variant="subtle"
                  aria-label={'Favorit: ' + x.title}
                  onClick={() => favorite(x)}
                >
                  <IconStar
                    size={16}
                    fill={favs.some((f) => f.url === x.url) ? 'currentColor' : 'none'}
                  />
                </ActionIcon>
              </Group>
            ))}
          </div>
          {!search && !items.length && (
            <Text size="sm" c="dimmed">
              Suche nach einem Eintrag und markiere häufig benötigte Treffer als Favoriten.
            </Text>
          )}
        </Stack>
      </Editor>
    </>
  );
}

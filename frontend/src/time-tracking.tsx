import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconClock,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUser,
  IconBuilding,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Editor, ErrorBox, api, error, success, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { FilterSelect, SearchField, useViewState } from './ui';
import { SortSelect, compareText } from './list-sorting';
import { useDirtyGuard } from './shell';
import './time-tracking.css';

type Person = {
  id: number;
  kind: string;
  name: string;
  role: string;
  notes: string;
  contractor_id: number | null;
  company_name: string;
  total_minutes: number;
  entry_count: number;
  last_date: string;
};
type Entry = {
  id: number;
  person_id: number;
  worked_on: string;
  minutes: number;
  description: string;
};
type PersonForm = {
  kind: string;
  name: string;
  role: string;
  contractor_id: string | null;
  notes: string;
};
const emptyPerson: PersonForm = {
  kind: 'person',
  name: '',
  role: '',
  contractor_id: null,
  notes: '',
};
const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)} Std.${minutes % 60 ? ' ' + (minutes % 60) + ' Min.' : ''}`;
const dayLabel = (value: string) =>
  new Intl.DateTimeFormat(navigator.language || 'de-DE').format(new Date(value + 'T12:00:00'));

export function TimeTracking() {
  const cache = useQueryClient(),
    ask = useConfirm();
  const [sort, setSort] = useViewState('time-sort', 'az');
  const [search, setSearch] = useState(''),
    [kind, setKind] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [personEditor, setPersonEditor] = useState(false),
    [editingPerson, setEditingPerson] = useState<number | null>(null);
  const [entryEditor, setEntryEditor] = useState(false),
    [editingEntry, setEditingEntry] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const people = useQuery({
    queryKey: ['time-tracking'],
    queryFn: () =>
      api<{ people: Person[]; companies: { id: number; name: string }[] }>('/api/time-tracking'),
  });
  const details = useQuery({
    queryKey: ['time-person', selected],
    enabled: selected !== null,
    queryFn: () => api<{ person: Person; entries: Entry[] }>('/api/time-people/' + selected),
  });
  const person = details.data?.person;
  const personForm = useForm<PersonForm>({
    initialValues: emptyPerson,
    validate: {
      name: (value, values) =>
        values.kind === 'person' && !value.trim() ? 'Bitte einen Namen angeben.' : null,
      contractor_id: (value, values) =>
        values.kind === 'company' && !value ? 'Bitte eine Firma auswählen.' : null,
    },
  });
  const entryForm = useForm({
    initialValues: {
      worked_on: new Date().toLocaleDateString('sv-SE'),
      hours: 1 as number | string,
      minutes: 0 as number | string,
      description: '',
    },
    validate: {
      worked_on: (value) => (!value ? 'Bitte ein Datum angeben.' : null),
      hours: (value, values) =>
        !Number.isInteger(Number(value)) ||
        Number(value) < 0 ||
        Number(value) > 24 ||
        Number(value) * 60 + Number(values.minutes) < 1 ||
        Number(value) * 60 + Number(values.minutes) > 1440
          ? 'Bitte eine Dauer zwischen einer Minute und 24 Stunden angeben.'
          : null,
      minutes: (value) =>
        !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 59
          ? 'Bitte 0 bis 59 Minuten angeben.'
          : null,
    },
  });
  useDirtyGuard((personEditor && personForm.isDirty()) || (entryEditor && entryForm.isDirty()));
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ['time-tracking'] }),
      cache.invalidateQueries({ queryKey: ['time-person'] }),
    ]);
  function openPerson(record?: Person) {
    setFailure(null);
    setEditingPerson(record?.id || null);
    const values = record
      ? {
          kind: record.kind,
          name: record.name,
          role: record.role,
          notes: record.notes,
          contractor_id: record.contractor_id ? String(record.contractor_id) : null,
        }
      : { ...emptyPerson };
    personForm.setValues(values);
    personForm.resetDirty(values);
    personForm.clearErrors();
    setPersonEditor(true);
  }
  function openEntry(record?: Entry) {
    setFailure(null);
    setEditingEntry(record?.id || null);
    const values = {
      worked_on: record?.worked_on || new Date().toLocaleDateString('sv-SE'),
      hours: record ? Math.floor(record.minutes / 60) : 1,
      minutes: record ? record.minutes % 60 : 0,
      description: record?.description || '',
    };
    entryForm.setValues(values);
    entryForm.resetDirty(values);
    entryForm.clearErrors();
    setEntryEditor(true);
  }
  async function savePerson() {
    if (personForm.validate().hasErrors) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api<{ person: Person }>(
        '/api/time-people' + (editingPerson ? '/' + editingPerson : ''),
        editingPerson ? 'PATCH' : 'POST',
        {
          ...personForm.values,
          contractor_id: personForm.values.contractor_id
            ? Number(personForm.values.contractor_id)
            : null,
        },
      );
      await refresh();
      personForm.resetDirty();
      setPersonEditor(false);
      setSelected(result.person.id);
      success('Gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveEntry() {
    if (entryForm.validate().hasErrors || selected === null) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/time-entries' + (editingEntry ? '/' + editingEntry : ''),
        editingEntry ? 'PATCH' : 'POST',
        {
          person_id: selected,
          worked_on: entryForm.values.worked_on,
          minutes: Number(entryForm.values.hours) * 60 + Number(entryForm.values.minutes),
          description: entryForm.values.description,
        },
      );
      await refresh();
      entryForm.resetDirty();
      setEntryEditor(false);
      success('Stunden gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function removeEntry(entry: Entry) {
    if (
      !(await ask(
        `Stundeneintrag vom ${dayLabel(entry.worked_on)} mit ${duration(entry.minutes)} löschen?`,
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/time-entries/' + entry.id, 'DELETE');
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function removePerson() {
    if (
      !person ||
      !(await ask(
        `„${person.name}“ und ${person.entry_count ? 'alle ' + person.entry_count + ' zugehörigen Stundeneinträge (' + duration(person.total_minutes) + ')' : 'diesen Eintrag'} endgültig löschen?`,
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/time-people/' + person.id, 'DELETE');
      setSelected(null);
      await refresh();
      success('Gelöscht.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  const filtered = (people.data?.people || []).filter(
    (p) =>
      (!kind || p.kind === kind) &&
      [p.name, p.role, p.company_name].some((value) =>
        value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
  );
  filtered.sort((a, b) => {
    if (sort === 'newest' || sort === 'oldest') return (a.id - b.id) * (sort === 'newest' ? -1 : 1);
    if (sort === 'most-hours' || sort === 'least-hours')
      return (
        (a.total_minutes - b.total_minutes) * (sort === 'most-hours' ? -1 : 1) ||
        compareText(a.name, b.name)
      );
    return compareText(a.name, b.name) * (sort === 'za' ? -1 : 1);
  });
  const companies = (people.data?.companies || []).map((c) => ({
    value: String(c.id),
    label: c.name,
  }));
  return (
    <div className="page time-tracking-page">
      <PageHeader
        title="Stundenerfassung"
        description="Eigene Arbeit, Helfer und Firmen – geleistete Zeit im Projekt festhalten."
      >
        <Button leftSection={<IconPlus size={16} />} onClick={() => openPerson()}>
          Person oder Firma hinzufügen
        </Button>
      </PageHeader>
      <ErrorBox value={people.error} />
      <Paper withBorder radius="md" p="sm" mb="md">
        <Group gap="sm" wrap="nowrap">
          <SearchField
            placeholder="Person oder Firma suchen"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <FilterSelect
            aria-label="Art filtern"
            placeholder="Alle Personen & Firmen"
            data={[
              { value: 'person', label: 'Personen' },
              { value: 'company', label: 'Firmen' },
            ]}
            value={kind}
            onChange={setKind}
            clearable
            style={{ width: 210 }}
          />
          <SortSelect
            value={sort}
            onChange={setSort}
            extra={[
              { value: 'most-hours', label: 'Meiste Stunden' },
              { value: 'least-hours', label: 'Wenigste Stunden' },
            ]}
          />
        </Group>
      </Paper>
      {people.isPending ? (
        <Loader aria-label="Stundenerfassung wird geladen" />
      ) : (
        <div className="time-card-container">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="sm">
            {filtered.map((p) => (
              <UnstyledButton
                key={p.id}
                className="time-person-card"
                onClick={() => setSelected(p.id)}
                aria-label={'Stunden anzeigen: ' + p.name}
              >
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text fw={650} truncate>
                    {p.name}
                  </Text>
                  {p.kind === 'company' ? (
                    <IconBuilding size={18} aria-hidden />
                  ) : (
                    <IconUser size={18} aria-hidden />
                  )}
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {[
                    p.kind === 'company' ? 'Firma' : p.role || 'Person',
                    p.kind === 'person' ? p.company_name : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Group justify="space-between" mt="sm">
                  <Text fw={700} className="time-card-total">
                    {duration(p.total_minutes)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {p.entry_count} {p.entry_count === 1 ? 'Eintrag' : 'Einträge'}
                  </Text>
                </Group>
              </UnstyledButton>
            ))}
          </SimpleGrid>
          {!filtered.length && (
            <Text c="dimmed" p="lg" ta="center">
              {search || kind
                ? 'Keine passenden Personen oder Firmen.'
                : 'Noch keine Stunden erfasst. Lege zuerst dich selbst, einen Helfer oder eine Firma an.'}
            </Text>
          )}
        </div>
      )}
      <Editor
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={person?.name || 'Stundenübersicht'}
        size="lg"
        busy={busy}
        suspended={personEditor || entryEditor}
        zIndex={200}
        headerActions={
          person && (
            <>
              <Tooltip label="Person oder Firma bearbeiten">
                <ActionIcon
                  variant="subtle"
                  aria-label="Person oder Firma bearbeiten"
                  onClick={() => openPerson(person)}
                  disabled={busy}
                >
                  <IconPencil size={17} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Person oder Firma löschen">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Person oder Firma löschen"
                  onClick={() => void removePerson()}
                  disabled={busy}
                >
                  <IconTrash size={17} />
                </ActionIcon>
              </Tooltip>
            </>
          )
        }
      >
        <ErrorBox value={details.error} />
        {details.isPending ? (
          <Loader />
        ) : (
          person && (
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <div>
                  <Group gap="xs">
                    <IconClock size={20} />
                    <Text fw={700} size="xl">
                      {duration(person.total_minutes)}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Geleistete Gesamtzeit · {person.entry_count}{' '}
                    {person.entry_count === 1 ? 'Eintrag' : 'Einträge'}
                  </Text>
                </div>
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={() => openEntry()}
                  disabled={busy}
                >
                  Stunden erfassen
                </Button>
              </Group>
              {(person.role || person.company_name) && (
                <Text size="sm" c="dimmed">
                  {[person.role, person.company_name].filter(Boolean).join(' · ')}
                </Text>
              )}
              {person.notes && (
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {person.notes}
                </Text>
              )}
              <div className="time-entry-list">
                {details.data?.entries.length ? (
                  details.data.entries.map((entry) => (
                    <Paper key={entry.id} withBorder radius="sm" p="sm" className="time-entry">
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <Group gap="sm">
                          <Text size="sm" fw={600}>
                            {dayLabel(entry.worked_on)}
                          </Text>
                          <Badge variant="light">{duration(entry.minutes)}</Badge>
                        </Group>
                        <Group gap={4} wrap="nowrap">
                          <Tooltip label="Stundeneintrag bearbeiten">
                            <ActionIcon
                              variant="subtle"
                              aria-label={'Stundeneintrag bearbeiten: ' + dayLabel(entry.worked_on)}
                              onClick={() => openEntry(entry)}
                              disabled={busy}
                            >
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Stundeneintrag löschen">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={'Stundeneintrag löschen: ' + dayLabel(entry.worked_on)}
                              onClick={() => void removeEntry(entry)}
                              disabled={busy}
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                      {entry.description && (
                        <Text
                          mt={4}
                          size="sm"
                          style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                        >
                          {entry.description}
                        </Text>
                      )}
                    </Paper>
                  ))
                ) : (
                  <Text c="dimmed" size="sm" py="lg" ta="center">
                    Noch keine Stundeneinträge. Über „Stunden erfassen“ kannst du den ersten Eintrag
                    anlegen.
                  </Text>
                )}
              </div>
            </Stack>
          )
        )}
      </Editor>
      <Editor
        opened={personEditor}
        onClose={() => setPersonEditor(false)}
        dirty={personForm.isDirty()}
        busy={busy}
        title={editingPerson ? 'Person oder Firma bearbeiten' : 'Person oder Firma hinzufügen'}
        zIndex={220}
      >
        <form onSubmit={personForm.onSubmit(() => void savePerson())}>
          <Stack gap="sm">
            <ErrorBox value={failure} />
            <Select
              label="Erfassen für"
              allowDeselect={false}
              data={[
                { value: 'person', label: 'Person' },
                { value: 'company', label: 'Firma aus Stammdaten' },
              ]}
              {...personForm.getInputProps('kind')}
            />
            {personForm.values.kind === 'person' && (
              <>
                <TextInput
                  label="Name"
                  placeholder="Zum Beispiel ich selbst oder ein Helfer"
                  required
                  maxLength={160}
                  {...personForm.getInputProps('name')}
                />
                <TextInput
                  label="Rolle (optional)"
                  placeholder="Zum Beispiel Helfer, Architektin, eigene Arbeit"
                  maxLength={80}
                  {...personForm.getInputProps('role')}
                />
              </>
            )}
            <Select
              label={
                personForm.values.kind === 'company'
                  ? 'Firma aus Stammdaten'
                  : 'Firma aus Stammdaten (optional)'
              }
              required={personForm.values.kind === 'company'}
              searchable
              clearable
              data={companies}
              nothingFoundMessage="Keine Firma gefunden"
              {...personForm.getInputProps('contractor_id')}
            />
            <Textarea
              label="Notizen (optional)"
              minRows={3}
              maxLength={3000}
              {...personForm.getInputProps('notes')}
            />
            <Group justify="flex-end" mt="sm">
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={entryEditor}
        onClose={() => setEntryEditor(false)}
        dirty={entryForm.isDirty()}
        busy={busy}
        title={editingEntry ? 'Stundeneintrag bearbeiten' : 'Stunden erfassen'}
        zIndex={220}
      >
        <form onSubmit={entryForm.onSubmit(() => void saveEntry())}>
          <Stack gap="sm">
            <ErrorBox value={failure} />
            <Text size="sm" c="dimmed">
              {person?.name}
            </Text>
            <TextInput
              type="date"
              label="Datum"
              required
              {...entryForm.getInputProps('worked_on')}
            />
            <SimpleGrid cols={2}>
              <NumberInput
                label="Stunden"
                min={0}
                max={24}
                allowDecimal={false}
                {...entryForm.getInputProps('hours')}
              />
              <NumberInput
                label="Minuten"
                min={0}
                max={59}
                allowDecimal={false}
                {...entryForm.getInputProps('minutes')}
              />
            </SimpleGrid>
            <Textarea
              label="Tätigkeit (optional)"
              minRows={3}
              maxLength={2000}
              {...entryForm.getInputProps('description')}
            />
            <Group justify="flex-end" mt="sm">
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        </form>
      </Editor>
    </div>
  );
}

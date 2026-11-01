import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash, IconSearch } from '@tabler/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, Editor, ErrorBox, Row, success, useConfirm, error } from './core';
import { useDirtyGuard } from './shell';
const initial: Row = {
  kind: 'todo',
  title: '',
  body: '',
  due_on: '',
  done: false,
  source_type: '',
  source_id: null,
};
export function SourceWork({ type, id }: { type: string; id: number }) {
  const [active, setActive] = useState<string | null>(null),
    navigate = useNavigate();
  const query = useQuery({
    queryKey: ['work', type, id],
    queryFn: () => api('/api/project-work?source_type=' + type + '&source_id=' + id),
    enabled: active === 'work',
  });
  return (
    <Accordion value={active} onChange={setActive} variant="contained">
      <Accordion.Item value="work">
        <Accordion.Control>To-dos & Notizen</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            <ErrorBox value={query.error} />
            {(query.data?.items || []).map((item: Row) => (
              <Group key={item.id} justify="space-between">
                <Text size="sm" td={item.done ? 'line-through' : undefined}>
                  {item.kind === 'note' ? 'Notiz: ' : ''}
                  {item.title}
                </Text>
                <Badge variant="light">
                  {item.kind === 'note' ? 'Notiz' : item.done ? 'Erledigt' : 'Offen'}
                </Badge>
              </Group>
            ))}
            {!query.isPending && !query.data?.items?.length && (
              <Text size="sm" c="dimmed">
                Noch keine Einträge.
              </Text>
            )}
            <Button
              size="xs"
              variant="light"
              onClick={() =>
                navigate('/aufgaben?source_type=' + type + '&source_id=' + id + '&new=todo')
              }
            >
              To-do oder Notiz hinzufügen
            </Button>
            <Button size="xs" variant="subtle" onClick={() => navigate('/aufgaben')}>
              Alle Einträge öffnen
            </Button>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
export function WorkPage() {
  const query = useQuery({
      queryKey: ['work'],
      queryFn: () => api('/api/project-work'),
      staleTime: 0,
    }),
    sources = useQuery({
      queryKey: ['work-sources'],
      queryFn: () => api('/api/project-work/sources'),
      staleTime: 0,
    });
  const cache = useQueryClient(),
    ask = useConfirm(),
    navigate = useNavigate(),
    [params] = useSearchParams();
  const [opened, setOpened] = useState(false),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [search, setSearch] = useState(''),
    [tab, setTab] = useState<string | null>('todo'),
    [showDone, setShowDone] = useState(false),
    [pending, setPending] = useState<{ id: number; done: boolean } | null>(null);
  const form = useForm<Row>({ initialValues: initial }),
    handled = useRef('');
  useDirtyGuard(opened && form.isDirty());
  function open(row?: Row) {
    const values = { ...initial, ...row };
    setID(row?.id || null);
    form.setValues(values);
    form.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  useEffect(() => {
    const token = params.toString();
    if (params.get('new') && sources.data && !sources.isFetching && handled.current !== token) {
      handled.current = token;
      const type = params.get('source_type') || '',
        ident = Number(params.get('source_id'));
      const found = sources.data.sources.find((x: Row) => x.type === type && x.id === ident);
      open({
        ...initial,
        kind: params.get('new') === 'note' ? 'note' : 'todo',
        source_type: found ? type : '',
        source_id: found ? ident : null,
      });
      if (type && !found)
        setFailure(
          Error('Die verknüpfte Quelle ist nicht mehr vorhanden. Bitte die Zuordnung prüfen.'),
        );
    }
  }, [params, sources.data, sources.isFetching]);
  async function save(remove = false) {
    if (busy) return;
    if (remove && !(await ask('Diesen Eintrag endgültig löschen?'))) return;
    setBusy(true);
    setFailure(null);
    try {
      const values = form.values;
      await api(
        '/api/project-work' + (id ? '/' + id : ''),
        remove ? 'DELETE' : id ? 'PATCH' : 'POST',
        remove
          ? undefined
          : {
              kind: values.kind,
              title: values.title,
              body: values.body,
              due_on: values.due_on,
              done: values.done,
              source_type: values.source_type,
              source_id: values.source_id,
            },
      );
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['work'] });
      success(remove ? 'Eintrag gelöscht.' : 'Eintrag gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(item: Row) {
    if (pending) return;
    setPending({ id: item.id, done: !item.done });
    try {
      await api('/api/project-work/' + item.id, 'PATCH', { done: !item.done });
      await cache.invalidateQueries({ queryKey: ['work'] });
    } catch (e) {
      error(e);
    } finally {
      setPending(null);
    }
  }
  const rows = (query.data?.items || [])
    .filter(
      (x: Row) =>
        x.kind === tab &&
        (showDone || !x.done) &&
        [x.title, x.body, x.source_label].some((v) =>
          String(v || '')
            .toLocaleLowerCase('de')
            .includes(search.toLocaleLowerCase('de')),
        ),
    )
    .sort(
      (a: Row, b: Row) =>
        Number(a.done) - Number(b.done) ||
        (a.due_on || '9999').localeCompare(b.due_on || '9999') ||
        b.id - a.id,
    );
  const choices = (sources.data?.sources || []).map((x: Row) => ({
    value: x.type + ':' + x.id,
    label: x.label,
  }));
  const selected = form.values.source_type
    ? form.values.source_type + ':' + form.values.source_id
    : null;
  if (selected && !choices.some((x: Row) => x.value === selected))
    choices.push({
      value: selected,
      label: form.values.source_label || 'Frühere Quelle (nicht mehr vorhanden)',
    });
  return (
    <div className="page">
      <Group className="page-header" justify="space-between">
        <div>
          <Title order={1}>To-dos & Notizen</Title>
          <Text c="dimmed" size="sm">
            Alles Wichtige festhalten – frei oder mit deinem Bauprojekt verknüpft.
          </Text>
        </div>
        <Button
          leftSection={<IconPlus size={17} />}
          onClick={() => open({ ...initial, kind: tab })}
        >
          Eintrag anlegen
        </Button>
      </Group>
      <ErrorBox value={query.error || sources.error} />
      <Paper className="paper">
        <Group justify="space-between" mb="md">
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List>
              <Tabs.Tab value="todo">To-dos</Tabs.Tab>
              <Tabs.Tab value="note">Notizen</Tabs.Tab>
            </Tabs.List>
          </Tabs>
          <TextInput
            aria-label="Einträge suchen"
            placeholder="Einträge suchen"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Group>
        {tab === 'todo' && (
          <Checkbox
            label="Erledigte anzeigen"
            checked={showDone}
            onChange={(e) => setShowDone(e.currentTarget.checked)}
            mb="md"
          />
        )}
        <Stack gap="sm">
          {rows.map((item: Row) => (
            <Paper withBorder p="md" radius="md" key={item.id}>
              <Group align="start" wrap="nowrap">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group wrap="nowrap">
                    {item.kind === 'todo' && (
                      <Checkbox
                        aria-label={
                          item.done
                            ? 'To-do wieder öffnen: ' + item.title
                            : 'To-do abschließen: ' + item.title
                        }
                        checked={pending && pending.id === item.id ? pending.done : item.done}
                        disabled={pending !== null}
                        onChange={() => toggle(item)}
                      />
                    )}
                    <Text
                      fw={600}
                      td={item.done ? 'line-through' : undefined}
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {item.title}
                    </Text>
                  </Group>
                  {item.body && (
                    <Text
                      size="sm"
                      mt="sm"
                      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {item.body}
                    </Text>
                  )}
                  <Group gap="xs" mt="sm">
                    {item.due_on && (
                      <Badge
                        variant="light"
                        color={
                          !item.done && item.due_on < new Date().toLocaleDateString('sv-SE')
                            ? 'red'
                            : 'gray'
                        }
                      >
                        Fällig {item.due_on}
                      </Badge>
                    )}
                    {item.source_type && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={!item.source_url}
                        onClick={() => navigate(item.source_url)}
                      >
                        {item.source_label}
                        {item.source_missing ? ' · Quelle entfernt' : ''}
                      </Button>
                    )}
                  </Group>
                </div>
                <Tooltip label="Bearbeiten">
                  <ActionIcon
                    variant="subtle"
                    aria-label={'Eintrag bearbeiten: ' + item.title}
                    onClick={() => open(item)}
                  >
                    <IconPencil size={17} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Paper>
          ))}
          {!rows.length && (
            <Text c="dimmed" size="sm">
              {query.isPending ? 'Einträge werden geladen …' : 'Keine passenden Einträge.'}
            </Text>
          )}
        </Stack>
      </Paper>
      <Editor
        title={id ? 'Eintrag bearbeiten' : 'Eintrag anlegen'}
        opened={opened}
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
            <Select
              label="Art"
              data={[
                { value: 'todo', label: 'To-do' },
                { value: 'note', label: 'Notiz' },
              ]}
              {...form.getInputProps('kind')}
            />
            <TextInput label="Titel" required maxLength={200} {...form.getInputProps('title')} />
            <Textarea
              label="Notizen / Details"
              minRows={4}
              maxLength={10000}
              {...form.getInputProps('body')}
            />
            {form.values.kind === 'todo' && (
              <>
                <TextInput
                  label="Fällig am (optional)"
                  type="date"
                  {...form.getInputProps('due_on')}
                />
                <Checkbox label="Erledigt" {...form.getInputProps('done', { type: 'checkbox' })} />
              </>
            )}
            <Select
              label="Verknüpfung (optional)"
              searchable
              clearable
              data={choices}
              value={selected}
              onChange={(v) => {
                const [type, ident] = (v || '').split(':');
                form.setValues({
                  source_type: type || '',
                  source_id: ident ? Number(ident) : null,
                });
              }}
            />
            <ErrorBox value={failure} />
            <div className="actions">
              {id && (
                <Button
                  color="red"
                  variant="subtle"
                  leftSection={<IconTrash size={16} />}
                  mr="auto"
                  onClick={() => save(true)}
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

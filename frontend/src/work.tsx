import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
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
import { useForm } from '@mantine/form';
import {
  IconArchive,
  IconArchiveOff,
  IconListCheck,
  IconNotes,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  api,
  Editor,
  EditorCoveredContext,
  error,
  ErrorBox,
  Row,
  success,
  useConfirm,
  useModalLayer,
} from './core';
import { useDirtyGuard } from './shell';

type Source = { type: string; id: number; label?: string };
const initial: Row = {
  kind: 'todo',
  title: '',
  body: '',
  due_on: '',
  done: false,
  source_type: '',
  source_id: null,
};
const WorkContext = createContext<any>(null);
const useWork = () => useContext(WorkContext);
const matches = (row: Row, source: Source) =>
  row.source_type === source.type && row.source_id === source.id;

/** One editor and source-list dialog, shared by native pages and embedded workflows. */
export function WorkProvider({ children }: { children: React.ReactNode }) {
  const query = useQuery({
    queryKey: ['work'],
    queryFn: () => api('/api/project-work'),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const sources = useQuery({
    queryKey: ['work-sources'],
    queryFn: () => api('/api/project-work/sources'),
    staleTime: 20000,
  });
  const cache = useQueryClient(),
    ask = useConfirm(),
    navigate = useNavigate(),
    confirming = useModalLayer().blocked;
  const [source, setSource] = useState<Source | null>(null),
    [item, setItem] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [listTab, setListTab] = useState<string | null>('todo'),
    [archived, setArchived] = useState(false);
  const form = useForm<Row>({ initialValues: initial });
  const location = useLocation();
  useLayoutEffect(() => {
    setSource(null);
    setItem(null);
  }, [location.pathname]);
  const [pendingDone, setPendingDone] = useState<{ id: number; done: boolean } | null>(null);
  const rows: Row[] = query.data?.items || [];
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const locking = useRef(false);
  useDirtyGuard(!!item && form.isDirty());
  const sourceInfo =
    source && sources.data?.sources.find((x: Row) => x.type === source.type && x.id === source.id);
  function edit(row: Row) {
    if (locking.current) return;
    const values = { ...initial, ...row };
    form.setValues(values);
    form.setInitialValues(values);
    form.resetDirty(values);
    setFailure(null);
    setItem(values);
  }
  function create(kind: string, from?: Source) {
    edit({ ...initial, kind, source_type: from?.type || '', source_id: from?.id || null });
  }
  function open(from: Source) {
    if (!from.type || !Number.isSafeInteger(from.id) || from.id <= 0 || locking.current) return;
    setSource(from);
    setArchived(false);
    setListTab('todo');
    query.refetch();
    sources.refetch();
  }
  async function changed() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['work'] }),
      cache.invalidateQueries({ queryKey: ['projects'] }),
    ]);
  }
  async function mutate(row: Row, operation: 'done' | 'archive' | 'delete') {
    if (locking.current) return;
    locking.current = true;
    setBusy(true);
    if (operation === 'done') setPendingDone({ id: row.id, done: !row.done });
    try {
      if (operation === 'delete' && !(await ask('„' + row.title + '“ endgültig löschen?')))
        return false;
      await api(
        '/api/project-work/' + row.id,
        operation === 'delete' ? 'DELETE' : 'PATCH',
        operation === 'delete'
          ? undefined
          : operation === 'done'
            ? { done: !row.done }
            : { archived: !row.archived },
      );
      await changed();
      success(
        operation === 'delete'
          ? 'Eintrag gelöscht.'
          : operation === 'archive'
            ? row.archived
              ? 'Eintrag wiederhergestellt.'
              : 'Eintrag archiviert.'
            : row.done
              ? 'To-do wieder geöffnet.'
              : 'To-do erledigt.',
      );
      return true;
    } catch (e) {
      error(e);
      return false;
    } finally {
      locking.current = false;
      setBusy(false);
      setPendingDone(null);
    }
  }
  async function save() {
    if (locking.current) return;
    locking.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const v = form.values;
      await api(
        '/api/project-work' + (item?.id ? '/' + item.id : ''),
        item?.id ? 'PATCH' : 'POST',
        {
          kind: v.kind,
          title: v.title,
          body: v.body,
          due_on: v.due_on,
          done: v.done,
          source_type: v.source_type,
          source_id: v.source_id,
        },
      );
      setItem(null);
      await changed();
      success(v.kind === 'note' ? 'Notiz gespeichert.' : 'To-do gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      locking.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const bridge = {
      open: (type: string, id: number) => open({ type, id: Number(id) }),
      items: () => rowsRef.current,
    };
    (window as any).PHBWork = bridge;
    return () => {
      if ((window as any).PHBWork === bridge) delete (window as any).PHBWork;
    };
  }, []);
  useEffect(() => {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe.workflow-frame')) {
      try {
        frame.contentDocument?.dispatchEvent(new CustomEvent('phb-work-changed'));
      } catch {}
    }
  }, [query.data]);
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
      label: form.values.source_label || 'Verknüpfte Quelle (wird geprüft)',
    });
  const note = form.values.kind === 'note';
  return (
    <WorkContext.Provider
      value={{
        rows,
        query,
        sources,
        open,
        edit,
        create,
        mutate,
        busy,
        pendingDone,
        goToSource: (url: string) => {
          setSource(null);
          navigate(url);
        },
      }}
    >
      <EditorCoveredContext.Provider value={!!source || !!item}>
        {children}
      </EditorCoveredContext.Provider>
      <Modal
        opened={!!source}
        title="To-dos & Notizen"
        size="lg"
        zIndex={260}
        centered
        onClose={() => {
          if (!item && !busy) setSource(null);
        }}
        closeOnClickOutside={false}
        closeOnEscape={!item && !busy && !confirming}
        trapFocus={!item && !confirming}
        closeButtonProps={{ 'aria-label': 'Schließen', disabled: !!item || busy }}
      >
        {source && (
          <Stack>
            <Text size="sm" c="dimmed">
              {sourceInfo?.label || source.label || 'Verknüpfte Einträge'}
            </Text>
            <CreateButtons
              disabled={busy}
              onCreate={(kind) => {
                setListTab(kind);
                setArchived(false);
                create(kind, source);
              }}
            />
            <Group justify="space-between">
              <WorkTabs value={listTab} onChange={setListTab} />
              <Checkbox
                label="Archiv anzeigen"
                checked={archived}
                onChange={(e) => setArchived(e.currentTarget.checked)}
              />
            </Group>
            <ErrorBox value={query.error || sources.error} />
            <WorkRows
              rows={rows.filter(
                (x) => matches(x, source) && x.kind === listTab && !!x.archived === archived,
              )}
              loading={query.isPending}
            />
          </Stack>
        )}
      </Modal>
      <Editor
        title={
          note
            ? item?.id
              ? 'Notiz bearbeiten'
              : 'Neue Notiz'
            : item?.id
              ? 'To-do bearbeiten'
              : 'Neues To-do'
        }
        opened={!!item}
        dirty={form.isDirty()}
        changes={form.values}
        original={form.getInitialValues()}
        busy={busy}
        onClose={() => setItem(null)}
        zIndex={280}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Stack>
            <TextInput label="Titel" required maxLength={200} {...form.getInputProps('title')} />
            <Textarea
              label="Details"
              minRows={4}
              maxLength={10000}
              {...form.getInputProps('body')}
            />
            {!note && (
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
                const [type, id] = (v || '').split(':');
                form.setValues({ source_type: type || '', source_id: id ? Number(id) : null });
              }}
            />
            <ErrorBox value={failure || sources.error} />
            {item?.archived && (
              <Badge variant="light" color="gray">
                Archiviert
              </Badge>
            )}
            <div className="actions work-editor-actions">
              {item?.id && (
                <Group gap="xs" mr="auto">
                  <Button
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={16} />}
                    onClick={async () => {
                      if (await mutate(item, 'delete')) setItem(null);
                    }}
                  >
                    Löschen
                  </Button>
                  <Button
                    variant="default"
                    leftSection={
                      item.archived ? <IconArchiveOff size={16} /> : <IconArchive size={16} />
                    }
                    onClick={async () => {
                      if (form.isDirty() && !(await ask('Ungespeicherte Änderungen verwerfen?')))
                        return;
                      if (await mutate(item, 'archive')) setItem(null);
                    }}
                  >
                    {item.archived ? 'Wiederherstellen' : 'Archivieren'}
                  </Button>
                </Group>
              )}
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
    </WorkContext.Provider>
  );
}
function CreateButtons({
  onCreate,
  disabled,
}: {
  onCreate: (kind: string) => void;
  disabled?: boolean;
}) {
  return (
    <Group gap="xs">
      <Button
        leftSection={<IconPlus size={17} />}
        disabled={disabled}
        onClick={() => onCreate('todo')}
      >
        Neues To-do
      </Button>
      <Button
        variant="default"
        leftSection={<IconNotes size={17} />}
        disabled={disabled}
        onClick={() => onCreate('note')}
      >
        Neue Notiz
      </Button>
    </Group>
  );
}
function WorkTabs({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <Tabs value={value} onChange={onChange}>
      <Tabs.List>
        <Tabs.Tab value="todo">To-dos</Tabs.Tab>
        <Tabs.Tab value="note">Notizen</Tabs.Tab>
      </Tabs.List>
    </Tabs>
  );
}
function WorkRows({ rows, loading }: { rows: Row[]; loading?: boolean }) {
  const { edit, mutate, busy, pendingDone, goToSource } = useWork();
  return (
    <Stack gap="sm">
      {[...rows]
        .sort(
          (a, b) =>
            Number(a.done) - Number(b.done) ||
            (a.due_on || '9999').localeCompare(b.due_on || '9999') ||
            b.id - a.id,
        )
        .map((item) => (
          <Paper withBorder p="md" radius="md" key={item.id}>
            <Group align="start" wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Group wrap="nowrap" align="start">
                  {item.kind === 'todo' && (
                    <Checkbox
                      mt={3}
                      aria-label={
                        (item.done ? 'To-do wieder öffnen: ' : 'To-do abschließen: ') + item.title
                      }
                      checked={pendingDone?.id === item.id ? pendingDone.done : item.done}
                      disabled={busy || item.archived}
                      onChange={() => mutate(item, 'done')}
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
                    mt="xs"
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {item.body}
                  </Text>
                )}
                <Group gap="xs" mt="xs">
                  {item.archived && (
                    <Badge color="gray" variant="light">
                      Archiviert
                    </Badge>
                  )}
                  {item.done && <Badge variant="light">Erledigt</Badge>}
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
                      onClick={() => goToSource(item.source_url)}
                    >
                      {item.source_label}
                      {item.source_missing ? ' · Quelle entfernt' : ''}
                    </Button>
                  )}
                </Group>
              </div>
              <Group gap={2} wrap="wrap" className="work-row-actions">
                <Tooltip label="Bearbeiten">
                  <ActionIcon
                    variant="subtle"
                    disabled={busy}
                    aria-label={'Eintrag bearbeiten: ' + item.title}
                    onClick={() => edit(item)}
                  >
                    <IconPencil size={17} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={item.archived ? 'Wiederherstellen' : 'Archivieren'}>
                  <ActionIcon
                    variant="subtle"
                    disabled={busy}
                    aria-label={
                      (item.archived ? 'Wiederherstellen: ' : 'Archivieren: ') + item.title
                    }
                    onClick={() => mutate(item, 'archive')}
                  >
                    {item.archived ? <IconArchiveOff size={17} /> : <IconArchive size={17} />}
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Löschen">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    disabled={busy}
                    aria-label={'Löschen: ' + item.title}
                    onClick={() => mutate(item, 'delete')}
                  >
                    <IconTrash size={17} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Paper>
        ))}
      {!rows.length && (
        <Text c="dimmed" size="sm">
          {loading ? 'Einträge werden geladen …' : 'Keine passenden Einträge.'}
        </Text>
      )}
    </Stack>
  );
}
export function SourceWork({
  type,
  id,
  compact = false,
}: {
  type: string;
  id: number;
  compact?: boolean;
}) {
  const { rows, open } = useWork();
  const count = rows.filter(
    (x: Row) => matches(x, { type, id }) && x.kind === 'todo' && !x.archived && !x.done,
  ).length;
  if (compact)
    return (
      <Tooltip label={'To-dos & Notizen · ' + count + ' offene To-dos'}>
        <ActionIcon
          variant="default"
          className="self-work-corner-icon"
          aria-label={'To-dos & Notizen anzeigen · ' + count + ' offene To-dos'}
          onClick={() => open({ type, id })}
        >
          <IconListCheck size={17} />
          {count > 0 && (
            <span className="self-work-action-count self-work-action-count-todo">{count}</span>
          )}
        </ActionIcon>
      </Tooltip>
    );
  return (
    <Button
      variant="light"
      size="xs"
      leftSection={<IconListCheck size={16} />}
      title={count + ' offene To-dos'}
      rightSection={
        count ? (
          <Badge size="sm" color="red" variant="light">
            {count}
          </Badge>
        ) : undefined
      }
      onClick={() => open({ type, id })}
    >
      To-dos & Notizen
    </Button>
  );
}
export function WorkPage() {
  const { rows, query, sources, create, open, busy } = useWork();
  const [search, setSearch] = useState(''),
    [tab, setTab] = useState<string | null>('todo'),
    [showDone, setShowDone] = useState(false),
    [archived, setArchived] = useState(false);
  const [params, setParams] = useSearchParams(),
    handled = useRef('');
  useEffect(() => {
    query.refetch();
  }, []);
  useEffect(() => {
    const token = params.toString();
    if (!params.has('new') && !params.has('list')) {
      handled.current = '';
      return;
    }
    if (!sources.data || sources.isFetching || handled.current === token) return;
    handled.current = token;
    const type = params.get('source_type') || '',
      id = Number(params.get('source_id')),
      found = sources.data.sources.find((x: Row) => x.type === type && x.id === id);
    if (params.has('list') && found) open(found);
    else create(params.get('new') === 'note' ? 'note' : 'todo', found);
    if (type && !found)
      error(Error('Die verknüpfte Quelle ist nicht mehr vorhanden. Bitte die Zuordnung prüfen.'));
    const next = new URLSearchParams(params);
    ['new', 'list', 'source_type', 'source_id'].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
  }, [params, sources.data, sources.isFetching]);
  return (
    <div className="page">
      <Group className="page-header" justify="space-between">
        <div>
          <Title order={1}>To-dos & Notizen</Title>
          <Text c="dimmed" size="sm">
            Alles Wichtige festhalten – frei oder mit deinem Projekt verknüpft.
          </Text>
        </div>
        <CreateButtons
          disabled={busy}
          onCreate={(kind) => {
            setTab(kind);
            setArchived(false);
            setSearch('');
            create(kind);
          }}
        />
      </Group>
      <ErrorBox value={query.error || sources.error} />
      <Paper className="paper">
        <Group justify="space-between" mb="md">
          <WorkTabs value={tab} onChange={setTab} />
          <TextInput
            aria-label="Einträge suchen"
            placeholder="Einträge suchen"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Group>
        <Group mb="md">
          <Checkbox
            label="Archiv anzeigen"
            checked={archived}
            onChange={(e) => setArchived(e.currentTarget.checked)}
          />
          {tab === 'todo' && !archived && (
            <Checkbox
              label="Erledigte anzeigen"
              checked={showDone}
              onChange={(e) => setShowDone(e.currentTarget.checked)}
            />
          )}
        </Group>
        <WorkRows
          loading={query.isPending}
          rows={rows.filter(
            (x: Row) =>
              x.kind === tab &&
              !!x.archived === archived &&
              (archived || showDone || !x.done) &&
              [x.title, x.body, x.source_label].some((v) =>
                String(v || '')
                  .toLocaleLowerCase('de')
                  .includes(search.toLocaleLowerCase('de')),
              ),
          )}
        />
      </Paper>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconAdjustments,
  IconArrowRight,
  IconArrowsMove,
  IconArrowsDiagonal,
  IconCheck,
  IconLayoutGrid,
  IconPlus,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, error, ErrorBox, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { CheckpointButton } from './companion';
import { projectID } from './project-context';
import { useDirtyGuard } from './shell';
import { useWorkActions } from './work';
import { Content, WidgetSettings, sourceURL } from './dashboard-widgets';
import {
  append,
  catalog,
  defaultLayout,
  place,
  sourceFor,
  spec,
  type Layout,
  type Widget,
} from './dashboard-layout';
import './dashboard.css';

export function Overview() {
  const navigate = useNavigate();
  const q = useQuery<{ layout: Layout; token: string }>({
      queryKey: ['dashboard-layout', projectID],
      queryFn: () => api('/api/dashboard/layout'),
      staleTime: 0,
    }),
    cache = useQueryClient(),
    ask = useConfirm(),
    work = useWorkActions();
  const [draft, setDraft] = useState<Layout | null>(null),
    [busy, setBusy] = useState(false),
    [saveError, setSaveError] = useState(''),
    [catalogOpen, setCatalogOpen] = useState(false),
    [search, setSearch] = useState(''),
    [settings, setSettings] = useState<Widget | null>(null);
  const layout = draft || q.data?.layout,
    editing = !!draft,
    dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(q.data?.layout),
    grid = useRef<HTMLDivElement>(null),
    compact = useMediaQuery('(max-width: 850px)');
  const pointerCleanup = useRef<() => void>(() => {});
  useEffect(() => () => pointerCleanup.current(), []);
  const editToken = useRef(''),
    operation = useRef(false);
  useDirtyGuard(dirty);
  const update = (w: Widget) =>
    setDraft((old) => (old ? { ...old, widgets: place(old.widgets, w) } : old));
  function startPointer(e: React.PointerEvent, w: Widget, resize = false) {
    if (!editing || busy || compact || e.button !== 0 || !grid.current) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const sx = e.clientX,
      sy = e.clientY,
      scale = grid.current.getBoundingClientRect().width / grid.current.offsetWidth,
      unit = (grid.current.getBoundingClientRect().width + 12 * scale) / 12,
      row = 116 * scale;
    const original = draft!;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== e.pointerId) return;
      const dx = Math.round((event.clientX - sx) / unit),
        dy = Math.round((event.clientY - sy) / row),
        min = spec(w.type).min;
      const next = resize
        ? {
            ...w,
            w: Math.max(min[0], Math.min(12 - w.x, w.w + dx)),
            h: Math.max(min[1], Math.min(12, w.h + dy)),
          }
        : {
            ...w,
            x: Math.max(0, Math.min(12 - w.w, w.x + dx)),
            y: Math.max(0, Math.min(180, w.y + dy)),
          };
      setDraft({ ...original, widgets: place(original.widgets, next) });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
    };
    const cancel = () => {
      setDraft(original);
      end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    pointerCleanup.current = end;
  }
  async function save() {
    if (operation.current || !draft) return;
    operation.current = true;
    setSaveError('');
    setBusy(true);
    try {
      const result = await api<{ layout: Layout; token: string }>('/api/dashboard/layout', 'PUT', {
        layout: draft,
        token: editToken.current,
      });
      cache.setQueryData(['dashboard-layout', projectID], result);
      setDraft(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
      error(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="page dashboard-page">
      <PageHeader title="Projektübersicht" description="Dein Projekt auf einen Blick.">
        <Group gap={8}>
          {editing ? (
            <>
              <Button
                variant="default"
                disabled={busy}
                onClick={() => setCatalogOpen(true)}
                leftSection={<IconPlus size={15} />}
              >
                Kachel hinzufügen
              </Button>
              <Button
                variant="default"
                disabled={busy}
                onClick={async () => {
                  if (
                    await ask(
                      'Standardübersicht wiederherstellen? Deine Anordnung wird erst mit Speichern ersetzt.',
                    )
                  )
                    setDraft(defaultLayout());
                }}
              >
                Standard
              </Button>
              <Button variant="default" disabled={busy} onClick={() => setDraft(null)}>
                Verwerfen
              </Button>
              <Button
                disabled={!dirty}
                loading={busy}
                onClick={() => void save()}
                leftSection={<IconCheck size={15} />}
              >
                Speichern
              </Button>
            </>
          ) : (
            <>
              <Button variant="default" onClick={() => work.create('todo')}>
                To-do
              </Button>
              <Button variant="default" onClick={() => work.create('note')}>
                Notiz
              </Button>
              <Button
                leftSection={<IconAdjustments size={16} />}
                disabled={!q.data}
                onClick={() => {
                  editToken.current = q.data!.token;
                  setDraft(structuredClone(q.data!.layout));
                }}
              >
                Übersicht anpassen
              </Button>
            </>
          )}
        </Group>
      </PageHeader>
      <ErrorBox value={q.error} />
      {q.error && (
        <Button variant="default" onClick={() => void q.refetch()}>
          Neu laden
        </Button>
      )}
      {editing && saveError && (
        <Alert color="red" mb="sm" title="Übersicht wurde nicht gespeichert">
          {saveError}
          <Group mt="sm">
            <Button
              variant="default"
              onClick={async () => {
                if (
                  await ask(
                    'Deine ungespeicherte Anordnung verwerfen und den gespeicherten Stand laden?',
                  )
                ) {
                  const result = await q.refetch();
                  if (!result.error) {
                    setDraft(null);
                    setSaveError('');
                  }
                }
              }}
            >
              Gespeicherten Stand laden
            </Button>
          </Group>
        </Alert>
      )}
      {editing && (
        <Alert mb="sm" icon={<IconLayoutGrid size={18} />}>
          Kacheln am Griff verschieben und an der Ecke vergrößern. Über die Einstellungen sind Größe
          und Inhalt auch per Tastatur anpassbar. Erst Speichern übernimmt die Übersicht.
        </Alert>
      )}
      {!layout ? (
        <Loader />
      ) : (
        <div
          ref={grid}
          className={'dashboard-grid' + (editing ? ' is-editing' : '')}
          aria-label="Übersichtskacheln"
          aria-busy={busy}
          inert={busy}
        >
          {[...layout.widgets]
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .map((w) => (
              <section
                key={w.id}
                data-widget={w.type}
                className="dashboard-widget"
                style={{
                  gridColumn: `${w.x + 1} / span ${w.w}`,
                  gridRow: `${w.y + 1} / span ${w.h}`,
                }}
                aria-label={w.config.title || spec(w.type).title}
              >
                <header className="dashboard-widget-header">
                  {editing && (
                    <ActionIcon
                      variant="subtle"
                      className="dashboard-grip"
                      aria-label={'Verschieben: ' + (w.config.title || spec(w.type).title)}
                      onPointerDown={(e) => startPointer(e, w)}
                      onKeyDown={(e) => {
                        const delta: Record<string, number[]> = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, -1],
                          ArrowDown: [0, 1],
                        };
                        if (delta[e.key]) {
                          e.preventDefault();
                          const [dx, dy] = delta[e.key];
                          update({
                            ...w,
                            x: Math.min(12 - w.w, Math.max(0, w.x + dx)),
                            y: Math.min(180, Math.max(0, w.y + dy)),
                          });
                        }
                      }}
                    >
                      <IconArrowsMove size={16} />
                    </ActionIcon>
                  )}
                  <Tooltip label={spec(w.type).description} multiline w={260}>
                    <Text component="h2" size="sm" fw={600} lineClamp={2}>
                      {w.config.title || spec(w.type).title}
                    </Text>
                  </Tooltip>
                  {editing ? (
                    <Group gap={2} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        aria-label="Kachel einstellen"
                        onClick={() => setSettings(w)}
                      >
                        <IconSettings size={16} />
                      </ActionIcon>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        aria-label="Kachel entfernen"
                        onClick={() =>
                          setDraft({
                            ...draft!,
                            widgets: draft!.widgets.filter((x) => x.id !== w.id),
                          })
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ) : (
                    <ActionIcon
                      variant="subtle"
                      aria-label={(w.config.title || spec(w.type).title) + ' öffnen'}
                      onClick={() => {
                        const source = sourceFor(w);
                        if (source === 'inbox')
                          window.dispatchEvent(new CustomEvent('phb-inbox-open'));
                        else navigate(sourceURL(source));
                      }}
                    >
                      <IconArrowRight size={14} />
                    </ActionIcon>
                  )}
                </header>
                <div className="dashboard-widget-content">
                  <Content w={w} editing={editing} />
                </div>
                {editing && (
                  <button
                    type="button"
                    className="dashboard-resize"
                    aria-label="Kachelgröße ändern (Pfeiltasten)"
                    onPointerDown={(e) => startPointer(e, w, true)}
                    onClick={() => {
                      if (compact) setSettings(w);
                    }}
                    onKeyDown={(e) => {
                      const delta: Record<string, number[]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, -1],
                        ArrowDown: [0, 1],
                      };
                      if (delta[e.key]) {
                        e.preventDefault();
                        const [dx, dy] = delta[e.key],
                          min = spec(w.type).min;
                        update({
                          ...w,
                          w: Math.min(12 - w.x, Math.max(min[0], w.w + dx)),
                          h: Math.min(12, Math.max(min[1], w.h + dy)),
                        });
                      }
                    }}
                  >
                    <IconArrowsDiagonal size={14} />
                  </button>
                )}
              </section>
            ))}
          {!layout.widgets.length && (
            <div className="dashboard-empty">
              <IconLayoutGrid size={32} />
              <Text>Hier ist Platz für deine Übersicht.</Text>
              <Button
                onClick={() => {
                  if (!editing) {
                    editToken.current = q.data!.token;
                    setDraft(structuredClone(q.data!.layout));
                  }
                  setCatalogOpen(true);
                }}
              >
                Erste Kachel hinzufügen
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="dashboard-checkpoint">
        <CheckpointButton />
      </div>
      <Modal
        opened={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        title="Kachelkatalog"
        size="xl"
        closeOnClickOutside={false}
      >
        <Stack>
          <TextInput
            placeholder="Kachel suchen"
            aria-label="Kachel suchen"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            {draft?.widgets.length || 0} von 30 Kacheln. Mehrfach verwendbar, z. B. für
            unterschiedliche Gewerke.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {catalog
              .filter((x) =>
                (x.title + ' ' + x.description)
                  .toLocaleLowerCase('de')
                  .includes(search.toLocaleLowerCase('de')),
              )
              .map((x) => (
                <div key={x.type} className="dashboard-catalog-card">
                  <Group justify="space-between">
                    <Badge variant="light" size="xs">
                      {x.group}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {x.min.join(' × ')}
                    </Text>
                  </Group>
                  <div
                    className={
                      'dashboard-catalog-preview preview-' + (x.min[1] === 1 ? 'metric' : 'list')
                    }
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </div>
                  <Text fw={600} size="sm">
                    {x.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {x.description}
                  </Text>
                  <Button
                    variant="light"
                    size="compact-sm"
                    disabled={(draft?.widgets.length || 0) >= 30}
                    leftSection={<IconPlus size={14} />}
                    onClick={() => {
                      const w: Widget = {
                        id: crypto.randomUUID(),
                        type: x.type,
                        x: 0,
                        y: 0,
                        w: x.min[0],
                        h: x.min[1],
                        config: ['metric', 'list', 'progress'].includes(x.type)
                          ? { source: 'todos', aggregation: 'count' }
                          : x.type === 'links'
                            ? { links: ['/', '/belege', '/aufgaben'] }
                            : {},
                      };
                      const next = append(draft!.widgets, w);
                      setDraft({ ...draft!, widgets: next });
                      setCatalogOpen(false);
                      setSettings(next.find((item) => item.id === w.id)!);
                    }}
                  >
                    Hinzufügen
                  </Button>
                </div>
              ))}
          </SimpleGrid>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCatalogOpen(false)}>
              Schließen
            </Button>
          </Group>
        </Stack>
      </Modal>
      {settings && (
        <WidgetSettings
          key={settings.id}
          widget={settings}
          onClose={() => setSettings(null)}
          onSave={(w) => {
            update(w);
            setSettings(null);
          }}
        />
      )}
    </div>
  );
}

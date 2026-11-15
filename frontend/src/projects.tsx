import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconArchive,
  IconArchiveOff,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSun,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrandLogo } from './brand';
import type { ProjectsResponse } from './contracts';
import { Editor, ErrorBox, Row, api, money, success } from './core';
const empty: Row = {
  title: '',
  kind: 'Sanierung',
  description: '',
  start_date: new Date().toLocaleDateString('sv-SE'),
};
export function ProjectDashboard() {
  const query = useQuery({
      queryKey: ['projects'],
      queryFn: () => api<ProjectsResponse>('/api/projects'),
      staleTime: 0,
    }),
    cache = useQueryClient();
  const [opened, setOpened] = useState(false),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [removing, setRemoving] = useState<Row | null>(null),
    [confirmation, setConfirmation] = useState(''),
    [actionFailure, setActionFailure] = useState<unknown>(null),
    [showArchived, setShowArchived] = useState(false);
  const projects: Row[] = query.data?.projects || [];
  const active = projects.filter((project) => !project.archived);
  const archived = projects.filter((project) => project.archived);
  const form = useForm<Row>({ initialValues: empty }),
    { colorScheme, setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (busy || (opened && form.isDirty())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  });
  function open(row?: Row) {
    const values = { ...empty, ...row };
    setID(row?.id || null);
    form.setValues(values);
    form.setInitialValues(values);
    form.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const { title, kind, description, start_date } = form.values;
      await api('/api/projects' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
        title,
        kind,
        description,
        ...(!id ? { start_date } : {}),
      });
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['projects'] });
      success(id ? 'Projekt gespeichert.' : 'Projekt angelegt. Du kannst es jetzt öffnen.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function archive(project: Row) {
    if (busy) return;
    setBusy(true);
    setActionFailure(null);
    try {
      await api('/api/projects/' + project.id, 'PATCH', { archived: !project.archived });
      await cache.invalidateQueries({ queryKey: ['projects'] });
      setShowArchived(!project.archived);
      success(project.archived ? 'Projekt wiederhergestellt.' : 'Projekt archiviert.');
    } catch (error) {
      setActionFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function inspectRemoval(project: Row) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setActionFailure(null);
    try {
      const result = await api('/api/projects/' + project.id);
      setRemoving(result.project);
      setConfirmation('');
    } catch (error) {
      setActionFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy || !removing?.can_delete || confirmation !== removing.title) return;
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/projects/' + removing.id, 'DELETE', { confirmed: true, confirmation });
      setRemoving(null);
      success('Leeres Projekt gelöscht.');
    } catch (error) {
      setFailure(error);
    } finally {
      await cache.invalidateQueries({ queryKey: ['projects'] });
      setBusy(false);
    }
  }
  function tiles(rows: Row[]) {
    return (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {rows.map((project) => (
          <Paper key={project.id} className="paper" style={{ padding: 0, overflow: 'hidden' }}>
            <Group justify="space-between" wrap="nowrap" p="md" pb={0}>
              <Badge variant="light" size="sm">
                {project.kind || 'Projekt'}
              </Badge>
              <Group gap={2} wrap="nowrap">
                <Tooltip label="Projekt bearbeiten">
                  <ActionIcon
                    aria-label={'Projekt bearbeiten: ' + project.title}
                    variant="subtle"
                    disabled={busy}
                    onClick={() => open(project)}
                  >
                    <IconPencil size={17} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label={project.archived ? 'Projekt wiederherstellen' : 'Projekt archivieren'}
                >
                  <ActionIcon
                    aria-label={
                      (project.archived ? 'Projekt wiederherstellen: ' : 'Projekt archivieren: ') +
                      project.title
                    }
                    variant="subtle"
                    disabled={busy}
                    onClick={() => archive(project)}
                  >
                    {project.archived ? <IconArchiveOff size={17} /> : <IconArchive size={17} />}
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label={
                    project.can_delete ? 'Leeres Projekt löschen' : 'Löschvoraussetzungen prüfen'
                  }
                  multiline
                  w={240}
                >
                  <span>
                    <ActionIcon
                      aria-label={'Projekt löschen: ' + project.title}
                      variant="subtle"
                      color="red"
                      disabled={busy}
                      onClick={() => inspectRemoval(project)}
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </span>
                </Tooltip>
              </Group>
            </Group>
            <Anchor
              href={'/p/' + project.id + '/'}
              underline="never"
              c="inherit"
              style={{ display: 'block', padding: 24 }}
            >
              <Title order={2} size="h3" style={{ overflowWrap: 'anywhere' }}>
                {project.title}
              </Title>
              <Text size="sm" c="dimmed" mt="xs" lineClamp={2} mih={42}>
                {project.description || 'Dein Arbeitsbereich für Planung, Kosten und Unterlagen.'}
              </Text>
              <Progress
                value={project.tasks ? (project.completed / project.tasks) * 100 : 0}
                mt="lg"
                size={5}
              />
              <SimpleGrid cols={3} mt="md" spacing="xs">
                <div>
                  <Text size="xs" c="dimmed">
                    Arbeitspakete
                  </Text>
                  <Text fw={600} size="sm">
                    {project.completed} / {project.tasks}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Kostenprognose
                  </Text>
                  <Text fw={600} size="sm">
                    {money(project.forecast)}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">
                    Offene To-dos
                  </Text>
                  <Text fw={600} size="sm">
                    {project.open_todos}
                  </Text>
                </div>
              </SimpleGrid>
              <Text size="sm" c="teal" mt="lg" fw={600}>
                Projekt öffnen →
              </Text>
            </Anchor>
          </Paper>
        ))}
      </SimpleGrid>
    );
  }
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--brand-bg)' }}>
      <div className="page" style={{ maxWidth: 1280, paddingTop: 36 }}>
        <Group justify="space-between" mb={42}>
          <Group gap="sm" className="app-header-brand">
            <BrandLogo />
          </Group>
          <Group gap="xs">
            {' '}
            <Tooltip label="Darstellung wechseln">
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Darstellung wechseln"
                onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
              >
                {colorScheme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Group className="page-header" justify="space-between">
          <div>
            <Title order={1}>Deine Projekte</Title>
            <Text size="sm" c="dimmed">
              Haus, Garten oder ein einzelnes Gewerk – jedes Vorhaben hat seinen eigenen Platz.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={17} />} disabled={busy} onClick={() => open()}>
            Neues Projekt
          </Button>
        </Group>
        <ErrorBox value={query.error} />
        <ErrorBox value={actionFailure} />
        <Group mb="lg" gap="xs" aria-label="Projektauswahl">
          <Button
            variant={!showArchived ? 'filled' : 'default'}
            aria-pressed={!showArchived}
            onClick={() => setShowArchived(false)}
          >
            Aktive Projekte ({active.length})
          </Button>
          <Button
            variant={showArchived ? 'filled' : 'default'}
            leftSection={<IconArchive size={16} />}
            aria-pressed={showArchived}
            onClick={() => setShowArchived(true)}
          >
            Archivierte Projekte ({archived.length})
          </Button>
        </Group>
        {showArchived && (
          <Text size="sm" c="dimmed" mb="md">
            Archivierte Projekte bleiben zugänglich. Du kannst sie öffnen oder wieder in die aktiven
            Projekte aufnehmen.
          </Text>
        )}
        {tiles(showArchived ? archived : active)}
        {query.isPending && <Text c="dimmed">Projekte werden geladen …</Text>}
        {!query.isPending && !query.error && !(showArchived ? archived : active).length && (
          <Paper className="paper">
            <Text>
              {showArchived
                ? 'Keine archivierten Projekte.'
                : archived.length
                  ? 'Keine aktiven Projekte. Du kannst ein Projekt aus dem Archiv wiederherstellen oder ein neues anlegen.'
                  : 'Noch keine Projekte. Lege dein erstes Vorhaben an.'}
            </Text>
          </Paper>
        )}
        <Text c="dimmed" size="xs" mt="lg">
          Daten, Stammdaten und Projektsicherungen bleiben je Projekt getrennt. Die
          ChatGPT-Verbindung gilt für die gesamte Anwendung.
        </Text>
        <Editor
          title={
            removing?.can_delete ? 'Leeres Projekt löschen' : 'Projekt löschen – Voraussetzungen'
          }
          opened={!!removing}
          busy={busy}
          onClose={() => setRemoving(null)}
        >
          <Stack>
            {!removing?.can_delete && (
              <Alert color="yellow" title="Projekt enthält noch Daten">
                <Text size="sm">
                  Diese Daten müssen vor dem Löschen entfernt oder über den Projekt-Reset
                  zurückgesetzt werden:
                </Text>
                <ul>
                  {(removing?.data_sections || []).map((section: Row) => (
                    <li key={section.table}>
                      {section.label}: {section.count}
                    </li>
                  ))}
                </ul>
                <Anchor href={'/p/' + removing?.id + '/daten'}>
                  Daten & Sicherung im Projekt öffnen
                </Anchor>
              </Alert>
            )}
            <Text>
              {removing?.can_delete ? (
                <>
                  Das Projekt „{removing.title}“ (Nr. {removing.id}) wird endgültig gelöscht. Diese
                  Aktion kann nicht rückgängig gemacht werden. Vorhandene Projektsicherungen bleiben
                  erhalten.
                </>
              ) : (
                <>
                  Das Projekt „{removing?.title}“ bleibt erhalten. Sobald die oben aufgeführten
                  Daten entfernt sind, kannst du die Löschprüfung erneut öffnen.
                </>
              )}
            </Text>
            <Text size="sm" c="dimmed">
              Nur leere Projekte können gelöscht werden. Standardgewerke und Standardkategorien
              zählen nicht als eigene Daten.
            </Text>
            <TextInput
              label="Projekttitel zur Bestätigung"
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              disabled={busy || !removing?.can_delete}
              autoComplete="off"
            />
            <ErrorBox value={failure} />
            <div className="actions">
              <Button
                color="red"
                disabled={!removing?.can_delete || confirmation !== removing?.title}
                loading={busy}
                onClick={remove}
              >
                Endgültig löschen
              </Button>
            </div>
          </Stack>
        </Editor>
        <Editor
          title={id ? 'Projekt bearbeiten' : 'Neues Projekt'}
          opened={opened}
          dirty={form.isDirty()}
          changes={form.values}
          original={form.getInitialValues()}
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
              <TextInput
                required
                label="Projekttitel"
                placeholder="Zum Beispiel: Garten neu gestalten"
                maxLength={160}
                {...form.getInputProps('title')}
              />
              <Select
                label="Art des Projekts"
                data={['Bauen', 'Sanierung', 'Umbau', 'Garten', 'Hof', 'Dach', 'Sonstiges']}
                {...form.getInputProps('kind')}
              />
              <Textarea
                label="Beschreibung (optional)"
                minRows={3}
                maxLength={2000}
                {...form.getInputProps('description')}
              />
              {!id && (
                <TextInput
                  required
                  type="date"
                  label="Geplanter Projektstart"
                  {...form.getInputProps('start_date')}
                />
              )}
              <Text size="sm" c="dimmed">
                Neue Projekte starten ohne Arbeitspakete, Angebote oder Buchungen. Standardgewerke
                und Kategorien stehen bereit; Firmen legst du im Projekt an.
              </Text>
              <ErrorBox value={failure} />
              <div className="actions">
                <Button type="submit" loading={busy}>
                  {id ? 'Speichern' : 'Projekt anlegen'}
                </Button>
              </div>
            </Stack>
          </form>
        </Editor>
      </div>
    </div>
  );
}

import { BrandLogo } from './brand';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  ActionIcon,
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
import { IconPlus, IconPencil, IconMoon, IconSun, IconLogout } from '@tabler/icons-react';
import { api, Editor, ErrorBox, Row, money, success } from './core';
const empty: Row = {
  title: '',
  kind: 'Sanierung',
  description: '',
  start_date: new Date().toLocaleDateString('sv-SE'),
};
export function ProjectDashboard() {
  const query = useQuery({
      queryKey: ['projects'],
      queryFn: () => api('/api/projects'),
      staleTime: 0,
    }),
    cache = useQueryClient();
  const [opened, setOpened] = useState(false),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
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
    form.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/projects' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', form.values);
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['projects'] });
      success(id ? 'Projekt gespeichert.' : 'Projekt angelegt. Du kannst es jetzt öffnen.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--brand-bg)' }}>
      <div className="page" style={{ maxWidth: 1280, paddingTop: 36 }}>
        <Group justify="space-between" mb={42}>
          <Group gap="sm">
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
            <form action="/logout" method="post">
              <Tooltip label="Abmelden">
                <ActionIcon
                  type="submit"
                  variant="default"
                  size="lg"
                  aria-label="Abmelden"
                  disabled={busy}
                >
                  <IconLogout size={19} />
                </ActionIcon>
              </Tooltip>
            </form>
          </Group>
        </Group>
        <Group className="page-header" justify="space-between">
          <div>
            <Title order={1}>Deine Projekte</Title>
            <Text size="sm" c="dimmed">
              Haus, Garten oder ein einzelnes Gewerk – jedes Vorhaben hat seinen eigenen Platz.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={17} />} onClick={() => open()}>
            Neues Projekt
          </Button>
        </Group>
        <ErrorBox value={query.error} />
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
          {(query.data?.projects || []).map((project: Row) => (
            <Paper
              key={project.id}
              className="paper"
              style={{ position: 'relative', padding: 0, overflow: 'hidden' }}
            >
              <Tooltip label="Projekt bearbeiten">
                <ActionIcon
                  aria-label={'Projekt bearbeiten: ' + project.title}
                  variant="subtle"
                  style={{ position: 'absolute', right: 14, top: 14, zIndex: 1 }}
                  onClick={() => open(project)}
                >
                  <IconPencil size={17} />
                </ActionIcon>
              </Tooltip>
              <Anchor
                href={'/p/' + project.id + '/'}
                underline="never"
                c="inherit"
                style={{ display: 'block', padding: 24 }}
              >
                <Badge variant="light" size="sm" mb="md">
                  {project.kind || 'Projekt'}
                </Badge>
                <Title order={2} size="h3" pr={15} style={{ overflowWrap: 'anywhere' }}>
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
        {query.isPending && <Text c="dimmed">Projekte werden geladen …</Text>}
        {!query.isPending && !query.error && !query.data?.projects?.length && (
          <Paper className="paper">
            <Text>Noch keine Projekte. Lege dein erstes Vorhaben an.</Text>
          </Paper>
        )}
        <Text c="dimmed" size="xs" mt="lg">
          Daten und Stammdaten bleiben je Projekt getrennt. Die ChatGPT-Verbindung und vollständige
          Sicherungen gelten für die gesamte Anwendung.
        </Text>
        <Editor
          title={id ? 'Projekt bearbeiten' : 'Neues Projekt'}
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

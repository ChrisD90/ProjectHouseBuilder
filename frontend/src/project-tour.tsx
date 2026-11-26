import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  List,
  Modal,
  NumberInput,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconCalendar,
  IconCheck,
  IconFolderOpen,
  IconLayoutDashboard,
  IconReceipt,
  IconShieldCheck,
  IconTools,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, ErrorBox, type Row } from './core';
import { projectID } from './project-context';

type TourState = {
  status: 'not_started' | 'pending' | 'completed' | 'skipped';
  step: number;
  token: string;
};
const titles = [
  'Willkommen in deinem Projekt',
  'Dein Arbeitsablauf',
  'Dokumenteneingang einrichten',
  'Sicherungen einrichten',
  'Bereit für dein Projekt',
];
export function ProjectTour({ title }: { title: string }) {
  const cache = useQueryClient(),
    navigate = useNavigate();
  const query = useQuery<TourState>({
    queryKey: ['project-tour', projectID],
    queryFn: () => api('/api/project-onboarding'),
    staleTime: 0,
  });
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const [folder, setFolder] = useState(''),
    [interval, setInterval] = useState<number | string>(10),
    [enabled, setEnabled] = useState(true);
  const [backupFolder, setBackupFolder] = useState(''),
    [keep, setKeep] = useState<number | string>(30),
    [changeBackup, setChangeBackup] = useState(false);
  const lock = useRef(false),
    inboxLoaded = useRef(false),
    backupLoaded = useRef(false);
  const step = query.data?.step || 0;
  const inbox = useQuery<Row>({
    queryKey: ['document-inbox', false],
    queryFn: () => api('/api/document-inbox'),
    enabled: opened && step >= 2,
  });
  const backup = useQuery<Row>({
    queryKey: ['tour-backup', projectID],
    queryFn: () => api('/api/backup/status'),
    enabled: opened && step >= 3,
    staleTime: 0,
  });
  useEffect(() => {
    if (query.data?.status === 'pending') setOpened(true);
  }, [query.data]);
  useEffect(() => {
    if (opened && inbox.data && !inboxLoaded.current) {
      inboxLoaded.current = true;
      setFolder(inbox.data.config?.folder || '');
      setInterval(inbox.data.config?.interval_minutes || 10);
      setEnabled(inbox.data.config?.configured ? inbox.data.config.enabled : true);
    }
  }, [opened, inbox.data]);
  useEffect(() => {
    if (opened && backup.data && !backupLoaded.current) {
      backupLoaded.current = true;
      setBackupFolder(backup.data.configured ? backup.data.relative_folder : '');
      setKeep(backup.data.keep || 30);
    }
  }, [opened, backup.data]);
  async function persist(action: string, target = step) {
    const state = await api<TourState>('/api/project-onboarding', 'PUT', {
      action,
      step: target,
      token: query.data!.token,
    });
    cache.setQueryData(['project-tour', projectID], state);
    if (action === 'finish' || action === 'skip') setOpened(false);
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const start = () => {
      void run(async () => {
        const result = await query.refetch();
        if (result.error) throw result.error;
        if (!result.data) throw Error('Projekt konnte nicht geladen werden.');
        const state = await api<TourState>('/api/project-onboarding', 'PUT', {
          action: 'start',
          token: result.data.token,
        });
        inboxLoaded.current = false;
        backupLoaded.current = false;
        setChangeBackup(false);
        cache.setQueryData(['project-tour', projectID], state);
        setOpened(true);
      });
    };
    window.addEventListener('phb-project-tour', start);
    return () => window.removeEventListener('phb-project-tour', start);
  });
  async function choose(kind: 'inbox' | 'backup') {
    await run(async () => {
      const result = await api<Row>(
        kind === 'inbox' ? '/api/document-inbox/native-folder' : '/api/backup/native-folder',
        'POST',
        { folder: kind === 'inbox' ? folder : backupFolder },
      );
      if (!result.cancelled && result.folder) {
        if (kind === 'inbox') setFolder(result.folder);
        else setBackupFolder(result.folder);
      }
    });
  }
  async function next() {
    await run(async () => {
      if (step === 2) {
        await api('/api/document-inbox/configure', 'POST', {
          folder,
          interval_minutes: Number(interval),
          enabled,
        });
        await cache.invalidateQueries({ queryKey: ['document-inbox'] });
      }
      if (step === 3 && (!backup.data?.configured || changeBackup)) {
        await api('/api/backup/configure', 'POST', { folder: backupFolder, keep: Number(keep) });
        await cache.invalidateQueries({ queryKey: ['tour-backup'] });
        await cache.invalidateQueries({ queryKey: ['companion-backup'] });
      }
      if (step === 4) {
        await persist('finish');
        navigate('/uebersicht');
      } else await persist('progress', step + 1);
    });
  }
  const editingBackup = step === 3 && (!backup.data?.configured || changeBackup);
  const unavailable =
    (step === 2 && (inbox.isPending || !!inbox.error)) ||
    (step === 3 && (backup.isPending || !!backup.error));
  const invalid =
    (step === 2 &&
      (!folder.trim() ||
        !Number.isInteger(Number(interval)) ||
        Number(interval) < 1 ||
        Number(interval) > 1440)) ||
    (editingBackup &&
      (!backupFolder.trim() ||
        !Number.isInteger(Number(keep)) ||
        Number(keep) < 2 ||
        Number(keep) > 1000));
  return (
    <>
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) void run(() => persist('skip'));
        }}
        title={titles[step]}
        size="lg"
        centered
        closeOnClickOutside={false}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        closeButtonProps={{ 'aria-label': 'Tour beenden' }}
      >
        <Stack gap="md">
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {title}
            </Text>
            <Text size="xs" c="dimmed">
              Schritt {step + 1} von {titles.length}
            </Text>
          </Group>
          <Progress value={((step + 1) / titles.length) * 100} size="xs" />
          <ErrorBox value={failure} />
          {!!failure && (
            <Button
              variant="subtle"
              size="compact-sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await query.refetch();
                  if (result.error) throw result.error;
                  if (result.data?.status !== 'pending') setOpened(false);
                })
              }
            >
              Aktuellen Tour-Stand laden
            </Button>
          )}
          {step === 0 && (
            <>
              <Text size="sm">
                Hier organisierst du dein Vorhaben – vom ersten Angebot bis zur letzten Rechnung.
                Wir zeigen dir kurz die wichtigsten Bereiche und richten auf Wunsch deine Ordner
                ein.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {[
                  {
                    icon: IconLayoutDashboard,
                    title: 'Übersicht',
                    text: 'Deine eigenen Kacheln für Aufgaben, Termine und Finanzen.',
                  },
                  {
                    icon: IconCalendar,
                    title: 'Projekt',
                    text: 'Unterlagen sammeln, Termine planen und Angebote verwalten.',
                  },
                  {
                    icon: IconTools,
                    title: 'Umsetzung',
                    text: 'Eigenleistungen, To-dos, Notizen und Stunden erfassen. Die Projektwerkstatt hilft beim Planen und Rechnen.',
                  },
                  {
                    icon: IconReceipt,
                    title: 'Finanzen',
                    text: 'Rechnungen bezahlen, Kosten verfolgen und Kredite oder Eigenkapital zuordnen.',
                  },
                ].map((x) => (
                  <Paper key={x.title} withBorder p="sm">
                    <Group wrap="nowrap" align="flex-start" gap="sm">
                      <ThemeIcon variant="light" size={32}>
                        <x.icon size={18} />
                      </ThemeIcon>
                      <div>
                        <Text fw={600} size="sm">
                          {x.title}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {x.text}
                        </Text>
                      </div>
                    </Group>
                  </Paper>
                ))}
              </SimpleGrid>
            </>
          )}
          {step === 1 && (
            <>
              <Title order={4}>Von der Datei zum Projektüberblick</Title>
              <List size="sm" spacing="sm" type="ordered">
                {[
                  'Angebote, Rechnungen und Kassenzettel im passenden Bereich hochladen.',
                  'Lokal oder bei bestehender Verbindung mit ChatGPT analysieren lassen. Die Daten prüfen, ergänzen und speichern oder buchen.',
                  'Mit Firmen, Angeboten und Eigenleistungen verknüpfen. Verknüpfte To-dos findest du auch in der zentralen Aufgabenliste.',
                  'Termine im Kalender planen; Räume, Mengen und Verlegepläne in der Projektwerkstatt vorbereiten.',
                ].map((text) => (
                  <List.Item key={text}>{text}</List.Item>
                ))}
              </List>
              <Text size="sm" c="dimmed">
                ChatGPT ist optional. Alle Daten lassen sich auch manuell erfassen. Die
                Ordnereinrichtung verschiebt keine vorhandenen Projektdateien.
              </Text>
            </>
          )}
          {step === 2 && (
            <>
              <Group gap="xs">
                <IconFolderOpen size={20} />
                <Text fw={600}>Dein Eingangsordner</Text>
              </Group>
              <Text size="sm">
                Lege hier neue Angebote, Rechnungen oder andere Unterlagen ab. Die App prüft den
                Ordner regelmäßig. Neue Dateien erscheinen mit einem Zähler im Dokumenteneingang
                oben im Header.
              </Text>
              <ErrorBox value={inbox.error} />
              <Group align="end" wrap="nowrap">
                <TextInput
                  style={{ flex: 1, minWidth: 0 }}
                  label="Eingangsordner für dieses Projekt"
                  value={folder}
                  maxLength={2048}
                  onChange={(e) => setFolder(e.currentTarget.value)}
                  disabled={busy}
                />
                <Button variant="default" disabled={busy} onClick={() => void choose('inbox')}>
                  Ordner auswählen
                </Button>
              </Group>
              <NumberInput
                label="Prüfintervall in Minuten"
                min={1}
                max={1440}
                allowDecimal={false}
                value={interval}
                onChange={setInterval}
                disabled={busy}
              />
              <Switch
                label="Ordner regelmäßig prüfen"
                checked={enabled}
                onChange={(e) => setEnabled(e.currentTarget.checked)}
                disabled={busy}
              />
              <Text size="xs" c="dimmed">
                Der Systemdialog öffnet sich auf dem Rechner, auf dem die App läuft. Originale
                bleiben im Ordner. Dateien, die du noch nicht übernommen hast, gehören nicht zum
                Projektbackup.
              </Text>
            </>
          )}
          {step === 3 && (
            <>
              <Group gap="xs">
                <IconShieldCheck size={20} />
                <Text fw={600}>Ein sicherer Platz für deine Backups</Text>
              </Group>
              <Text size="sm">
                Wähle ein Sicherungsziel außerhalb des App-Ordners, zum Beispiel auf einer externen
                Festplatte. Backups erstellst und verwaltest du später unter „Daten & Backups“.
              </Text>
              <Alert color="blue">
                Das Sicherungsziel gilt für die gesamte App. Die Sicherungen werden weiterhin streng
                je Projekt getrennt gespeichert. Hier wird weder eine Sicherung erstellt noch werden
                vorhandene Dateien verschoben.
              </Alert>
              <ErrorBox value={backup.error} />
              {backup.data?.configured && (
                <>
                  <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                    Aktuelles Sicherungsziel: {backup.data.relative_folder}
                  </Text>
                  <Checkbox
                    label="Sicherungsziel ändern (für alle Projekte)"
                    checked={changeBackup}
                    onChange={(e) => setChangeBackup(e.currentTarget.checked)}
                    disabled={busy}
                  />
                </>
              )}
              {editingBackup && (
                <>
                  <Group align="end" wrap="nowrap">
                    <TextInput
                      label="Sicherungsordner"
                      style={{ flex: 1, minWidth: 0 }}
                      value={backupFolder}
                      maxLength={2048}
                      onChange={(e) => setBackupFolder(e.currentTarget.value)}
                      disabled={busy}
                    />
                    {backup.data?.backend !== 'postgres' && (
                      <Button
                        variant="default"
                        disabled={busy}
                        onClick={() => void choose('backup')}
                      >
                        Ordner auswählen
                      </Button>
                    )}
                  </Group>
                  <NumberInput
                    label="Sicherungen pro Projekt aufbewahren"
                    min={2}
                    max={1000}
                    allowDecimal={false}
                    value={keep}
                    onChange={setKeep}
                    disabled={busy}
                  />
                  {backup.data?.backend === 'postgres' && (
                    <Text size="xs" c="dimmed">
                      Erreichbarer Ordner auf dem NAS innerhalb von {backup.data.storage_root}. Ein
                      Ordner auf deinem Browser-PC ist dafür nicht nutzbar.
                    </Text>
                  )}
                </>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <Group>
                <ThemeIcon variant="light" color="green" size={44}>
                  <IconCheck size={24} />
                </ThemeIcon>
                <Title order={4}>Du kannst loslegen.</Title>
              </Group>
              <Text size="sm">
                Richte deine Übersicht nach deinen Bedürfnissen ein oder starte mit Firmen, Terminen
                und den ersten Unterlagen. Ordner und Verbindungen kannst du jederzeit später
                anpassen.
              </Text>
              <Text size="sm" c="dimmed">
                Diese Tour findest du unter Einstellungen → System.
              </Text>
            </>
          )}
          <Group justify="space-between" mt="sm" wrap="wrap">
            <Button
              variant="subtle"
              disabled={busy}
              onClick={() => void run(() => persist('skip'))}
            >
              Tour überspringen
            </Button>
            <Group gap="xs">
              {step > 0 && (
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => void run(() => persist('progress', step - 1))}
                >
                  Zurück
                </Button>
              )}
              {(step === 2 || step === 3) && (
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() => void run(() => persist('progress', step + 1))}
                >
                  Später einrichten
                </Button>
              )}
              <Button
                disabled={busy || unavailable || invalid}
                loading={busy}
                onClick={() => void next()}
              >
                {step === 4
                  ? 'Zur Projektübersicht'
                  : step === 2
                    ? 'Ordner speichern & weiter'
                    : editingBackup
                      ? 'Sicherungsziel speichern & weiter'
                      : 'Weiter'}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
      {!opened && !!failure && (
        <Alert color="red" m="md">
          <ErrorBox value={failure} />
        </Alert>
      )}
    </>
  );
}

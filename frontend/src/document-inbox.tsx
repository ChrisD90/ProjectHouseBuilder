import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconInbox,
  IconSettings,
  IconRefresh,
  IconX,
  IconRestore,
  IconFile,
  IconFolderOpen,
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Editor, ErrorBox, Row, api, error } from './core';
import { projectURL } from './project-context';
import { useDirtyGuard } from './shell';
import './document-inbox.css';

type InboxConfig = {
  configured: boolean;
  folder: string;
  interval_minutes: number;
  enabled: boolean;
  last_scan: string;
  error: string;
};
type InboxItem = {
  id: number;
  filename: string;
  size: number;
  state: string;
  job: Row | null;
  preview_url: string;
  present: boolean;
};
const kinds = [
  { value: 'offer', label: 'Angebot' },
  { value: 'offer-version', label: 'Neue Angebotsversion' },
  { value: 'invoice', label: 'Rechnung' },
  { value: 'till', label: 'Kassenzettel' },
  { value: 'document', label: 'Projektunterlage' },
  { value: 'document-version', label: 'Neue Dokumentversion' },
  { value: 'funding', label: 'Förderunterlage' },
  { value: 'loan', label: 'Kreditunterlage (ChatGPT)' },
];
const sizeLabel = (bytes: number) =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(
    bytes / (bytes > 1024 * 1024 ? 1024 * 1024 : 1024),
  ) + (bytes > 1024 * 1024 ? ' MB' : ' KB');

export function DocumentInbox({ bridge }: { bridge: Row }) {
  const cache = useQueryClient();
  const [opened, setOpened] = useState(false),
    [settings, setSettings] = useState(false),
    [selected, setSelected] = useState<InboxItem | null>(null);
  const [ignored, setIgnored] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const query = useQuery({
    queryKey: ['document-inbox', ignored],
    queryFn: () =>
      api<{ config: InboxConfig; items: InboxItem[]; count: number }>(
        '/api/document-inbox' + (ignored ? '?ignored=1' : ''),
      ),
    refetchInterval: 15000,
  });
  const config = query.data?.config;
  const [nativeSelecting, setNativeSelecting] = useState(false);
  const form = useForm({
    initialValues: {
      type: '',
      target: null as string | null,
      analysis: 'local',
      processing: 'foreground',
    },
  });
  const configForm = useForm({
    initialValues: { folder: '', interval_minutes: 10 as number | string, enabled: true },
    validate: {
      folder: (value) => (!value.trim() ? 'Bitte einen Ordnerpfad angeben.' : null),
      interval_minutes: (value) =>
        !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 1440
          ? 'Bitte 1 bis 1440 Minuten angeben.'
          : null,
    },
  });
  const ai = !!bridge.ai.connected();
  const offers = useQuery({
    queryKey: ['inbox-offers'],
    enabled: !!selected && form.values.type === 'offer-version',
    queryFn: () => api('/api/offers'),
  });
  const documents = useQuery({
    queryKey: ['inbox-documents'],
    enabled: !!selected && form.values.type === 'document-version',
    queryFn: () => api('/api/project-documents'),
  });
  useDirtyGuard((settings && configForm.isDirty()) || (!!selected && form.isDirty()));
  function openSettings() {
    const values = {
      folder: config?.folder || '',
      interval_minutes: config?.interval_minutes || 10,
      enabled: config?.configured ? config.enabled : true,
    };
    configForm.setValues(values);
    configForm.resetDirty(values);
    configForm.clearErrors();
    setFailure(null);
    setSettings(true);
  }
  useEffect(() => {
    const handler = () => openSettings();
    window.addEventListener('phb-inbox-settings', handler);
    return () => window.removeEventListener('phb-inbox-settings', handler);
  }, [config]);
  const refresh = () => cache.invalidateQueries({ queryKey: ['document-inbox'] });
  async function chooseNativeFolder() {
    if (nativeSelecting) return;
    setNativeSelecting(true);
    setFailure(null);
    try {
      const result = await api<{ cancelled: boolean; folder?: string }>(
        '/api/document-inbox/native-folder',
        'POST',
        { folder: configForm.values.folder },
      );
      if (!result.cancelled && result.folder) {
        configForm.setFieldValue('folder', result.folder);
        configForm.clearFieldError('folder');
      }
    } catch (e) {
      setFailure(e);
    } finally {
      setNativeSelecting(false);
    }
  }
  async function saveSettings() {
    if (nativeSelecting || configForm.validate().hasErrors) return;
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/document-inbox/configure', 'POST', {
        ...configForm.values,
        interval_minutes: Number(configForm.values.interval_minutes),
      });
      await refresh();
      configForm.resetDirty();
      setSettings(false);
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function scan() {
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/document-inbox/scan', 'POST');
      await refresh();
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  function choose(item: InboxItem) {
    if (item.state !== 'new') return;
    const values = { type: '', target: null, analysis: 'local', processing: 'foreground' };
    form.setValues(values);
    form.resetDirty(values);
    form.clearErrors();
    setFailure(null);
    setSelected(item);
  }
  async function hide(item: InboxItem) {
    setBusy(true);
    try {
      await api('/api/document-inbox/items/' + item.id, 'PATCH', {
        state: item.state === 'ignored' ? 'new' : 'ignored',
      });
      await refresh();
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!selected || !form.values.type) {
      form.setFieldError('type', 'Bitte einen Dokumenttyp auswählen.');
      return;
    }
    if (['offer-version', 'document-version'].includes(form.values.type) && !form.values.target) {
      form.setFieldError('target', 'Bitte das zugehörige Dokument auswählen.');
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const type = form.values.type,
        fields: Row = {};
      const kind =
        type === 'offer'
          ? 'offers'
          : type === 'offer-version'
            ? 'versions'
            : ['invoice', 'till'].includes(type)
              ? 'receipts'
              : type === 'loan'
                ? 'loans'
                : 'documents';
      if (kind === 'versions') fields.offer_id = form.values.target;
      if (kind === 'receipts') fields.receipt_kind = type === 'till' ? 'Kassenzettel' : 'Rechnung';
      if (type === 'document-version') fields.version_document_id = form.values.target;
      if (type === 'funding') fields.review_context = 'funding';
      const analysisMode =
        kind === 'documents' ? 'local' : type === 'loan' ? 'ai' : form.values.analysis;
      const aiFields = analysisMode === 'ai' ? bridge.ai.selection() : {};
      const result = await bridge.imports.run({
        kind,
        inboxItemId: selected.id,
        fields,
        analysisMode,
        processingMode: form.values.processing,
        ...aiFields,
      });
      form.resetDirty();
      setSelected(null);
      setOpened(false);
      await refresh();
      if (!result.background) bridge.imports.review(result.jobs);
    } catch (e) {
      setFailure(e);
      void refresh();
    } finally {
      setBusy(false);
    }
  }
  const extension = selected?.filename.split('.').pop()?.toLowerCase();
  const types = kinds.map((item) => ({
    ...item,
    disabled:
      (['offer', 'offer-version'].includes(item.value) && extension !== 'pdf') ||
      (['invoice', 'till', 'loan'].includes(item.value) &&
        ['docx', 'txt'].includes(extension || '')) ||
      (item.value === 'loan' && !ai),
  }));
  const isReceipt = ['invoice', 'till'].includes(form.values.type),
    isDocument = ['document', 'document-version', 'funding'].includes(form.values.type);
  const targetRows: Row[] =
    form.values.type === 'offer-version'
      ? offers.data?.offers || []
      : documents.data?.documents || [];
  return (
    <>
      <Tooltip
        label={
          'Dokumenteneingang' +
          (query.data?.count ? ' · ' + query.data.count + ' neue Dokumente' : '')
        }
      >
        <ActionIcon
          variant="default"
          size={36}
          className="header-inbox-button"
          aria-label={'Dokumenteneingang' + (query.data?.count ? ': ' + query.data.count : '')}
          aria-haspopup="dialog"
          onClick={() => {
            setOpened(true);
            setFailure(null);
            void query.refetch();
          }}
        >
          <IconInbox size={19} />
          {!!query.data?.count && <span className="header-inbox-count">{query.data.count}</span>}
        </ActionIcon>
      </Tooltip>
      <Editor
        opened={opened}
        onClose={() => setOpened(false)}
        title="Dokumenteneingang"
        size="lg"
        zIndex={200}
        busy={busy}
        suspended={settings || !!selected}
        headerActions={
          <Tooltip label="Eingangsordner einstellen">
            <ActionIcon
              variant="subtle"
              aria-label="Eingangsordner einstellen"
              onClick={openSettings}
              disabled={busy}
            >
              <IconSettings size={18} />
            </ActionIcon>
          </Tooltip>
        }
      >
        <Stack gap="sm">
          <ErrorBox value={failure || query.error} />
          {!config?.configured ? (
            <>
              <Text size="sm">Noch kein Eingangsordner für dieses Projekt eingerichtet.</Text>
              <Button onClick={openSettings}>Ordner einrichten</Button>
            </>
          ) : (
            <>
              <Group justify="space-between">
                <div className="document-inbox-folder">
                  <Text size="sm" truncate title={config.folder}>
                    {config.folder}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {config.enabled
                      ? 'Prüfung alle ' + config.interval_minutes + ' Minuten'
                      : 'Automatische Prüfung pausiert'}
                    {config.last_scan
                      ? ' · Zuletzt ' + new Date(config.last_scan).toLocaleString()
                      : ''}
                  </Text>
                </div>
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconRefresh size={15} />}
                  loading={busy}
                  onClick={() => void scan()}
                >
                  Jetzt prüfen
                </Button>
              </Group>
              {config.error && <Alert color="orange">{config.error}</Alert>}
              <Checkbox
                label="Ausgeblendete anzeigen"
                checked={ignored}
                onChange={(event) => setIgnored(event.currentTarget.checked)}
              />
              <ScrollArea.Autosize mah="calc(55dvh / var(--phb-ui-zoom, 1))">
                <Stack gap="xs">
                  {query.data?.items.map((item) => (
                    <Paper withBorder radius="md" p="sm" key={item.id}>
                      <Group gap="sm" wrap="nowrap">
                        <IconFile size={20} />
                        <UnstyledButton
                          className="document-inbox-entry"
                          disabled={item.state !== 'new' || busy}
                          onClick={() => choose(item)}
                          aria-label={'Dokument zuordnen: ' + item.filename}
                        >
                          <Text size="sm" fw={600} truncate>
                            {item.filename}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {sizeLabel(item.size)} ·{' '}
                            {item.state === 'new'
                              ? 'Noch zuzuordnen'
                              : item.state === 'ignored'
                                ? 'Ausgeblendet'
                                : item.job?.status || 'Übernommen'}
                          </Text>
                        </UnstyledButton>
                        {item.state === 'queued' ? (
                          <Button
                            variant="light"
                            size="xs"
                            onClick={() => {
                              setOpened(false);
                              if (item.job?.review_url) bridge.navigate(item.job.review_url);
                              else bridge.imports.open();
                            }}
                          >
                            {item.job?.review_url ? 'Prüfen' : 'Warteschlange'}
                          </Button>
                        ) : (
                          <Tooltip
                            label={
                              item.state === 'ignored'
                                ? 'Wieder anzeigen'
                                : 'Aus Eingang ausblenden'
                            }
                          >
                            <ActionIcon
                              variant="subtle"
                              aria-label={
                                (item.state === 'ignored'
                                  ? 'Wieder anzeigen: '
                                  : 'Aus Eingang ausblenden: ') + item.filename
                              }
                              disabled={busy}
                              onClick={() => void hide(item)}
                            >
                              {item.state === 'ignored' ? (
                                <IconRestore size={16} />
                              ) : (
                                <IconX size={16} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Paper>
                  ))}
                  {!query.data?.items.length && (
                    <Text size="sm" c="dimmed" py="lg" ta="center">
                      Keine Dokumente zum Abarbeiten.
                    </Text>
                  )}
                </Stack>
              </ScrollArea.Autosize>
            </>
          )}
        </Stack>
      </Editor>
      <Editor
        opened={settings}
        onClose={() => setSettings(false)}
        title="Dokumenteneingang einstellen"
        dirty={configForm.isDirty()}
        busy={busy || nativeSelecting}
        zIndex={220}
      >
        <form onSubmit={configForm.onSubmit(() => void saveSettings())}>
          <Stack gap="sm">
            <ErrorBox value={failure} />
            <Group align="end" wrap="nowrap" gap="xs">
              <TextInput
                label="Eingangsordner"
                required
                maxLength={2048}
                placeholder="Ordner auswählen"
                style={{ flex: 1, minWidth: 0 }}
                {...configForm.getInputProps('folder')}
              />
              <Button
                variant="default"
                leftSection={<IconFolderOpen size={16} />}
                style={{ flexShrink: 0 }}
                loading={nativeSelecting}
                onClick={() => void chooseNativeFolder()}
              >
                Ordner auswählen
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              „Ordner auswählen“ öffnet den Systemdialog auf deinem PC. Die App muss dafür lokal auf
              diesem Rechner laufen. Es werden PDF, JPG, PNG, WEBP, DOCX und TXT direkt in diesem
              Ordner geprüft.
            </Text>
            <NumberInput
              label="Prüfintervall (Minuten)"
              required
              min={1}
              max={1440}
              allowDecimal={false}
              {...configForm.getInputProps('interval_minutes')}
            />
            <Switch
              label="Ordner regelmäßig prüfen"
              {...configForm.getInputProps('enabled', { type: 'checkbox' })}
            />
            <Text size="xs" c="dimmed">
              Originale bleiben im Ordner. Erst übernommene Dateien gehören zum Projektbackup.
              Umbenannte Kopien mit gleichem Inhalt werden nicht erneut angeboten.
            </Text>
            <Group justify="flex-end" mt="sm">
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={!!selected}
        onClose={() => setSelected(null)}
        title="Dokument zuordnen"
        dirty={form.isDirty()}
        busy={busy}
        zIndex={220}
      >
        <form onSubmit={form.onSubmit(() => void start())}>
          <Stack gap="sm">
            <ErrorBox value={failure} />
            <Group justify="space-between">
              <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }}>
                {selected?.filename}
              </Text>
              {selected && (
                <Anchor
                  href={projectURL(selected.preview_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  Datei ansehen
                </Anchor>
              )}
            </Group>
            <Select
              label="Dokumenttyp"
              required
              data={types}
              {...form.getInputProps('type')}
              onChange={(value) => {
                form.setFieldValue('type', value || '');
                form.setFieldValue('target', null);
                if (!['invoice', 'till'].includes(value || ''))
                  form.setFieldValue('analysis', 'local');
              }}
            />
            {['offer-version', 'document-version'].includes(form.values.type) && (
              <>
                <Select
                  label={
                    form.values.type === 'offer-version'
                      ? 'Zugehöriges Angebot'
                      : 'Zugehörige Projektunterlage'
                  }
                  searchable
                  required
                  data={targetRows.map((row) => ({
                    value: String(row.id),
                    label:
                      form.values.type === 'offer-version'
                        ? [row.vendor, row.offer_number, row.status].filter(Boolean).join(' · ')
                        : row.title,
                  }))}
                  {...form.getInputProps('target')}
                  nothingFoundMessage="Kein Eintrag gefunden"
                />
                <ErrorBox value={offers.error || documents.error} />
              </>
            )}
            {!!form.values.type && !isDocument && form.values.type !== 'loan' && (
              <Select
                label="Analyse"
                allowDeselect={false}
                data={[
                  { value: 'local', label: 'Lokal auslesen' },
                  { value: 'ai', label: 'Mit ChatGPT analysieren', disabled: !ai },
                  ...(isReceipt
                    ? [{ value: 'none', label: 'Ohne Analyse als Entwurf speichern' }]
                    : []),
                ]}
                {...form.getInputProps('analysis')}
              />
            )}
            {!!form.values.type && (
              <Select
                label="Verarbeitung"
                allowDeselect={false}
                data={[
                  { value: 'foreground', label: 'Im Vordergrund – direkt prüfen' },
                  { value: 'background', label: 'Im Hintergrund – später prüfen' },
                ]}
                {...form.getInputProps('processing')}
              />
            )}
            <Group justify="flex-end" mt="sm">
              <Button type="submit" loading={busy}>
                Verarbeitung starten
              </Button>
            </Group>
          </Stack>
        </form>
      </Editor>
    </>
  );
}

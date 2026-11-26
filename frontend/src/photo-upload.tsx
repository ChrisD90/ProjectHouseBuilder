import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  TagsInput,
  Text,
} from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';
import { api, ErrorBox, type Row, useConfirm, useConfirmVisible } from './core';
import { projectID } from './project-context';
import { useDirtyGuard } from './shell';
import type { PhotoSource } from './photos';
export function usePhotoFormats() {
  return useQuery({
    queryKey: ['photo-formats'],
    queryFn: () => api('/api/photos/formats'),
    staleTime: Infinity,
  });
}
export function PhotoUpload({
  source,
  onClose,
  onUploaded,
}: {
  source?: PhotoSource;
  onClose: () => void;
  onUploaded: (result: Row) => Promise<void>;
}) {
  const formats = usePhotoFormats(),
    tags = useQuery({ queryKey: ['photo-tags', projectID], queryFn: () => api('/api/photo-tags') }),
    sources = useQuery({
      queryKey: ['photo-sources', projectID],
      queryFn: () => api('/api/photos/sources'),
    });
  const initial = source ? [source.type + ':' + source.id] : [];
  const [files, setFiles] = useState<File[]>([]),
    [names, setNames] = useState<string[]>([]),
    [targets, setTargets] = useState<string[]>(initial),
    [compression, setCompression] = useState<string | null>('original'),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const lock = useRef(false),
    ask = useConfirm(),
    confirming = useConfirmVisible();
  const dirty =
    files.length > 0 ||
    names.length > 0 ||
    compression !== 'original' ||
    JSON.stringify(initial) !== JSON.stringify(targets);
  useDirtyGuard(dirty);
  async function close() {
    if (
      !busy &&
      (!dirty ||
        (await ask(
          'Dateiauswahl und Upload-Angaben verwerfen? Es wurden noch keine Bilder hochgeladen.',
        )))
    )
      onClose();
  }
  async function submit() {
    if (lock.current || !files.length) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('files', file));
      body.set('compression', compression || 'original');
      body.set('tags', JSON.stringify(names));
      body.set(
        'sources',
        JSON.stringify(
          targets.map((value) => {
            const [type, id] = value.split(':');
            return { source_type: type, source_id: Number(id) };
          }),
        ),
      );
      const result = await api('/api/photos', 'POST', body);
      await onUploaded(result);
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      opened
      title="Fotos hochladen"
      size="lg"
      zIndex={430}
      closeOnClickOutside={false}
      closeOnEscape={!busy && !confirming}
      trapFocus={!confirming}
      closeButtonProps={{ disabled: busy }}
      onClose={() => void close()}
    >
      <Stack gap="sm">
        <ErrorBox value={failure || formats.error || tags.error || sources.error} />
        <Text size="sm">
          Wähle deine Bilder aus und lege Tags sowie Zuordnungen direkt fest. Die Angaben gelten für
          alle ausgewählten Bilder.
        </Text>
        <FileInput
          label="Bilder auswählen"
          multiple
          clearable
          required
          disabled={busy || formats.isPending || !!formats.error}
          accept={formats.data?.accept || ''}
          value={files}
          onChange={setFiles}
          placeholder="Dateien auswählen"
        />
        <Text size="xs" c="dimmed">
          Unterstützte Formate:{' '}
          {(formats.data?.formats || [])
            .map((format: Row) => format.label + ' (' + format.extensions.join(', ') + ')')
            .join(' · ') || 'Formate werden geladen …'}
        </Text>
        {formats.data && !formats.data.heic_available && (
          <Alert color="yellow">
            HEIC/HEIF ist in dieser Installation noch nicht verfügbar. Bitte die App-Abhängigkeiten
            aktualisieren und die App neu starten.
          </Alert>
        )}
        <TagsInput
          label="Tags für diese Bilder"
          description="Freie Tags; sie erstellen keine Objektverknüpfungen."
          data={(tags.data?.tags || []).map((tag: Row) => tag.name)}
          value={names}
          onChange={setNames}
          maxTags={50}
          maxLength={60}
          disabled={busy}
          comboboxProps={{ zIndex: 480 }}
        />
        <MultiSelect
          label="Objekten zuordnen"
          description={
            source
              ? 'Der geöffnete Eintrag ist bereits ausgewählt. Weitere Einträge kannst du ergänzen.'
              : 'Ohne Zuordnung bleiben die Bilder zunächst nur in der Fotobibliothek.'
          }
          searchable
          clearable
          data={(sources.data?.sources || [])
            .filter(Boolean)
            .map((item: Row) => ({ value: item.type + ':' + item.id, label: item.label }))}
          value={targets}
          onChange={setTargets}
          maxValues={100}
          disabled={busy || sources.isPending}
          comboboxProps={{ zIndex: 480 }}
        />
        <Select
          label="Bildgröße beim Upload"
          allowDeselect={false}
          data={[
            { value: 'original', label: 'Originalgröße beibehalten' },
            { value: 'compact', label: 'Komprimiert speichern' },
          ]}
          value={compression}
          onChange={setCompression}
          disabled={busy}
          comboboxProps={{ zIndex: 480 }}
        />
        <Text size="xs" c="dimmed">
          Komprimiert: bis zu 2560 Pixel als WEBP mit Qualität 82, sofern die Datei dadurch kleiner
          wird. Deine Quelldateien bleiben unverändert. {formats.data?.hint}
        </Text>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {files.length} Bilder ·{' '}
            {(files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toLocaleString(
              'de-DE',
              { maximumFractionDigits: 1 },
            )}{' '}
            MB
          </Text>
          <Group>
            <Button variant="default" disabled={busy} onClick={() => void close()}>
              Schließen
            </Button>
            <Button
              leftSection={<IconUpload size={15} />}
              loading={busy}
              disabled={
                !files.length ||
                formats.isPending ||
                !!formats.error ||
                tags.isPending ||
                !!tags.error ||
                sources.isPending ||
                !!sources.error
              }
              onClick={() => void submit()}
            >
              Hochladen
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Group,
  Modal,
  MultiSelect,
  Select,
  Stack,
  TagsInput,
  Text,
} from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';
import { api, ErrorBox, type Row, useConfirm, useConfirmVisible } from './core';
import { projectID } from './project-context';
import { useDirtyGuard } from './shell';
const actions = [
  { value: 'add', label: 'Hinzufügen' },
  { value: 'remove', label: 'Entfernen' },
];
export function PhotoBulk({
  ids,
  onClose,
  onSaved,
}: {
  ids: number[];
  onClose: () => void;
  onSaved: (result: Row) => Promise<void>;
}) {
  const sources = useQuery({
      queryKey: ['photo-sources', projectID],
      queryFn: () => api('/api/photos/sources'),
    }),
    tags = useQuery({ queryKey: ['photo-tags', projectID], queryFn: () => api('/api/photo-tags') });
  const [names, setNames] = useState<string[]>([]),
    [rooms, setRooms] = useState<string[]>([]),
    [objects, setObjects] = useState<string[]>([]),
    [tagAction, setTagAction] = useState<string | null>('add'),
    [roomAction, setRoomAction] = useState<string | null>('add'),
    [objectAction, setObjectAction] = useState<string | null>('add'),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const lock = useRef(false),
    ask = useConfirm(),
    confirming = useConfirmVisible(),
    dirty = names.length + rooms.length + objects.length > 0;
  useDirtyGuard(dirty);
  async function close() {
    if (!busy && (!dirty || (await ask('Die ungespeicherte Sammelbearbeitung verwerfen?'))))
      onClose();
  }
  const choices: Row[] = sources.data?.sources || [],
    isRoom = (item: Row) => item.type === 'companion' && item.kind === 'room';
  const options = (rows: Row[]) =>
    rows.map((item) => ({ value: item.type + ':' + item.id, label: item.label }));
  async function save() {
    if (lock.current || !dirty) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const convert = (values: string[]) =>
        values.map((value) => {
          const [type, id] = value.split(':');
          return { source_type: type, source_id: Number(id) };
        });
      const result = await api('/api/photos/bulk', 'POST', {
        photo_ids: ids,
        add_tags: tagAction === 'add' ? names : [],
        remove_tags: tagAction === 'remove' ? names : [],
        add_sources: convert([
          ...(roomAction === 'add' ? rooms : []),
          ...(objectAction === 'add' ? objects : []),
        ]),
        remove_sources: convert([
          ...(roomAction === 'remove' ? rooms : []),
          ...(objectAction === 'remove' ? objects : []),
        ]),
      });
      await onSaved(result);
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
      title="Fotos gesammelt bearbeiten"
      size="lg"
      zIndex={430}
      closeOnClickOutside={false}
      closeOnEscape={!busy && !confirming}
      trapFocus={!confirming}
      closeButtonProps={{ disabled: busy }}
      onClose={() => void close()}
    >
      <Stack gap="sm">
        <Text fw={600} size="sm">
          {ids.length} Fotos ausgewählt
        </Text>
        <Alert>
          Die gewählten Änderungen gelten für alle markierten Fotos. Hinzufügen erhält vorhandene
          Tags und Zuordnungen. Entfernen löst nur die hier angegebenen Tags oder Verknüpfungen.
          Bilddateien und Aufnahmedaten bleiben unverändert.
        </Alert>
        <ErrorBox value={failure || sources.error || tags.error} />
        <Group align="start" wrap="nowrap">
          <Select
            label="Tags-Aktion"
            data={actions}
            value={tagAction}
            onChange={setTagAction}
            allowDeselect={false}
            w={145}
            disabled={busy}
            comboboxProps={{ zIndex: 480 }}
          />
          <TagsInput
            label="Tags"
            maxTags={50}
            maxLength={60}
            data={(tags.data?.tags || []).map((item: Row) => item.name)}
            value={names}
            onChange={setNames}
            disabled={busy || tags.isPending}
            style={{ flex: 1, minWidth: 0 }}
            comboboxProps={{ zIndex: 480 }}
          />
        </Group>
        <Group align="start" wrap="nowrap">
          <Select
            label="Räume-Aktion"
            data={actions}
            value={roomAction}
            onChange={setRoomAction}
            allowDeselect={false}
            w={145}
            disabled={busy}
            comboboxProps={{ zIndex: 480 }}
          />
          <MultiSelect
            label="Räume"
            placeholder="Räume auswählen"
            nothingFoundMessage="Keine passenden Räume gefunden"
            searchable
            clearable
            value={rooms}
            onChange={setRooms}
            data={options(choices.filter(isRoom))}
            disabled={busy || sources.isPending}
            style={{ flex: 1, minWidth: 0 }}
            comboboxProps={{ zIndex: 480 }}
          />
        </Group>
        <Group align="start" wrap="nowrap">
          <Select
            label="Objekte-Aktion"
            data={actions}
            value={objectAction}
            onChange={setObjectAction}
            allowDeselect={false}
            w={145}
            disabled={busy}
            comboboxProps={{ zIndex: 480 }}
          />
          <MultiSelect
            label="Weitere Objekte"
            placeholder="Einträge auswählen"
            nothingFoundMessage="Keine passenden Einträge gefunden"
            description="Zum Beispiel Angebote, Notizen oder Bautagebuch."
            searchable
            clearable
            value={objects}
            onChange={setObjects}
            data={options(choices.filter((item) => !isRoom(item)))}
            disabled={busy || sources.isPending}
            style={{ flex: 1, minWidth: 0 }}
            comboboxProps={{ zIndex: 480 }}
          />
        </Group>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" disabled={busy} onClick={() => void close()}>
            Schließen
          </Button>
          <Button
            leftSection={<IconCheck size={15} />}
            loading={busy}
            disabled={
              !dirty || sources.isPending || !!sources.error || tags.isPending || !!tags.error
            }
            onClick={() => void save()}
          >
            Änderungen anwenden
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

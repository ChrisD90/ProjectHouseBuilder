import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  FileButton,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Popover,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconCamera,
  IconDownload,
  IconLink,
  IconPhoto,
  IconInfoCircle,
  IconSearch,
  IconFilter,
  IconArrowsSort,
  IconPlus,
  IconTag,
  IconTrash,
  IconUnlink,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, ErrorBox, type Row, useConfirm, useConfirmVisible } from './core';
import { useDirtyGuard } from './shell';
import { PageHeader } from './page-layout';
import { projectID, projectURL } from './project-context';
import { displayDate } from './presentation';
import { PhotoOverlayContext } from './photo-context';
import './photos.css';
export type PhotoSource = { type: string; id: number };
function usePhotos(source?: PhotoSource) {
  return useQuery({
    queryKey: ['photos', projectID, source?.type || '', source?.id || 0],
    queryFn: () =>
      api(
        '/api/photos' +
          (source
            ? '?source_type=' + encodeURIComponent(source.type) + '&source_id=' + source.id
            : ''),
      ),
    staleTime: 0,
  });
}
function useTags() {
  return useQuery({ queryKey: ['photo-tags', projectID], queryFn: () => api('/api/photo-tags') });
}
function usePhotoChanges() {
  const cache = useQueryClient();
  return async () => {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['photos'] }),
      cache.invalidateQueries({ queryKey: ['photo-tags'] }),
      cache.invalidateQueries({ queryKey: ['photo-detail'] }),
    ]);
    window.dispatchEvent(new Event('phb-photos-changed'));
  };
}
export function SourcePhotos({ type, id }: { type: string; id: number }) {
  const query = usePhotos({ type, id }),
    count = query.data?.photos?.length || 0;
  return (
    <Tooltip label={'Fotos · ' + count}>
      <ActionIcon
        variant="default"
        className="phb-corner-action photo-trigger"
        aria-label={'Fotos anzeigen · ' + count}
        onClick={() =>
          window.dispatchEvent(new CustomEvent('phb-photos-open', { detail: { type, id } }))
        }
      >
        <IconCamera size={17} />
        {count > 0 && <span className="photo-count">{count}</span>}
      </ActionIcon>
    </Tooltip>
  );
}
export function PhotoProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<PhotoSource | null>(null),
    [inner, setInner] = useState(false);
  const confirming = useConfirmVisible();
  useEffect(() => {
    const open = (event: Event) => {
      const value = (event as CustomEvent<PhotoSource>).detail;
      if (value && typeof value.type === 'string' && Number.isSafeInteger(value.id) && value.id > 0)
        setSource(value);
    };
    const close = () => setSource(null);
    window.addEventListener('phb-photos-open', open);
    window.addEventListener('phb-photos-close', close);
    return () => {
      window.removeEventListener('phb-photos-open', open);
      window.removeEventListener('phb-photos-close', close);
    };
  }, []);
  return (
    <PhotoOverlayContext.Provider value={!!source}>
      {children}
      {source && (
        <Modal
          opened
          size="min(1180px, 94vw)"
          title="Verknüpfte Fotos"
          zIndex={400}
          closeOnClickOutside={false}
          trapFocus={!inner && !confirming}
          closeOnEscape={!inner && !confirming}
          withCloseButton={!inner}
          onClose={() => {
            if (!inner) setSource(null);
          }}
        >
          <PhotoCollection
            key={source.type + ':' + source.id}
            source={source}
            onLayerChange={setInner}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" disabled={inner} onClick={() => setSource(null)}>
              Schließen
            </Button>
          </Group>
        </Modal>
      )}
    </PhotoOverlayContext.Provider>
  );
}
export function PhotosPage() {
  return (
    <div className="page">
      <PageHeader
        title="Fotobibliothek"
        description="Gemeinsame Fotos, freie Tags und Verknüpfungen im Projekt."
      />
      <PhotoCollection />
    </div>
  );
}
function PhotoCollection({
  source,
  onLayerChange,
}: {
  source?: PhotoSource;
  onLayerChange?: (value: boolean) => void;
}) {
  const [search, setSearch] = useState(''),
    [tagIds, setTagIds] = useState<string[]>([]),
    [sort, setSort] = useState<string | null>('new'),
    [compression, setCompression] = useState<string | null>('original'),
    [uploadSummary, setUploadSummary] = useState<Row | null>(null),
    [pick, setPick] = useState(false),
    [selected, setSelected] = useState<number[]>([]),
    [detail, setDetail] = useState<number | null>(null),
    [manageTags, setManageTags] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const query = usePhotos(pick ? undefined : source),
    tags = useTags(),
    changed = usePhotoChanges(),
    operation = useRef(false);
  useEffect(() => {
    onLayerChange?.(detail !== null || manageTags || busy);
    return () => onLayerChange?.(false);
  }, [detail, manageTags, busy, onLayerChange]);
  async function run(fn: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await fn();
      await changed();
    } catch (e) {
      setFailure(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function upload(files: File[]) {
    if (!files.length) return;
    await run(async () => {
      const data = new FormData();
      files.forEach((f) => data.append('files', f));
      data.set('compression', compression || 'original');
      if (source) {
        data.set('source_type', source.type);
        data.set('source_id', String(source.id));
      }
      const result = await api('/api/photos', 'POST', data);
      setUploadSummary(result.upload_summary || null);
    });
  }
  const rows: Row[] = (query.data?.photos || [])
    .filter(
      (p: Row) =>
        (!search ||
          [p.title, p.description, p.filename, ...p.tags.map((t: Row) => t.name)]
            .join(' ')
            .toLocaleLowerCase('de')
            .includes(search.toLocaleLowerCase('de'))) &&
        tagIds.every((id) => p.tags.some((t: Row) => String(t.id) === id)),
    )
    .sort((a: Row, b: Row) =>
      sort === 'az'
        ? a.title.localeCompare(b.title, 'de')
        : sort === 'old'
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at),
    );
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {source
            ? 'Fotos werden verknüpft, nicht kopiert. Das Lösen hier verändert keine anderen Zuordnungen.'
            : 'Ein Foto kann mehreren Einträgen zugeordnet sein. Tags dienen ausschließlich der Suche.'}
        </Text>
        <Group gap={6}>
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<IconTag size={15} />}
            disabled={busy}
            onClick={() => setManageTags(true)}
          >
            Tags verwalten
          </Button>
          {source && (
            <Button
              variant="default"
              disabled={busy}
              leftSection={<IconLink size={15} />}
              onClick={() => {
                setPick(!pick);
                setSelected([]);
              }}
            >
              {pick ? 'Zurück zu verknüpften Fotos' : 'Aus Bibliothek hinzufügen'}
            </Button>
          )}
          <Select
            comboboxProps={{ zIndex: 480, withinPortal: true }}
            aria-label="Bildgröße beim Upload"
            value={compression}
            onChange={setCompression}
            allowDeselect={false}
            disabled={busy}
            w={225}
            data={[
              { value: 'original', label: 'Originalgröße beibehalten' },
              { value: 'compact', label: 'Komprimiert speichern' },
            ]}
          />
          <Popover width={310} withinPortal zIndex={480} position="bottom-end" shadow="md">
            <Popover.Target>
              <ActionIcon variant="subtle" aria-label="Information zur Bildkomprimierung">
                <IconInfoCircle size={17} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Text size="sm">
                Komprimiert: bis zu 2560 Pixel, WEBP mit Qualität 82. Wird die Datei dadurch nicht
                kleiner, bleibt sie unverändert. Die App speichert nur die gewählte Version. Deine
                Quelldatei auf dem Rechner bleibt unverändert.
              </Text>
            </Popover.Dropdown>
          </Popover>
          <FileButton
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(files) => void upload(files)}
          >
            {(props) => (
              <Button {...props} loading={busy} leftSection={<IconPlus size={15} />}>
                Fotos hochladen
              </Button>
            )}
          </FileButton>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Group align="end" gap="sm">
          <TextInput
            className="photo-search"
            leftSection={<IconSearch size={17} />}
            leftSectionPointerEvents="none"
            label="Fotos suchen"
            placeholder="Titel, Beschreibung oder Tag"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <MultiSelect
            comboboxProps={{ zIndex: 480, withinPortal: true }}
            className="photo-tag-filter"
            leftSection={<IconFilter size={17} />}
            leftSectionPointerEvents="none"
            label="Tags"
            placeholder="Alle Tags"
            searchable
            clearable
            data={(tags.data?.tags || []).map((t: Row) => ({ value: String(t.id), label: t.name }))}
            value={tagIds}
            onChange={setTagIds}
          />
          <Select
            comboboxProps={{ zIndex: 480, withinPortal: true }}
            label="Sortierung"
            leftSection={<IconArrowsSort size={17} />}
            leftSectionPointerEvents="none"
            data={[
              { value: 'new', label: 'Neueste zuerst' },
              { value: 'old', label: 'Älteste zuerst' },
              { value: 'az', label: 'Titel A–Z' },
            ]}
            value={sort}
            onChange={setSort}
            allowDeselect={false}
          />
        </Group>
      </Paper>
      <ErrorBox value={failure || query.error || tags.error} />
      {uploadSummary && (
        <Text size="xs" c="dimmed">
          {uploadSummary.optimized_count > 0
            ? `${uploadSummary.optimized_count} Fotos komprimiert · ${Math.round(uploadSummary.input_bytes / 1024).toLocaleString('de-DE')} KB → ${Math.round(uploadSummary.stored_bytes / 1024).toLocaleString('de-DE')} KB`
            : 'Upload abgeschlossen. Die Bilddateien wurden unverändert übernommen.'}
        </Text>
      )}
      {query.isPending ? (
        <Loader size="sm" />
      ) : (
        <>
          <Text c="dimmed" size="xs">
            {rows.length} Fotos · JPEG, PNG oder WEBP · Originale bleiben auch unter Dokumente
            erhalten.
          </Text>
          {pick && (
            <Group>
              <Text size="sm">{selected.length} ausgewählt</Text>
              <Button
                disabled={!selected.length || busy}
                onClick={() =>
                  void run(async () => {
                    await api('/api/photos/links', 'POST', {
                      source_type: source!.type,
                      source_id: source!.id,
                      photo_ids: selected,
                      action: 'add',
                    });
                    setPick(false);
                    setSelected([]);
                  })
                }
              >
                Auswahl verknüpfen
              </Button>
            </Group>
          )}
          <div className="photo-scroll">
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
              {rows.map((p) => (
                <Paper withBorder key={p.id} className="photo-card">
                  <UnstyledButton
                    className="photo-card-open"
                    onClick={() =>
                      pick
                        ? setSelected(
                            selected.includes(p.id)
                              ? selected.filter((x) => x !== p.id)
                              : [...selected, p.id],
                          )
                        : setDetail(p.id)
                    }
                    aria-label={pick ? 'Foto auswählen: ' + p.title : 'Foto öffnen: ' + p.title}
                  >
                    <div className="photo-image-wrap">
                      <img src={projectURL(p.thumbnail_url)} alt={p.title} loading="lazy" />
                      {pick && (
                        <Checkbox
                          checked={selected.includes(p.id)}
                          readOnly
                          tabIndex={-1}
                          aria-hidden
                          className="photo-selection"
                        />
                      )}
                    </div>
                    <Text size="sm" fw={600} lineClamp={1} p="xs">
                      {p.title}
                    </Text>
                  </UnstyledButton>
                  <div className="photo-card-footer">
                    <Text size="xs" c="dimmed">
                      {p.taken_on ? displayDate(p.taken_on) : displayDate(p.created_at)} ·{' '}
                      {p.links.length} Verknüpfungen
                    </Text>
                    <Group gap={3} mt={4}>
                      {p.tags.slice(0, 3).map((t: Row) => (
                        <Badge key={t.id} size="xs" variant="light">
                          {t.name}
                        </Badge>
                      ))}
                      {p.tags.length > 3 && <Text size="xs">+{p.tags.length - 3}</Text>}
                    </Group>
                    {source && !pick && (
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        leftSection={<IconUnlink size={13} />}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api('/api/photos/links', 'POST', {
                              source_type: source.type,
                              source_id: source.id,
                              photo_ids: [p.id],
                              action: 'remove',
                            });
                          })
                        }
                      >
                        Hier lösen
                      </Button>
                    )}
                  </div>
                </Paper>
              ))}
            </SimpleGrid>
            {!rows.length && (
              <Paper withBorder p="xl">
                <Stack align="center" gap="sm">
                  <IconPhoto size={30} />
                  <Text c="dimmed" size="sm">
                    Keine passenden Fotos. Lade Fotos hoch oder passe die Suche an.
                  </Text>
                </Stack>
              </Paper>
            )}
          </div>
        </>
      )}
      {detail !== null && <PhotoDetails id={detail} onClose={() => setDetail(null)} />}
      {manageTags && <TagManager onClose={() => setManageTags(false)} />}
      {busy && <Alert>Fotos werden verarbeitet. Bitte den Abschluss abwarten.</Alert>}
    </Stack>
  );
}
function PhotoDetails({ id, onClose }: { id: number; onClose: () => void }) {
  const query = useQuery({
      queryKey: ['photo-detail', projectID, id],
      queryFn: () => api('/api/photos/' + id),
    }),
    tags = useTags(),
    sources = useQuery({
      queryKey: ['photo-sources', projectID],
      queryFn: () => api('/api/photos/sources'),
    });
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [targets, setTargets] = useState<string[]>([]),
    [ready, setReady] = useState(false);
  const changed = usePhotoChanges(),
    ask = useConfirm(),
    confirming = useConfirmVisible(),
    navigate = useNavigate(),
    operation = useRef(false);
  const form = useForm({
      initialValues: {
        title: '',
        description: '',
        taken_on: '',
        tags: [] as string[],
        revision: '',
      },
    }),
    p = query.data?.photo;
  useDirtyGuard(form.isDirty());
  useEffect(() => {
    if (p && !ready) {
      const value = {
        title: p.title,
        description: p.description,
        taken_on: p.taken_on,
        tags: p.tags.map((t: Row) => t.name),
        revision: p.revision,
      };
      form.setValues(value);
      form.setInitialValues(value);
      setReady(true);
    }
  }, [p, ready]);
  async function close() {
    if (!busy && (!form.isDirty() || (await ask('Ungespeicherte Fotodaten verwerfen?')))) onClose();
  }
  async function run(fn: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await fn();
      await changed();
    } catch (e) {
      setFailure(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      opened
      title="Foto"
      size="min(1200px, 95vw)"
      zIndex={430}
      closeOnClickOutside={false}
      closeOnEscape={!busy && !confirming}
      withCloseButton={!busy}
      onClose={() => void close()}
    >
      <ErrorBox value={failure || query.error} />
      {!p || !ready ? (
        <Loader />
      ) : (
        <div className="photo-detail">
          <div className="photo-detail-image">
            <img src={projectURL(p.image_url)} alt={p.title} />
            <Button
              component="a"
              href={projectURL(p.original_url)}
              variant="default"
              leftSection={<IconDownload size={15} />}
              mt="sm"
            >
              Original herunterladen
            </Button>
          </div>
          <Stack gap="sm">
            <TextInput
              label="Titel"
              required
              maxLength={200}
              disabled={busy}
              {...form.getInputProps('title')}
            />
            <TextInput
              label="Aufnahmedatum"
              type="date"
              disabled={busy}
              {...form.getInputProps('taken_on')}
            />
            <Textarea
              label="Beschreibung"
              minRows={2}
              maxLength={5000}
              disabled={busy}
              {...form.getInputProps('description')}
            />
            <TagsInput
              comboboxProps={{ zIndex: 480, withinPortal: true }}
              label="Tags"
              description="Frei vergeben. Tags erstellen keine Objektverknüpfungen."
              data={(tags.data?.tags || []).map((t: Row) => t.name)}
              maxTags={50}
              disabled={busy}
              {...form.getInputProps('tags')}
            />
            <Text fw={600} size="sm">
              Verknüpfte Einträge
            </Text>
            {p.links.map((link: Row) => (
              <Group key={link.link_id} justify="space-between" wrap="nowrap">
                <UnstyledButton
                  disabled={!link.url || busy}
                  onClick={async () => {
                    if (
                      !form.isDirty() ||
                      (await ask('Ungespeicherte Fotodaten verwerfen und zum Eintrag wechseln?'))
                    ) {
                      onClose();
                      window.dispatchEvent(new Event('phb-photos-close'));
                      requestAnimationFrame(() => navigate(link.url));
                    }
                  }}
                >
                  <Text size="sm">{link.label}</Text>
                </UnstyledButton>
                <Tooltip label="Nur diese Verknüpfung lösen">
                  <ActionIcon
                    variant="default"
                    disabled={busy}
                    aria-label={'Verknüpfung lösen: ' + link.label}
                    onClick={() =>
                      void run(async () => {
                        await api('/api/photos/links', 'POST', {
                          source_type: link.type,
                          source_id: link.id,
                          photo_ids: [id],
                          action: 'remove',
                        });
                      })
                    }
                  >
                    <IconUnlink size={15} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
            {!p.links.length && (
              <Text size="sm" c="dimmed">
                Noch keinem Eintrag zugeordnet.
              </Text>
            )}
            <MultiSelect
              comboboxProps={{ zIndex: 480, withinPortal: true }}
              label="Weitere Einträge auswählen"
              searchable
              clearable
              value={targets}
              onChange={setTargets}
              disabled={busy}
              data={(sources.data?.sources || [])
                .filter(Boolean)
                .map((s: Row) => ({ value: s.type + ':' + s.id, label: s.label }))}
            />
            <Button
              variant="default"
              disabled={!targets.length || busy}
              onClick={() =>
                void run(async () => {
                  await api('/api/photos/links', 'POST', {
                    sources: targets.map((value) => {
                      const [type, key] = value.split(':');
                      return { source_type: type, source_id: Number(key) };
                    }),
                    photo_ids: [id],
                    action: 'add',
                  });
                  setTargets([]);
                })
              }
            >
              Verknüpfungen hinzufügen
            </Button>
          </Stack>
        </div>
      )}
      <Group justify="space-between" mt="md">
        <Tooltip label="Das Original bleibt unter Dokumente erhalten. Verknüpfte Fotos zuerst lösen.">
          <Button
            variant="subtle"
            color="red"
            disabled={!p || busy || !!p.links.length}
            leftSection={<IconTrash size={15} />}
            onClick={() =>
              void run(async () => {
                if (
                  !(await ask(
                    'Foto aus der Bibliothek entfernen? Das Original bleibt unter Dokumente erhalten.',
                  ))
                )
                  return;
                await api('/api/photos/' + id, 'DELETE', { revision: p.revision });
                onClose();
              })
            }
          >
            Aus Bibliothek entfernen
          </Button>
        </Tooltip>
        <Group>
          <Button variant="default" disabled={busy} onClick={() => void close()}>
            Schließen
          </Button>
          <Button
            loading={busy}
            disabled={!ready || !form.isDirty() || !form.values.title.trim()}
            onClick={() =>
              void run(async () => {
                const result = await api('/api/photos/' + id, 'PATCH', form.values);
                const value = { ...form.values, revision: result.photo.revision };
                form.setValues(value);
                form.setInitialValues(value);
                form.resetDirty(value);
              })
            }
          >
            Speichern
          </Button>
        </Group>
      </Group>
    </Modal>
  );
}
function TagManager({ onClose }: { onClose: () => void }) {
  const query = useTags(),
    changed = usePhotoChanges(),
    ask = useConfirm(),
    confirming = useConfirmVisible();
  const [name, setName] = useState(''),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    operation = useRef(false);
  async function run(fn: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await fn();
      await changed();
    } catch (e) {
      setFailure(e);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      opened
      title="Foto-Tags verwalten"
      zIndex={460}
      closeOnClickOutside={false}
      closeOnEscape={!busy && !confirming}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Stack>
        <ErrorBox value={failure || query.error} />
        <Text size="sm" c="dimmed">
          Umbenennen und Löschen betrifft nur die Tags der Fotos. Objektverknüpfungen bleiben
          unverändert.
        </Text>
        <TextInput
          label={id ? 'Tag umbenennen' : 'Neuer Tag'}
          maxLength={60}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          {id && (
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                setID(null);
                setName('');
              }}
            >
              Zurück
            </Button>
          )}
          <Button
            disabled={!name.trim() || busy}
            onClick={() =>
              void run(async () => {
                await api('/api/photo-tags' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
                  name,
                });
                setID(null);
                setName('');
              })
            }
          >
            {id ? 'Speichern' : 'Tag anlegen'}
          </Button>
        </Group>
        <div className="photo-tags-list">
          {(query.data?.tags || []).map((t: Row) => (
            <Group key={t.id} justify="space-between">
              <UnstyledButton
                disabled={busy}
                onClick={() => {
                  setID(t.id);
                  setName(t.name);
                }}
              >
                <Text size="sm">
                  {t.name}{' '}
                  <Text component="span" c="dimmed" size="xs">
                    ({t.count})
                  </Text>
                </Text>
              </UnstyledButton>
              <ActionIcon
                color="red"
                variant="subtle"
                disabled={busy}
                aria-label={'Tag löschen: ' + t.name}
                onClick={() =>
                  void run(async () => {
                    if (
                      await ask(
                        'Tag „' +
                          t.name +
                          '“ von ' +
                          t.count +
                          ' Fotos entfernen? Die Fotos und ihre Objektverknüpfungen bleiben erhalten.',
                      )
                    ) {
                      await api('/api/photo-tags/' + t.id, 'DELETE', { confirm: true });
                      if (id === t.id) {
                        setID(null);
                        setName('');
                      }
                    }
                  })
                }
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Group>
          ))}
        </div>
        <Group justify="flex-end">
          <Button variant="default" disabled={busy} onClick={onClose}>
            Schließen
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

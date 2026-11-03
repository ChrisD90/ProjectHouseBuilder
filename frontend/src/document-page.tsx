import {
  Anchor,
  Button,
  FileInput,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Editor, ErrorBox, Row, api, success, useConfirm } from './core';
import { DocumentFields, emptyDocument } from './document-fields';
import { PageHeader } from './page-layout';
import { projectURL } from './project-context';
import { useDirtyGuard } from './shell';
import {
  ActionBar,
  DocumentPreview,
  SearchField,
  StatusPill,
  useViewState,
  useDialogRouteCleanup,
  FilterSelect,
} from './ui';
import { SourceWork } from './work';
export function Documents() {
  const query = useQuery({
    queryKey: ['documents'],
    staleTime: 0,
    queryFn: async () => {
      const [docs, library] = await Promise.all([
        api('/api/project-documents'),
        api('/api/document-library'),
      ]);
      return { ...docs, library: library.documents || library.entries || [] };
    },
  });
  const cache = useQueryClient(),
    navigate = useNavigate(),
    ask = useConfirm(),
    [params] = useSearchParams();
  const [search, setSearch] = useViewState('search', ''),
    [area, setArea] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [tab, setTab] = useState<string | null>('project'),
    [source, setSource] = useState<string | null>(null),
    [opened, setOpened] = useState(false),
    [upload, setUpload] = useState(false),
    [files, setFiles] = useState<File[]>([]),
    [mode, setMode] = useState<string | null>('foreground'),
    [record, setRecord] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const edit = useForm<Row>({ initialValues: emptyDocument }),
    metadata = useForm<Row>({ initialValues: emptyDocument });
  useDialogRouteCleanup(opened || upload, ['document_id', 'upload', 'area', 'return_to']);
  const uploadRoute = useRef('');
  const data: Row = query.data || {};
  useEffect(() => {
    const token = params.toString();
    if (params.get('upload') === '1' && data.areas && uploadRoute.current !== token) {
      uploadRoute.current = token;
      const area = data.areas.includes(params.get('area')) ? params.get('area') : 'Allgemein';
      const values = {
        ...emptyDocument,
        area,
        category: area === 'Energetische Planung' ? 'iSFP' : emptyDocument.category,
      };
      metadata.setValues(values);
      metadata.setInitialValues(values);
      metadata.resetDirty(values);
      setArea(area);
      setUpload(true);
    }
  }, [data.areas, params]);
  useDirtyGuard((opened && edit.isDirty()) || (upload && (files.length > 0 || metadata.isDirty())));
  function open(row: Row) {
    setRecord(row);
    const values = { ...emptyDocument, ...row };
    edit.setValues(values);
    edit.setInitialValues(values);
    edit.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  useEffect(() => {
    const id = Number(params.get('document_id'));
    const row = data.documents?.find((d: Row) => d.id === id);
    if (row && record?.id !== id) open(row);
  }, [data.documents, params.get('document_id')]);
  const documents: Row[] = (data.documents || []).filter(
    (d: Row) =>
      (!area || d.area === area) &&
      (!status || d.status === status) &&
      [d.title, d.filename, d.category, d.tags, d.description].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  const library: Row[] = (data.library || []).filter(
    (d: Row) =>
      d.source !== 'Projektdokumente' &&
      (!source || d.source === source) &&
      [d.title, d.filename, d.type, d.source, d.status, d.description].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  async function save(remove = false) {
    if (busy) return;
    if (!record) return;
    if (remove && !(await ask('Dieses Projektdokument endgültig löschen?'))) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/project-documents/' + record.id,
        remove ? 'DELETE' : 'PATCH',
        remove
          ? undefined
          : Object.fromEntries(Object.keys(emptyDocument).map((key) => [key, edit.values[key]])),
      );
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['documents'] });
      await (window as any).PHBReactBridge.imports.refresh();
      success(remove ? 'Dokument gelöscht.' : 'Dokument gespeichert.');
      await cache.invalidateQueries({ queryKey: ['energy'] });
      if (params.get('return_to') === 'energy') navigate('/energieplanung');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy) return;
    if (!files.length) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await (window as any).PHBReactBridge.imports.run({
        kind: 'documents',
        files,
        analysisMode: 'local',
        processingMode: mode,
        fields: metadata.values,
      });
      setUpload(false);
      setFiles([]);
      await cache.invalidateQueries({ queryKey: ['documents'] });
      if (result.background && params.get('return_to') === 'energy') navigate('/energieplanung');
      if (!result.background && result.jobs[0]?.result_id)
        setTimeout(
          () =>
            navigate(
              '/dokumente?document_id=' +
                result.jobs[0].result_id +
                (params.get('return_to') === 'energy' ? '&return_to=energy' : ''),
            ),
          0,
        );
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <PageHeader
        title="Dokumente"
        description="Projektunterlagen und Originalbelege an einem Ort."
      >
        <Button
          leftSection={<IconPlus size={17} />}
          onClick={() => {
            metadata.setValues({
              ...emptyDocument,
              area: area || data.areas?.[0] || 'Allgemein',
              category: area === 'Energetische Planung' ? 'iSFP' : emptyDocument.category,
            });
            metadata.setInitialValues(metadata.getValues());
            metadata.resetDirty();
            setFiles([]);
            setFailure(null);
            setUpload(true);
          }}
        >
          Dokumente hochladen
        </Button>
      </PageHeader>
      <ErrorBox value={query.error} />
      {query.isPending && <Loader />}
      <Paper className="paper">
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="project">Projektunterlagen</Tabs.Tab>
            <Tabs.Tab value="linked">Angebote, Rechnungen & Kreditunterlagen</Tabs.Tab>
          </Tabs.List>
          <Group mb="lg">
            <SearchField
              aria-label="Dokumente suchen"
              placeholder="Dokumente suchen"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            {tab === 'project' ? (
              <>
                <FilterSelect
                  aria-label="Bereich"
                  placeholder="Alle Bereiche"
                  clearable
                  data={data.areas || []}
                  value={area}
                  onChange={setArea}
                />
                <FilterSelect
                  aria-label="Dokumentstatus"
                  placeholder="Alle Status"
                  clearable
                  data={data.statuses || []}
                  value={status}
                  onChange={setStatus}
                />
              </>
            ) : (
              <FilterSelect
                aria-label="Dokumentquelle"
                placeholder="Alle Bereiche"
                clearable
                data={
                  [
                    ...new Set(
                      (data.library || [])
                        .filter((d: Row) => d.source !== 'Projektdokumente')
                        .map((d: Row) => d.source),
                    ),
                  ] as string[]
                }
                value={source}
                onChange={setSource}
              />
            )}
          </Group>
          <Tabs.Panel value="project">
            <Stack>
              {documents.map((d) => (
                <Paper withBorder p="md" key={d.id}>
                  <Group justify="space-between">
                    <div>
                      <Text fw={600} size="sm">
                        {d.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[d.category, d.area, d.filename].filter(Boolean).join(' · ')}
                      </Text>
                    </div>
                    <StatusPill variant="light" color={d.status === 'Aktuell' ? 'teal' : 'gray'}>
                      {d.status}
                    </StatusPill>
                  </Group>
                  {d.description && (
                    <Text size="sm" mt="xs">
                      {d.description}
                    </Text>
                  )}
                  <Group mt="sm">
                    {['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt'].includes(d.extension) && (
                      <Button
                        variant="light"
                        size="xs"
                        component="a"
                        href={projectURL('/api/project-documents/' + d.id + '/preview')}
                        target="_blank"
                      >
                        Ansehen
                      </Button>
                    )}
                    <Button
                      variant="default"
                      size="xs"
                      component="a"
                      href={projectURL('/api/project-documents/' + d.id + '/download')}
                    >
                      Herunterladen
                    </Button>
                    <Button variant="subtle" size="xs" onClick={() => open(d)}>
                      Bearbeiten
                    </Button>
                  </Group>
                </Paper>
              ))}
              {!documents.length && (
                <Text c="dimmed" size="sm">
                  Keine passenden Projektdokumente.
                </Text>
              )}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="linked">
            <Text size="xs" c="dimmed" mb="md">
              Originale bleiben in ihrem Fachbereich. Eine Änderung erfolgt dort.
            </Text>
            <Stack>
              {library.map((d) => (
                <Paper withBorder p="md" key={d.id}>
                  <Group justify="space-between">
                    <div>
                      <Text size="sm" fw={600}>
                        {d.title}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {d.source} · {d.type} · {d.status}
                      </Text>
                    </div>
                    <Button variant="subtle" size="xs" onClick={() => navigate(d.module_url)}>
                      Im Bereich öffnen
                    </Button>
                  </Group>
                  <Group mt="sm">
                    {d.view_url && (
                      <Anchor size="xs" href={projectURL(d.view_url)} target="_blank">
                        Original ansehen
                      </Anchor>
                    )}
                    <Anchor size="xs" href={projectURL(d.download_url)}>
                      Herunterladen
                    </Anchor>
                  </Group>
                </Paper>
              ))}
              {!library.length && (
                <Text size="sm" c="dimmed">
                  Keine passenden Originalbelege.
                </Text>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Paper>
      <Editor
        opened={opened}
        title="Dokument pflegen"
        dirty={edit.isDirty()}
        changes={edit.values}
        original={edit.getInitialValues()}
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
            {record && /\.(pdf|png|jpe?g|webp)$/i.test(record.original_name || '') && (
              <DocumentPreview
                url={projectURL('/api/project-documents/' + record.id + '/preview')}
                title="Vorschau des Dokuments"
                image={!/\.pdf$/i.test(record.original_name)}
              />
            )}
            <DocumentFields form={edit} options={data} />
            {record && <SourceWork type="document" id={record.id} />}
            <Text size="xs" c="dimmed">
              Überholte Unterlagen bleiben archiviert und werden nicht automatisch mit ChatGPT
              geteilt.
            </Text>
            <ErrorBox value={failure} />
            <ActionBar>
              <Button
                variant="subtle"
                color="red"
                mr="auto"
                disabled={busy}
                onClick={() => save(true)}
              >
                Löschen
              </Button>
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </ActionBar>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={upload}
        title="Dokumente hochladen"
        dirty={files.length > 0 || metadata.isDirty()}
        busy={busy}
        onClose={() => setUpload(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Stack>
            <FileInput
              label="Dateien"
              description="Bis zu 8 Dateien à 12 MB. Dateien werden lokal eingelesen."
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx"
              multiple
              required
              value={files}
              onChange={(values) => {
                setFiles(values);
                if (!metadata.values.title && values[0])
                  metadata.setFieldValue('title', values[0].name.replace(/\.[^.]+$/, ''));
              }}
            />
            <DocumentFields form={metadata} options={data} />
            <Select
              label="Verarbeitung"
              value={mode}
              onChange={setMode}
              data={[
                {
                  value: 'foreground',
                  label: 'Im Vordergrund – direkt prüfen',
                },
                {
                  value: 'background',
                  label: 'Im Hintergrund – später prüfen',
                },
              ]}
            />
            <ErrorBox value={failure} />
            <ActionBar>
              <Button type="submit" loading={busy}>
                Dateien einlesen
              </Button>
            </ActionBar>
          </Stack>
        </form>
      </Editor>
    </div>
  );
}

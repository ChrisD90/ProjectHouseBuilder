import {
  Accordion,
  ActionIcon,
  Anchor,
  Button,
  FileInput,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconHistory, IconUpload } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Editor, ErrorBox, Row, success } from './core';
import { DocumentPreview, ActionBar } from './ui';
import { projectURL } from './project-context';
import { useDirtyGuard } from './shell';
export function DocumentVersions({
  document,
  dirty,
  initialVersion,
  onUpdated,
  onBackground,
  onLayerChange,
  onBusyChange,
}: {
  document: Row;
  dirty: boolean;
  initialVersion?: number | null;
  onUpdated: () => Promise<void>;
  onBackground: () => void;
  onLayerChange: (open: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const cache = useQueryClient(),
    [upload, setUpload] = useState(false),
    [history, setHistory] = useState(false),
    [review, setReview] = useState<number | null>(initialVersion || null),
    [file, setFile] = useState<File | null>(null),
    [mode, setMode] = useState<string | null>('foreground'),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const query = useQuery({
    queryKey: ['document-versions', document.id],
    queryFn: () => api('/api/project-documents/' + document.id + '/versions'),
    enabled: history || review !== null,
    staleTime: 0,
  });
  const requestedVersion = useRef(initialVersion);
  useEffect(() => {
    if (initialVersion && requestedVersion.current !== initialVersion) {
      requestedVersion.current = initialVersion;
      setReview(initialVersion);
    }
  }, [initialVersion]);
  const rows: Row[] = query.data?.versions || [],
    draft = rows.find((row) => row.version === review);
  useEffect(() => {
    onLayerChange(upload || history || review !== null);
    return () => onLayerChange(false);
  }, [upload, history, review]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy]);
  useDirtyGuard(upload && !!file);
  async function submit() {
    if (!file || busy || dirty) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await (window as any).PHBReactBridge.imports.run({
        kind: 'documents',
        files: [file],
        analysisMode: 'local',
        processingMode: mode,
        fields: { version_document_id: String(document.id) },
      });
      setUpload(false);
      setFile(null);
      await cache.invalidateQueries({ queryKey: ['document-versions', document.id] });
      if (result.background) {
        onBackground();
        return;
      }
      const versions = await api('/api/project-documents/' + document.id + '/versions');
      await onUpdated();
      setReview(versions.versions.find((row: Row) => row.state === 'draft')?.version || null);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  async function decide(action: 'activate' | 'discard') {
    if (!review || busy || dirty) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/project-documents/' + document.id + '/versions/' + review + '/' + action,
        'POST',
      );
      setReview(null);
      setHistory(false);
      await onUpdated();
      await cache.invalidateQueries({ queryKey: ['document-versions', document.id] });
      await cache.invalidateQueries({ queryKey: ['funding-document-options'] });
      await cache.invalidateQueries({ queryKey: ['energy'] });
      await cache.invalidateQueries({ queryKey: ['funding-plan'] });
      await cache.invalidateQueries({ queryKey: ['funding-plan-options'] });
      await (window as any).PHBReactBridge.imports.refresh();
      success(
        action === 'activate' ? 'Neue Dokumentversion übernommen.' : 'Versionsentwurf verworfen.',
      );
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Tooltip label={dirty ? 'Bitte Änderungen zuerst speichern' : 'Neue Version hochladen'}>
        <ActionIcon
          variant="default"
          aria-label="Neue Dokumentversion hochladen"
          disabled={dirty || busy}
          onClick={() => {
            setFailure(null);
            setFile(null);
            setUpload(true);
          }}
        >
          <IconUpload size={17} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Versionshistorie">
        <ActionIcon
          variant="default"
          aria-label="Dokument-Versionshistorie"
          disabled={busy}
          onClick={() => {
            setFailure(null);
            setHistory(true);
          }}
        >
          <IconHistory size={17} />
        </ActionIcon>
      </Tooltip>
      <Editor
        opened={upload}
        title="Neue Dokumentversion hochladen"
        dirty={!!file}
        busy={busy}
        onClose={() => setUpload(false)}
        zIndex={300}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Stack>
            <Text size="sm">
              Die bisherige Datei bleibt aktuell, bis du die neue Fassung nach dem Einlesen
              übernimmst.
            </Text>
            <FileInput
              label="Neue Datei"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.docx"
              required
              value={file}
              onChange={setFile}
            />
            <Select
              label="Verarbeitung"
              value={mode}
              onChange={setMode}
              data={[
                { value: 'foreground', label: 'Im Vordergrund – direkt prüfen' },
                { value: 'background', label: 'Im Hintergrund – später prüfen' },
              ]}
            />
            <ErrorBox value={failure} />
            <ActionBar>
              <Button type="submit" loading={busy}>
                Neue Version einlesen
              </Button>
            </ActionBar>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={history}
        title="Dokument-Versionshistorie"
        onClose={() => setHistory(false)}
        zIndex={300}
      >
        <Stack>
          <ErrorBox value={query.error} />
          {query.isPending ? (
            <Loader />
          ) : (
            <Accordion>
              {rows.map((row) => (
                <Accordion.Item key={row.version} value={String(row.version)}>
                  <Accordion.Control>
                    Version {row.version} ·{' '}
                    {row.state === 'current'
                      ? 'Aktuelle Fassung'
                      : row.state === 'draft'
                        ? 'Versionsentwurf'
                        : row.state === 'discarded'
                          ? 'Verworfener Entwurf'
                          : 'Frühere Fassung'}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <Text size="sm" fw={600}>
                        {row.filename}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {row.category} · {row.area} · {row.uploaded_at?.slice(0, 10)}
                      </Text>
                      {row.description && <Text size="sm">{row.description}</Text>}
                      <Group>
                        {row.view_url && (
                          <Anchor
                            href={projectURL(row.view_url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Original öffnen
                          </Anchor>
                        )}
                        <Anchor href={projectURL(row.download_url)}>Herunterladen</Anchor>
                        {row.state === 'draft' && (
                          <Button
                            size="xs"
                            disabled={dirty}
                            onClick={() => {
                              setHistory(false);
                              setReview(row.version);
                            }}
                          >
                            Versionsentwurf prüfen
                          </Button>
                        )}
                      </Group>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          )}
        </Stack>
      </Editor>
      <Editor
        opened={review !== null}
        title={'Dokumentversion ' + review + ' prüfen'}
        busy={busy}
        onClose={() => setReview(null)}
        zIndex={300}
        size="xl"
      >
        <Stack>
          <ErrorBox value={failure || query.error} />
          {query.isPending ? (
            <Loader />
          ) : draft ? (
            <>
              <Text fw={600}>{draft.filename}</Text>
              {draft.view_url && (
                <>
                  <Anchor
                    href={projectURL(draft.view_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Datei öffnen
                  </Anchor>
                  {/\.(pdf|png|jpe?g|webp)$/i.test(draft.filename) && (
                    <DocumentPreview
                      url={projectURL(draft.view_url)}
                      title="Neue Dokumentversion"
                      image={!/\.pdf$/i.test(draft.filename)}
                    />
                  )}
                </>
              )}
              <Text size="sm" c="dimmed">
                Titel, Kategorie, Verknüpfungen und Notizen des Dokuments bleiben erhalten. Die
                bisherige Datei bleibt in der Historie.
              </Text>
              {draft.state === 'draft' ? (
                <ActionBar>
                  <Button
                    variant="subtle"
                    color="red"
                    mr="auto"
                    disabled={dirty}
                    onClick={() => decide('discard')}
                  >
                    Entwurf verwerfen
                  </Button>
                  <Button disabled={dirty} loading={busy} onClick={() => decide('activate')}>
                    Version übernehmen
                  </Button>
                </ActionBar>
              ) : (
                <Text>
                  Dieser Versionsentwurf wurde bereits bearbeitet. Die Fassung ist über die Historie
                  abrufbar.
                </Text>
              )}
            </>
          ) : (
            <Text>
              Diese Version wurde bereits übernommen oder ist nicht mehr als Entwurf verfügbar.
            </Text>
          )}
        </Stack>
      </Editor>
    </>
  );
}

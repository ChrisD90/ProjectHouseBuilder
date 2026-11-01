import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@mantine/form';
import { Alert, Anchor, Button, FileInput, Select, Stack, Text } from '@mantine/core';
import { projectURL } from './project-context';
import { api, Editor, ErrorBox, Row, success } from './core';
import { DocumentFields, emptyDocument } from './document-fields';
import { useDirtyGuard } from './shell';

/** Same local queue and metadata editor as documents, with a durable funding review route. */
export function FundingDocumentIntake({
  opened,
  fundingId,
  onClose,
  reviewId,
  reviewFundingId,
  onReview,
  onSaved,
  missingFunding,
}: {
  opened: boolean;
  fundingId: number | null;
  onClose: () => void;
  reviewId: number | null;
  reviewFundingId: number | null;
  onReview: (document: number | null, funding?: number | null) => void;
  onSaved: (document: Row, funding: number | null) => void;
  missingFunding?: boolean;
}) {
  const query = useQuery({
    queryKey: ['funding-document-options'],
    queryFn: () => api('/api/project-documents'),
    enabled: opened || !!reviewId,
    staleTime: 0,
  });
  const [files, setFiles] = useState<File[]>([]),
    [mode, setMode] = useState<string | null>('foreground'),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const metadata = useForm<Row>({
    initialValues: { ...emptyDocument, area: 'Energetische Planung', category: 'iSFP' },
  });
  const edit = useForm<Row>({ initialValues: emptyDocument });
  const cache = useQueryClient();
  const initialized = useRef<number | null>(null),
    pending = useRef(false);
  const data: Row = query.data || {};
  const record = data.documents?.find((d: Row) => d.id === reviewId);
  useDirtyGuard(
    (opened && (files.length > 0 || metadata.isDirty())) || (!!reviewId && edit.isDirty()),
  );
  useEffect(() => {
    if (opened) {
      const values = { ...emptyDocument, area: 'Energetische Planung', category: 'iSFP' };
      metadata.setValues(values);
      metadata.resetDirty(values);
      setFiles([]);
      setFailure(null);
    }
  }, [opened]);
  useEffect(() => {
    if (!reviewId) {
      initialized.current = null;
      return;
    }
    if (!record || initialized.current === reviewId) return;
    const values = { ...emptyDocument, ...record, area: 'Energetische Planung' };
    edit.setValues(values);
    edit.resetDirty(values);
    initialized.current = reviewId;
    setFailure(null);
  }, [reviewId, record]);
  async function upload() {
    if (pending.current || !files.length) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await (window as any).PHBReactBridge.imports.run({
        kind: 'documents',
        files,
        analysisMode: 'local',
        processingMode: mode,
        fields: {
          ...metadata.values,
          area: 'Energetische Planung',
          review_context: 'funding',
          ...(fundingId ? { funding_id: fundingId } : {}),
        },
      });
      setFiles([]);
      onClose();
      await Promise.all([
        query.refetch(),
        cache.invalidateQueries({ queryKey: ['energy'] }),
        cache.invalidateQueries({ queryKey: ['documents'] }),
      ]);
      if (!result.background && result.jobs[0]?.result_id)
        onReview(result.jobs[0].result_id, fundingId);
    } catch (e) {
      setFailure(e);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (pending.current || !record) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const fields = Object.fromEntries(
        Object.keys(emptyDocument).map((key) => [key, edit.values[key]]),
      );
      const result = await api('/api/project-documents/' + record.id, 'PATCH', {
        ...fields,
        area: 'Energetische Planung',
        ...(reviewFundingId ? { funding_id: reviewFundingId } : {}),
      });
      onSaved(result.document, reviewFundingId);
      onReview(null);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['energy'] }),
        cache.invalidateQueries({ queryKey: ['documents'] }),
        cache.invalidateQueries({ queryKey: ['funding-document-options'] }),
        (window as any).PHBReactBridge.imports.refresh(),
      ]);
      success('Förderunterlage gespeichert.');
    } catch (e) {
      setFailure(e);
      void cache.invalidateQueries({ queryKey: ['energy'] });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Editor
        opened={opened}
        title="Förderunterlagen hochladen"
        dirty={files.length > 0 || metadata.isDirty()}
        busy={busy}
        onClose={onClose}
        zIndex={260}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            upload();
          }}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              Die Unterlagen bleiben hier in der Förderplanung und sind zusätzlich unter Dokumente
              verfügbar.
            </Text>
            <FileInput
              label="Dateien"
              description="Bis zu 8 Dateien à 12 MB. Verarbeitung lokal auf dem App-Server."
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
            <DocumentFields form={metadata} options={data} fixedArea="Energetische Planung" />
            <Select
              label="Verarbeitung"
              value={mode}
              onChange={setMode}
              data={[
                { value: 'foreground', label: 'Im Vordergrund – direkt prüfen' },
                { value: 'background', label: 'Im Hintergrund – später prüfen' },
              ]}
            />
            <ErrorBox value={failure || query.error} />
            <div className="actions">
              <Button type="submit" loading={busy} disabled={query.isPending}>
                Dateien einlesen
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
      <Editor
        opened={!!reviewId}
        title="Förderunterlage prüfen"
        dirty={edit.isDirty()}
        busy={busy}
        onClose={() => onReview(null)}
        zIndex={260}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Stack>
            {record && (
              <Anchor
                href={projectURL(
                  '/api/project-documents/' +
                    record.id +
                    (record.extension === '.docx' ? '/download' : '/preview'),
                )}
                target="_blank"
                rel="noreferrer"
              >
                Original öffnen ↗
              </Anchor>
            )}
            <Text size="sm" c="dimmed">
              Angaben prüfen und speichern. Das Original wird einmal gespeichert und in beiden
              Bereichen angezeigt.
            </Text>
            {missingFunding && (
              <Alert color="yellow">
                Die zugehörige Förderung ist nicht mehr vorhanden. Die Unterlage kann weiterhin im
                Förderbereich gespeichert werden.
                <Button variant="subtle" size="xs" onClick={() => onReview(reviewId, null)}>
                  Zuordnung entfernen
                </Button>
              </Alert>
            )}
            {record ? (
              <DocumentFields form={edit} options={data} fixedArea="Energetische Planung" />
            ) : (
              <Text size="sm">
                {query.isPending || query.isFetching
                  ? 'Unterlage wird geladen …'
                  : 'Die Unterlage ist nicht mehr vorhanden.'}
              </Text>
            )}
            <ErrorBox value={failure || query.error} />
            <div className="actions">
              <Button type="submit" loading={busy} disabled={!record || missingFunding}>
                Speichern
              </Button>
            </div>
          </Stack>
        </form>
      </Editor>
    </>
  );
}

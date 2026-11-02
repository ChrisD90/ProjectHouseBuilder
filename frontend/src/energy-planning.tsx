import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Editor, ErrorBox, Row, api, money, success, useConfirm } from './core';
import { FundingCheck } from './funding-check';
import { FundingDocumentIntake } from './funding-documents';
import { FundingPlanDialog } from './funding-plan';
import { Metrics, PageHeader } from './page-layout';
import { projectURL } from './project-context';
import { useDirtyGuard } from './shell';
import { ActionBar, RowAction, SearchField, StatusPill, useViewState } from './ui';
import { SourceWork } from './work';
const emptyFunding: Row = {
  assessment_inputs: {},
  document_ids: [],
  name: '',
  provider: '',
  program: '',
  status: 'In Prüfung',
  expected: 0,
  confirmed: 0,
  received: 0,
  deadline: '',
  applied_on: '',
  reference: '',
  offer_id: null,
  budget_line_id: null,
  source_url: '',
  notes: '',
};
export function Energy() {
  const query = useQuery({
      queryKey: ['energy'],
      staleTime: 0,
      queryFn: () => api('/api/energy-planning'),
    }),
    cache = useQueryClient(),
    ask = useConfirm(),
    [params, setParams] = useSearchParams();
  const [search, setSearch] = useViewState('search', ''),
    [opened, setOpened] = useState(false),
    [id, setID] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const [uploadDocuments, setUploadDocuments] = useState(false),
    [uploadFunding, setUploadFunding] = useState<number | null>(null);
  const documentId = Number(params.get('funding_document')) || null,
    documentFunding = Number(params.get('document_funding_id')) || null;
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api('/api/ai/status'), staleTime: 60000 });
  const [planOpened, setPlanOpened] = useState(false),
    [planId, setPlanId] = useState<number | null>(null),
    [planOffer, setPlanOffer] = useState<number | null>(null),
    [latestDocument, setLatestDocument] = useState<{
      fundingId: number;
      documentId: number;
    } | null>(null);
  const handledOffer = useRef('');
  function startPlan(ident: number | null = null, offer: number | null = null) {
    setPlanId(ident);
    setPlanOffer(offer);
    setPlanOpened(true);
  }
  const form = useForm<Row>({ initialValues: emptyFunding });
  function startDocuments(funding: number | null = null) {
    setUploadFunding(funding);
    setUploadDocuments(true);
  }
  function reviewDocument(document: number | null, funding: number | null = null) {
    const next = new URLSearchParams(params);
    next.delete('funding_document');
    next.delete('document_funding_id');
    if (document) next.set('funding_document', String(document));
    if (document && funding) next.set('document_funding_id', String(funding));
    setParams(next, { replace: true });
  }
  useDirtyGuard(opened && form.isDirty());
  const data: Row = query.data || {};
  function open(row: Row | null = null, offer?: number, manual = false) {
    if (row?.planning && !row.planning.adopted && !manual) {
      startPlan(row.id);
      return;
    }
    setID(row?.id || null);
    const values = { ...emptyFunding, ...row };
    if (offer && !row) {
      const found = data.offers?.find((o: Row) => o.id === offer);
      values.offer_id = String(offer);
      values.name = found ? 'Förderprüfung: ' + found.category : '';
    }
    for (const key of ['offer_id', 'budget_line_id'])
      values[key] = values[key] ? String(values[key]) : null;
    form.setValues(values);
    form.setInitialValues(values);
    form.resetDirty(values);
    setFailure(null);
    setOpened(true);
  }
  useEffect(() => {
    const offer = Number(params.get('offer_id'));
    const token = params.get('offer_id') || '';
    if (query.data && offer && (ai.isSuccess || ai.isError) && handledOffer.current !== token) {
      handledOffer.current = token;
      if (ai.data?.sharing) startPlan(null, offer);
      else open(null, offer);
    }
    if (!offer) handledOffer.current = '';
  }, [!!query.data, params.get('offer_id'), ai.isSuccess, ai.isError]);
  useEffect(() => {
    const row = data.funding?.find((r: Row) => r.id === Number(params.get('funding_id')));
    if (row && !opened) open(row);
  }, [!!query.data, params.get('funding_id')]);
  async function save(remove = false) {
    if (busy) return;
    if (remove && !(await ask('Diese Förderung endgültig löschen?'))) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(
        '/api/funding' + (id ? '/' + id : ''),
        remove ? 'DELETE' : id ? 'PUT' : 'POST',
        remove ? undefined : form.values,
      );
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['energy'] });
      success(remove ? 'Förderung gelöscht.' : 'Förderung gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  const rows: Row[] = (data.funding || []).filter((r: Row) =>
    [r.name, r.program, r.provider, r.status].some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
  );
  return (
    <div className="page">
      <PageHeader
        title="Energetische Planung"
        description="Förderungen planen, Fristen festhalten und Angeboten zuordnen."
      >
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconPlus size={17} />}
            onClick={() => startDocuments()}
          >
            Unterlagen hochladen
          </Button>
          {ai.data?.sharing && (
            <Button leftSection={<IconPlus size={17} />} onClick={() => startPlan()}>
              Förderung planen
            </Button>
          )}
          <Button variant="light" leftSection={<IconPlus size={17} />} onClick={() => open()}>
            Förderung erfassen
          </Button>
        </Group>
      </PageHeader>
      <ErrorBox value={query.error} />
      {query.isPending && <Loader />}
      <Metrics
        loading={query.isPending}
        values={[
          ['Erwartet', money(data.summary?.funding_expected)],
          ['Bewilligt', money(data.summary?.funding_confirmed)],
          ['Erhalten', money(data.received)],
          ['Prognose nach Förderung', money(data.summary?.net_after_confirmed)],
        ]}
      />
      <Text size="xs" c="dimmed" mb="lg">
        Erwartete Förderungen werden nicht von den Bruttokosten abgezogen. Bewilligungen und
        Auszahlungen erzeugen keine automatischen Finanzierungsbuchungen.
      </Text>
      <Paper className="paper">
        <Group justify="space-between" mb="lg">
          <Title order={3} size="h5">
            Förderplanung
          </Title>
          <SearchField
            aria-label="Förderungen suchen"
            placeholder="Förderungen suchen"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Group>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                {['Maßnahme / Programm', 'Status / Frist', 'Erwartet', 'Bewilligt', 'Erhalten'].map(
                  (k) => (
                    <Table.Th key={k}>{k}</Table.Th>
                  ),
                )}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id} className="table-button" onClick={() => open(r)}>
                  <Table.Td>
                    <RowAction onActivate={() => open(r)}>
                      <Text size="sm" fw={600}>
                        {r.name}
                      </Text>
                      {r.planning?.stale && (
                        <Badge size="xs" color="yellow" variant="light">
                          Prüfgrundlage geändert
                        </Badge>
                      )}
                      <Text size="xs" c="dimmed">
                        {[r.provider, r.program].filter(Boolean).join(' · ')}
                      </Text>
                    </RowAction>
                  </Table.Td>
                  <Table.Td>
                    <StatusPill>{r.status}</StatusPill>
                    <Text size="xs" c="dimmed">
                      {r.deadline || 'Keine Frist erfasst'}
                    </Text>
                  </Table.Td>
                  {['expected', 'confirmed', 'received'].map((key) => (
                    <Table.Td key={key}>
                      {key === 'expected' && r.planning && !r.planning.adopted && !r.expected
                        ? 'Noch offen'
                        : money(r[key])}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {!rows.length && (
          <Text size="sm" c="dimmed">
            Keine passenden Förderungen.
          </Text>
        )}
      </Paper>
      <Paper className="paper" mt="lg">
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={3} size="h5">
              Förderunterlagen
            </Title>
            <Text size="sm" c="dimmed">
              iSFP, Förderbescheide und technische Nachweise zentral hinterlegen und einzelnen
              Förderungen zuordnen.
            </Text>
          </div>
        </Group>
        <Stack gap="xs">
          {(data.documents || []).map((d: Row) => (
            <Group justify="space-between" key={d.id}>
              <div>
                <Text size="sm" fw={600}>
                  {d.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {d.category}
                </Text>
              </div>
              <Group gap="xs">
                <Button size="compact-xs" variant="subtle" onClick={() => reviewDocument(d.id)}>
                  Bearbeiten
                </Button>
                <Anchor
                  size="sm"
                  href={projectURL(
                    '/api/project-documents/' +
                      d.id +
                      (['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt'].includes(d.extension)
                        ? '/preview'
                        : '/download'),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  {d.extension === '.docx' ? 'Herunterladen' : 'Öffnen'} ↗
                </Anchor>
              </Group>
            </Group>
          ))}
          {!data.documents?.length && (
            <Text size="sm" c="dimmed">
              Noch keine Förderunterlagen hinterlegt.
            </Text>
          )}
        </Stack>
      </Paper>
      <Paper className="paper" mt="lg">
        <Title order={3} size="h5" mb="sm">
          Fördercheck vorbereiten
        </Title>
        <Text size="sm" c="dimmed">
          Vor Auftrag und Maßnahmenbeginn Programmbedingungen, Antragstermin und technische
          Nachweise prüfen. Eine Kategorie allein belegt keine Förderfähigkeit.
        </Text>
        <Group mt="md">
          {(data.sources || []).map((s: Row) => (
            <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" size="sm">
              {s.name} ↗
            </Anchor>
          ))}
        </Group>
      </Paper>
      <Editor
        opened={opened}
        title={id ? 'Förderung bearbeiten' : 'Förderung erfassen'}
        dirty={form.isDirty()}
        changes={form.values}
        original={form.getInitialValues()}
        busy={busy}
        suspended={uploadDocuments || !!documentId || planOpened}
        onClose={() => setOpened(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Maßnahme"
                required
                maxLength={200}
                {...form.getInputProps('name')}
              />
              <TextInput label="Fördergeber" maxLength={200} {...form.getInputProps('provider')} />
              <TextInput
                label="Programm / Nummer"
                maxLength={200}
                {...form.getInputProps('program')}
              />
              <Select label="Status" data={data.statuses || []} {...form.getInputProps('status')} />
              {[
                ['expected', 'Erwartet'],
                ['confirmed', 'Bewilligt'],
                ['received', 'Ausgezahlt'],
              ].map(([key, label]) => (
                <NumberInput
                  key={key}
                  label={label + ' (€)'}
                  decimalScale={2}
                  decimalSeparator=","
                  thousandSeparator="."
                  min={0}
                  required
                  {...form.getInputProps(key)}
                />
              ))}
              <TextInput type="date" label="Antragsfrist" {...form.getInputProps('deadline')} />
              <TextInput
                type="date"
                label="Antrag gestellt am"
                {...form.getInputProps('applied_on')}
              />
              <TextInput
                label="Aktenzeichen"
                maxLength={160}
                {...form.getInputProps('reference')}
              />
              <Select
                label="Angebot"
                clearable
                searchable
                data={(data.offers || []).map((o: Row) => ({
                  value: String(o.id),
                  label: o.vendor + ' · ' + o.category + ' · ' + o.status,
                }))}
                {...form.getInputProps('offer_id')}
              />
              <Select
                label="Planposition"
                clearable
                searchable
                data={(data.budget_lines || []).map((b: Row) => ({
                  value: String(b.id),
                  label: b.category + ' · ' + b.title,
                }))}
                {...form.getInputProps('budget_line_id')}
              />
            </SimpleGrid>
            <TextInput
              label="Programmquelle"
              type="url"
              maxLength={1000}
              {...form.getInputProps('source_url')}
            />
            <Textarea
              label="Notizen / Voraussetzungen"
              minRows={3}
              maxLength={3000}
              {...form.getInputProps('notes')}
            />
            <MultiSelect
              label="Zugeordnete Förderunterlagen"
              description="Die wichtigsten Unterlagen oben im Förderbereich hochladen; anschließend hier auswählen."
              searchable
              clearable
              data={(data.documents || []).map((d: Row) => ({
                value: String(d.id),
                label: d.title + ' · ' + d.category,
              }))}
              value={(form.values.document_ids || []).map(String)}
              onChange={(ids) => form.setFieldValue('document_ids', ids.map(Number))}
            />
            {id && (
              <Button
                variant="light"
                leftSection={<IconPlus size={16} />}
                onClick={() => startDocuments(id)}
              >
                Unterlagen zu dieser Förderung hochladen
              </Button>
            )}
            {id && data.funding?.find((r: Row) => r.id === id)?.planning && (
              <Button
                variant="light"
                onClick={async () => {
                  if (
                    form.isDirty() &&
                    !(await ask('Ungespeicherte Förderangaben verwerfen und die Planung öffnen?'))
                  )
                    return;
                  setOpened(false);
                  startPlan(id);
                }}
              >
                Förderplanung & Prüfbericht öffnen
              </Button>
            )}
            {!(id && data.funding?.find((r: Row) => r.id === id)?.planning) && (
              <FundingCheck form={form} busy={busy} setBusy={setBusy} />
            )}
            {id && <SourceWork type="funding" id={id} />}
            <ErrorBox value={failure} />
            <ActionBar>
              {id && (
                <Button
                  color="red"
                  variant="subtle"
                  mr="auto"
                  onClick={() => save(true)}
                  disabled={busy}
                >
                  Löschen
                </Button>
              )}
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </ActionBar>
          </Stack>
        </form>
      </Editor>
      <FundingDocumentIntake
        opened={uploadDocuments}
        fundingId={uploadFunding}
        onClose={() => setUploadDocuments(false)}
        reviewId={documentId}
        reviewFundingId={documentFunding}
        missingFunding={
          !!documentFunding &&
          !!query.data &&
          !(data.funding || []).some((row: Row) => row.id === documentFunding)
        }
        onReview={reviewDocument}
        onSaved={(document, funding) => {
          if (funding) setLatestDocument({ fundingId: funding, documentId: document.id });
          if (opened && id && id === funding)
            form.setFieldValue('document_ids', [
              ...new Set([...(form.values.document_ids || []), document.id]),
            ]);
        }}
      />
      <FundingPlanDialog
        opened={planOpened}
        planId={planId}
        initialOffer={planOffer}
        suspended={uploadDocuments || !!documentId}
        latestDocument={latestDocument}
        onClose={() => setPlanOpened(false)}
        onSaved={() => void cache.invalidateQueries({ queryKey: ['energy'] })}
        onUpload={startDocuments}
        onManual={(row) => {
          setPlanOpened(false);
          open(row, undefined, true);
        }}
      />
    </div>
  );
}

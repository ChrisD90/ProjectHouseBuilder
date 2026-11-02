import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  Textarea,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDeviceFloppy, IconPlus } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, Editor, ErrorBox, money, Row, success } from './core';
import { useDirtyGuard } from './shell';
import { SourceWork } from './work';
const empty: Row = {
  name: '',
  notes: '',
  inputs: { program_key: '' },
  selections: [],
  document_ids: [],
  answers: '',
};
const yn = [
  { value: 'yes', label: 'Ja' },
  { value: 'no', label: 'Nein' },
];

export function FundingPlanDialog({
  opened,
  planId,
  initialOffer,
  suspended,
  latestDocument,
  onClose,
  onSaved,
  onUpload,
  onManual,
}: {
  opened: boolean;
  planId: number | null;
  initialOffer?: number | null;
  suspended: boolean;
  latestDocument: { fundingId: number; documentId: number } | null;
  onClose: () => void;
  onSaved: () => void;
  onUpload: (funding: number) => void;
  onManual: (funding: Row) => void;
}) {
  const [id, setID] = useState<number | null>(planId),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [saved, setSaved] = useState<Row | null>(null),
    [consent, setConsent] = useState(false),
    [accept, setAccept] = useState(false),
    [amount, setAmount] = useState<number | string>(''),
    [sections, setSections] = useState<string[]>(['object']),
    [costSections, setCostSections] = useState<string[]>([]),
    [jump, setJump] = useState<{ field: string; nonce: number } | null>(null);
  const editorRoot = useRef<HTMLFormElement>(null);
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api('/api/ai/status'), staleTime: 60000 });
  const options = useQuery({
    queryKey: ['funding-plan-options'],
    queryFn: () => api('/api/funding/plans/options'),
    enabled: opened,
    staleTime: 0,
  });
  const query = useQuery({
    queryKey: ['funding-plan', id],
    queryFn: () => api('/api/funding/plans/' + id),
    enabled: opened && !!id,
    staleTime: 0,
  });
  const form = useForm<Row>({ initialValues: empty }),
    handledDocument = useRef<typeof latestDocument>(null),
    initialized = useRef<number | null>(null),
    pending = useRef(false),
    cache = useQueryClient();
  const connected = !!ai.data?.sharing;
  useDirtyGuard(opened && form.isDirty());
  function hydrate(data: Row) {
    const values = {
      name: data.funding.name,
      notes: data.funding.notes || '',
      inputs: data.inputs,
      selections: data.selections,
      document_ids: data.document_ids,
      answers: data.answers,
    };
    form.setValues(values);
    form.setInitialValues(values);
    form.resetDirty(values);
    setSaved(data);
    initialized.current = data.id;
  }
  useEffect(() => {
    if (!opened) return;
    setID(planId);
    setStep(0);
    setSections(['object']);
    setCostSections([]);
    setJump(null);
    setFailure(null);
    setSaved(null);
    setConsent(false);
    setAccept(false);
    setAmount('');
    initialized.current = null;
    form.setValues(empty);
    form.setInitialValues(empty);
    form.resetDirty(empty);
  }, [opened, planId]);
  useEffect(() => {
    if (opened && !query.isFetching && query.data?.id === id) {
      if (initialized.current !== id) {
        hydrate(query.data);
        setStep(query.data.report?.token ? 2 : 0);
      } else setSaved(query.data);
    }
  }, [query.data, id, opened, query.isFetching]);
  useEffect(() => {
    if (!opened || id || !initialOffer || !options.data || form.values.selections.length) return;
    const o = options.data.offers.find((x: Row) => x.id === initialOffer);
    if (o) {
      form.setValues({
        name: 'Förderplanung: ' + o.category,
        inputs: { program_key: '', measure: 'Fördermöglichkeiten für ' + o.category + ' prüfen.' },
        selections: [selection(o)],
      });
    }
  }, [opened, id, initialOffer, options.data]);
  useEffect(() => {
    if (
      !opened ||
      !id ||
      latestDocument?.fundingId !== id ||
      handledDocument.current === latestDocument
    )
      return;
    handledDocument.current = latestDocument;
    if (initialized.current === id)
      form.setFieldValue('document_ids', [
        ...new Set([...(form.values.document_ids || []), latestDocument.documentId]),
      ]);
    void cache.invalidateQueries({ queryKey: ['funding-plan-options'] });
    void query.refetch();
  }, [latestDocument, opened, id]);
  const signature = JSON.stringify(form.values);
  useEffect(() => {
    setConsent(false);
    setAccept(false);
  }, [signature]);
  useEffect(() => {
    setAccept(false);
    setAmount(saved?.report?.amount_min ?? '');
  }, [saved?.report?.token]);
  const source: Row = options.data || {},
    input = form.values.inputs || {},
    selections: Row[] = form.values.selections || [];
  function jumpTo(check: Row) {
    const field = check.missing_fields?.[0] || check.fields?.[0] || 'measure';
    const section = [
      'postcode',
      'units',
      'ownership',
      'usage',
      'building_application',
      'application_date',
    ].includes(field)
      ? 'object'
      : ['contract', 'started', 'vat_deductible', 'used_budget', 'cumulation_reviewed'].includes(
            field,
          )
        ? 'timing'
        : 'technical';
    setSections((current) => [...new Set([...current, section])]);
    setCostSections(selections.map((row) => String(row.offer_id)));
    setStep(['measure', 'selections'].includes(field) ? 0 : 1);
    setJump({ field, nonce: Date.now() });
  }
  useEffect(() => {
    if (!jump || !opened) return;
    const node = editorRoot.current?.querySelector<HTMLElement>(
      '[data-funding-field="' + jump.field + '"]',
    );
    if (!node) return;
    const focus = node.matches('input,textarea,button')
      ? node
      : node.querySelector<HTMLElement>('input,textarea,button');
    node.scrollIntoView({ block: 'center' });
    focus?.focus({ preventScroll: true });
  }, [jump, step, opened]);
  function recommendation(o: Row, ids: number[], vat = input.vat_deductible) {
    const all = o.positions.filter((p: Row) => !p.optional).map((p: Row) => p.id),
      whole =
        !o.positions.length ||
        (ids.length === all.length && all.every((x: number) => ids.includes(x)));
    const limit = vat === 'yes' && o.net !== null ? o.net : o.gross;
    if (whole) return vat === 'yes' ? (o.net ?? '') : o.gross;
    const values = o.positions
      .filter((p: Row) => ids.includes(p.id))
      .map((p: Row) => (vat === 'yes' ? p.net_amount : p.gross_amount));
    const sum = values.reduce((n: number, x: number) => n + Number(x || 0), 0);
    return values.length && values.every((x: unknown) => x !== null) && sum <= limit
      ? Math.round(sum * 100) / 100
      : '';
  }
  function selection(o: Row) {
    const ids = o.positions.filter((p: Row) => !p.optional).map((p: Row) => p.id);
    return { offer_id: o.id, position_ids: ids, eligible_cost: recommendation(o, ids) };
  }
  function setInput(key: string, value: unknown) {
    form.setFieldValue('inputs.' + key, value);
    if (key === 'vat_deductible')
      form.setFieldValue(
        'selections',
        selections.map((row) => {
          const o = source.offers?.find((x: Row) => x.id === row.offer_id);
          return o
            ? { ...row, eligible_cost: recommendation(o, row.position_ids, String(value)) }
            : row;
        }),
      );
  }
  function setSelection(index: number, values: Row) {
    form.setFieldValue(
      'selections',
      selections.map((row, n) => (n === index ? { ...row, ...values } : row)),
    );
  }
  async function action(work: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (e) {
      setFailure(e);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function saveDraft() {
    const values = {
      ...form.values,
      selections: selections.map((x) => ({
        ...x,
        eligible_cost: x.eligible_cost === '' ? null : x.eligible_cost,
      })),
      ...(!id ? { plan_only: true } : {}),
    };
    const result = await api(
      '/api/funding/plans' + (id ? '/' + id : ''),
      id ? 'PUT' : 'POST',
      values,
      !id,
    );
    setID(result.id);
    hydrate(result);
    void cache.invalidateQueries({ queryKey: ['energy'] });
    onSaved();
    return result;
  }
  async function run(phase: string) {
    if (!consent) return;
    await action(async () => {
      const current = await saveDraft();
      if (!current.checklist[phase + '_ready'])
        throw Error('Bitte die offenen Voraussetzungen in der Checkliste ergänzen.');
      const choice = (window as any).PHBReactBridge.ai.selection();
      const result = await api(
        '/api/funding/plans/' + current.id + '/check',
        'POST',
        { phase, consent: true, plan_only: true, model: choice.model },
        true,
      );
      setSaved(result);
      setStep(2);
      void query.refetch();
      void cache.invalidateQueries({ queryKey: ['energy'] });
    });
  }
  const report = saved?.report,
    stale = !!saved?.report_stale || form.isDirty();
  async function adopt() {
    if (!accept || stale || !report?.token) return;
    await action(async () => {
      const result = await api(
        '/api/funding/plans/' + id + '/adopt',
        'POST',
        { token: report.token, amount, confirm: true, plan_only: true },
        true,
      );
      hydrate(result);
      onSaved();
      success('Als erwartete Förderung übernommen. Keine Bewilligung oder Geldbuchung.');
    });
  }
  const select = (key: string, label: string, data = yn) => (
    <Select
      key={key}
      data-funding-field={key}
      label={label}
      clearable
      data={data}
      value={input[key] || null}
      onChange={(v) => setInput(key, v || '')}
    />
  );
  const field = (key: string, label: string, type = 'text') => (
    <TextInput
      key={key}
      data-funding-field={key}
      label={label}
      type={type}
      value={input[key] || ''}
      onChange={(e) => setInput(key, e.currentTarget.value)}
    />
  );
  const number = (key: string, label: string) => (
    <NumberInput
      key={key}
      data-funding-field={key}
      label={label}
      min={0}
      description={
        ['used_budget', 'household_income', 'children'].includes(key)
          ? 'Auch 0 ausdrücklich eintragen, wenn nichts zu berücksichtigen ist.'
          : undefined
      }
      decimalScale={['used_budget', 'household_income'].includes(key) ? 2 : 0}
      decimalSeparator=","
      thousandSeparator="."
      value={input[key] ?? ''}
      onChange={(v) => setInput(key, v)}
    />
  );
  const unknown = [...yn, { value: 'unknown', label: 'Noch fachlich zu bestätigen' }];
  return (
    <Editor
      opened={opened}
      title={id ? 'Förderung planen' : 'Neue Förderplanung'}
      dirty={form.isDirty()}
      changes={form.values}
      original={form.getInitialValues()}
      busy={busy}
      suspended={suspended}
      onClose={onClose}
    >
      <form
        ref={editorRoot}
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            await saveDraft();
            setStep(Math.min(2, step + 1));
          });
        }}
      >
        <Stack>
          <Stepper
            active={step}
            size="xs"
            allowNextStepsSelect={false}
            onStepClick={(n) => {
              if (!busy) {
                if (n === 2 && form.isDirty())
                  void action(async () => {
                    await saveDraft();
                    setStep(2);
                  });
                else setStep(n);
              }
            }}
          >
            <Stepper.Step label="Vorhaben" />
            <Stepper.Step label="Angaben" />
            <Stepper.Step label="Vorschau" />
          </Stepper>
          {(!connected || !ai.data?.credits_acknowledged) && (
            <Alert color="yellow">
              {!connected
                ? 'ChatGPT verbinden, um eine neue Planung anzulegen oder KI-Prüfungen zu starten. Bestehende Entwürfe lassen sich weiterhin bearbeiten und speichern.'
                : 'Bitte die Credit-Warnung in der ChatGPT-Verbindung bestätigen, bevor du eine neue Planung oder KI-Prüfung startest.'}
              <Button
                variant="subtle"
                size="xs"
                onClick={() => (window as any).PHBReactBridge.ai.show()}
              >
                ChatGPT-Einstellungen öffnen
              </Button>
            </Alert>
          )}
          {step === 0 && (
            <>
              <TextInput
                label="Titel des Vorhabens"
                required
                maxLength={200}
                {...form.getInputProps('name')}
              />
              <Textarea
                data-funding-field="measure"
                label="Maßnahme und technische Ausführung"
                description="Für eine erste Orientierung genügen Beschreibung und bekannte Eckdaten. Fehlende Angaben erscheinen in der Checkliste."
                minRows={3}
                maxLength={2000}
                value={input.measure || ''}
                onChange={(e) => setInput('measure', e.currentTarget.value)}
              />
              <MultiSelect
                data-funding-field="selections"
                label="Angebote (optional für den Entwurf)"
                searchable
                clearable
                data={(source.offers || []).map((o: Row) => ({
                  value: String(o.id),
                  label: o.vendor + ' · ' + o.category + ' · ' + money(o.gross),
                }))}
                value={selections.map((x) => String(x.offer_id))}
                onChange={(ids) =>
                  form.setFieldValue(
                    'selections',
                    ids.map(
                      (x) =>
                        selections.find((r) => r.offer_id === Number(x)) ||
                        selection(source.offers.find((o: Row) => o.id === Number(x))),
                    ),
                  )
                }
              />
              {selections.length > 0 && (
                <Accordion
                  variant="contained"
                  multiple
                  value={costSections}
                  onChange={setCostSections}
                  transitionDuration={0}
                >
                  {selections.map((row, index) => {
                    const o = source.offers?.find((x: Row) => x.id === row.offer_id);
                    return (
                      <Accordion.Item key={row.offer_id} value={String(row.offer_id)}>
                        <Accordion.Control>
                          {o?.vendor || 'Angebot nicht mehr verfügbar'} ·{' '}
                          {money(row.eligible_cost || 0)}
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Stack gap="xs">
                            <Text size="xs" c="dimmed">
                              Version {o?.version} · Angebot {money(o?.gross)}. Nur tatsächlich
                              förderfähige Kostenanteile berücksichtigen.
                            </Text>
                            {o &&
                              row.position_ids.some(
                                (n: number) => !o.positions.some((p: Row) => p.id === n),
                              ) && (
                                <Alert color="yellow">
                                  Angebotspositionen wurden geändert.
                                  <Button
                                    variant="subtle"
                                    size="xs"
                                    onClick={() => setSelection(index, selection(o))}
                                  >
                                    Aktuelle Positionen übernehmen
                                  </Button>
                                </Alert>
                              )}
                            {o?.positions.map((p: Row) => (
                              <Checkbox
                                key={p.id}
                                label={`${p.number} ${p.description}${p.optional ? ' (optional)' : ''}${p.net_amount != null ? ' · ' + money(p.net_amount) + ' netto' : ''}`}
                                checked={row.position_ids.includes(p.id)}
                                onChange={(e) => {
                                  const ids = e.currentTarget.checked
                                    ? [...row.position_ids, p.id]
                                    : row.position_ids.filter((n: number) => n !== p.id);
                                  setSelection(index, {
                                    position_ids: ids,
                                    eligible_cost: recommendation(o, ids),
                                  });
                                }}
                              />
                            ))}
                            <NumberInput
                              label="Berücksichtigte förderfähige Kosten (€)"
                              description="Bei Vorsteuerabzug netto, ansonsten brutto. Vorschläge anhand der tatsächlichen Maßnahme prüfen."
                              min={0}
                              decimalScale={2}
                              decimalSeparator=","
                              thousandSeparator="."
                              value={row.eligible_cost ?? ''}
                              onChange={(v) => setSelection(index, { eligible_cost: v })}
                            />
                          </Stack>
                        </Accordion.Panel>
                      </Accordion.Item>
                    );
                  })}
                </Accordion>
              )}
              <Textarea
                label="Notizen"
                minRows={2}
                maxLength={3000}
                {...form.getInputProps('notes')}
              />
            </>
          )}
          {step === 1 && (
            <>
              <Select
                data-funding-field="program_key"
                label="Programm"
                data={[
                  { value: 'auto', label: 'Noch offen – passende Möglichkeiten prüfen' },
                  ...(source.programs || []).map((p: Row) => ({ value: p.key, label: p.title })),
                ]}
                value={input.program_key || 'auto'}
                onChange={(v) => setInput('program_key', v === 'auto' ? '' : v)}
              />
              <Accordion
                variant="contained"
                multiple
                value={sections}
                onChange={setSections}
                transitionDuration={0}
              >
                <Accordion.Item value="object">
                  <Accordion.Control>Objekt und Antragsteller</Accordion.Control>
                  <Accordion.Panel>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      {field('postcode', 'Objekt-Postleitzahl')}
                      {number('units', 'Wohneinheiten')}
                      {select('ownership', 'Antragsteller', [
                        { value: 'private_owner', label: 'Privateigentümer eines Wohngebäudes' },
                        { value: 'other', label: 'Andere – individuell prüfen' },
                      ])}
                      {select('usage', 'Nutzung', [
                        { value: 'self', label: 'Selbst genutzt' },
                        { value: 'rented', label: 'Vermietet' },
                        { value: 'mixed', label: 'Gemischt' },
                      ])}
                      {field('building_application', 'Bauantrag / Bauanzeige am', 'date')}
                      {field('application_date', 'Geplanter Förderantrag am', 'date')}
                    </SimpleGrid>
                  </Accordion.Panel>
                </Accordion.Item>
                <Accordion.Item value="timing">
                  <Accordion.Control>Vertrag, Beginn und Kostenbasis</Accordion.Control>
                  <Accordion.Panel>
                    <Stack>
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        {select('contract', 'Liefer-/Leistungsvertrag', [
                          { value: 'not_signed', label: 'Noch nicht unterschrieben' },
                          { value: 'conditional', label: 'Förderkonforme Bedingung geprüft' },
                          { value: 'unconditional', label: 'Unbedingt geschlossen / unklar' },
                        ])}
                        {select('started', 'Ausführung bereits begonnen?')}
                        {select('vat_deductible', 'Vorsteuerabzugsberechtigt?')}
                        {number('used_budget', 'Bereits genutzte förderfähige Kosten (€)')}
                        {select(
                          'cumulation_reviewed',
                          'Weitere Förderung / Steuerermäßigungen geprüft?',
                        )}
                      </SimpleGrid>
                      <Textarea
                        label="Weitere Förderungen / Steuerermäßigungen"
                        maxLength={1500}
                        value={input.other_aid || ''}
                        onChange={(e) => setInput('other_aid', e.currentTarget.value)}
                      />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
                <Accordion.Item value="technical">
                  <Accordion.Control>Technik und fachliche Vorbereitung</Accordion.Control>
                  <Accordion.Panel>
                    <Stack>
                      {select(
                        'technical_verified',
                        'Technische Mindestanforderungen fachlich geprüft?',
                        unknown,
                      )}
                      {select(
                        'expert_involved',
                        'Energieberatung / erforderlicher Fachbetrieb eingebunden?',
                        unknown,
                      )}
                      {select('proof', 'TPB / BzA', [
                        { value: 'missing', label: 'Noch nicht vorhanden' },
                        { value: 'prepared', label: 'Wird vorbereitet' },
                        { value: 'available', label: 'Liegt vor' },
                      ])}
                      <Text size="xs" c="dimmed">
                        Offene Fachbestätigungen bleiben sichtbar. TPB/BzA ist für den frühen
                        Entwurf noch nicht erforderlich.
                      </Text>
                      {input.program_key === 'bafa_envelope' && (
                        <>
                          {select('isfp', 'Passenden geförderten iSFP berücksichtigen?')}
                          {input.isfp === 'yes' && (
                            <>
                              {field('isfp_date', 'iSFP erstellt am', 'date')}
                              {select('isfp_measure', 'Maßnahme im iSFP enthalten?')}
                            </>
                          )}
                        </>
                      )}
                      {input.program_key === 'kfw_458' && (
                        <>
                          {field('old_heating', 'Bisherige Heizung')}
                          {number('old_heating_year', 'Heizung in Betrieb seit (Jahr)')}
                          {field('new_heating', 'Geplante Heizung')}
                          {select('natural_refrigerant', 'Natürliches Kältemittel?', [
                            ...yn,
                            { value: 'not_applicable', label: 'Nicht zutreffend' },
                          ])}
                          {select(
                            'bonus_requested',
                            'Persönliche Einkommens-/Geschwindigkeitsboni prüfen?',
                          )}
                          {input.bonus_requested === 'yes' && (
                            <>
                              {number(
                                'household_income',
                                'Maßgebliches zu versteuerndes Haushaltseinkommen (€)',
                              )}
                              {number('children', 'Berücksichtigungsfähige Kinder unter 18')}
                            </>
                          )}
                        </>
                      )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <MultiSelect
                data-funding-field="document_ids"
                description="Für einen iSFP-Bonus eine aktuelle Unterlage der Kategorie iSFP zuordnen. Unterlagen können über den Button darunter hochgeladen werden."
                label="Förderunterlagen"
                searchable
                clearable
                data={(source.documents || []).map((d: Row) => ({
                  value: String(d.id),
                  label: d.title + ' · ' + d.category + (d.status ? ' · ' + d.status : ''),
                }))}
                value={(form.values.document_ids || []).map(String)}
                onChange={(values) => form.setFieldValue('document_ids', values.map(Number))}
              />
              {id && (
                <Button
                  variant="light"
                  leftSection={<IconPlus size={16} />}
                  onClick={() => onUpload(id)}
                >
                  Unterlagen hochladen
                </Button>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <Text size="sm" c="dimmed">
                Erst Möglichkeiten prüfen, dann fehlende Angaben ergänzen und eine konkrete Spanne
                schätzen. Es werden keine Zahlungen oder Bewilligungen erzeugt.
              </Text>
              <Text size="xs" c="dimmed">
                Klicke einen Prüfpunkt an, um die Angaben zu bearbeiten. „Offen“ verhindert die
                Betragsschätzung; „Fachlich klären“ ist ein Vorbehalt für die frühe Planung.
              </Text>
              {saved?.checklist && (
                <Paper withBorder p="sm">
                  <Stack gap={7}>
                    {saved.checklist.items.map((c: Row) => (
                      <UnstyledButton
                        type="button"
                        key={c.key}
                        className="funding-check-row"
                        onClick={() => jumpTo(c)}
                        aria-label={c.title + ' bearbeiten'}
                      >
                        <Badge
                          color={
                            c.status === 'present'
                              ? 'teal'
                              : c.status === 'confirm'
                                ? 'yellow'
                                : 'gray'
                          }
                          variant="light"
                          size="sm"
                          className="funding-check-status"
                        >
                          {c.status === 'present'
                            ? 'Vorhanden'
                            : c.status === 'confirm'
                              ? 'Fachlich klären'
                              : 'Offen'}
                        </Badge>
                        <div className="funding-check-copy">
                          <Text size="sm" fw={500}>
                            {c.title}
                          </Text>
                          {c.status !== 'present' && (
                            <>
                              <Text size="xs" c="dimmed">
                                {c.detail}
                              </Text>
                              {!!c.missing_labels?.length && (
                                <Text size="xs" mt={4}>
                                  Bitte prüfen: {c.missing_labels.join(' · ')}
                                </Text>
                              )}
                            </>
                          )}
                        </div>
                        <span aria-hidden="true">→</span>
                      </UnstyledButton>
                    ))}
                  </Stack>
                </Paper>
              )}
              {selections.length > 0 && (
                <Accordion variant="contained">
                  <Accordion.Item value="costs">
                    <Accordion.Control>
                      Kostenbasis: {money(saved?.checklist?.eligible_cost || 0)} ·{' '}
                      {selections.length} Angebot{selections.length === 1 ? '' : 'e'}
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="xs">
                        {selections.map((row) => {
                          const o = source.offers?.find((x: Row) => x.id === row.offer_id);
                          return (
                            <div key={row.offer_id}>
                              <Group justify="space-between">
                                <Text size="sm" fw={600}>
                                  {o?.vendor || 'Angebot'}
                                </Text>
                                <Text size="sm">
                                  {row.eligible_cost == null || row.eligible_cost === ''
                                    ? 'Noch offen'
                                    : money(row.eligible_cost)}
                                </Text>
                              </Group>
                              <Text size="xs" c="dimmed">
                                {o?.positions
                                  .filter((p: Row) => row.position_ids.includes(p.id))
                                  .map((p: Row) => p.description)
                                  .join(' · ') || 'Gesamtes Angebot ohne Einzelpositionen'}
                              </Text>
                            </div>
                          );
                        })}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
              <Checkbox
                label="Planungsangaben, ausgewählte Angebotspositionen und Titel zugeordneter Unterlagen für diese Prüfung an ChatGPT übermitteln. Keine automatische Übermittlung von Dokumentinhalten."
                checked={consent}
                onChange={(e) => setConsent(e.currentTarget.checked)}
              />
              <Group>
                <Button
                  variant="light"
                  disabled={!connected || !consent}
                  onClick={() => run('orientation')}
                >
                  Möglichkeiten prüfen
                </Button>
                <Button disabled={!connected || !consent} onClick={() => run('estimate')}>
                  Förderung schätzen
                </Button>
              </Group>
              {report?.token && (
                <Stack>
                  <Title order={4}>
                    {report.amount_min != null
                      ? 'Unverbindliche Vorschau: ' +
                        money(report.amount_min) +
                        (report.amount_max !== report.amount_min
                          ? ' bis ' + money(report.amount_max)
                          : '')
                      : report.eligible === false
                        ? 'Derzeit nicht förderfähig'
                        : 'Fördermöglichkeiten und offene Punkte'}
                  </Title>
                  {stale && (
                    <Alert color="yellow">
                      Grundlage geändert oder Prüfung älter als sieben Tage. Vor einer Übernahme
                      erneut prüfen.
                    </Alert>
                  )}
                  {saved?.adopted_stale && (
                    <Alert color="yellow">
                      Der bisher übernommene Erwartungswert beruht auf einer älteren Grundlage und
                      wurde nicht automatisch geändert.
                    </Alert>
                  )}
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {report.explanation}
                  </Text>
                  {report.programs?.map((p: Row) => (
                    <Paper key={p.key} withBorder p="sm">
                      <Text fw={600} size="sm">
                        {p.title}
                      </Text>
                      <Text size="sm">{p.reason}</Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => {
                          setInput('program_key', p.key);
                          setStep(1);
                        }}
                      >
                        Dieses Programm vorbereiten
                      </Button>
                    </Paper>
                  ))}
                  {(report.questions?.length > 0 || report.missing?.length > 0) && (
                    <Alert color="yellow" title="Bitte noch klären">
                      <ul>
                        {[
                          ...new Set<string>([
                            ...(report.questions || []),
                            ...(report.missing || []),
                          ]),
                        ].map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => setJump({ field: 'answers', nonce: Date.now() })}
                      >
                        Rückfragen beantworten
                      </Button>
                    </Alert>
                  )}
                  <Textarea
                    data-funding-field="answers"
                    description="Hier kannst du auch fachliche Angaben ergänzen, für die es kein eigenes Formularfeld gibt. Die Antworten werden bei der nächsten bestätigten Prüfung mitgesendet."
                    label="Antworten und Ergänzungen für die nächste Prüfung"
                    maxLength={5000}
                    minRows={2}
                    {...form.getInputProps('answers')}
                  />
                  {report.assumptions?.length > 0 && (
                    <>
                      <Text fw={600} size="sm">
                        Annahmen und fachliche Vorbehalte
                      </Text>
                      <ul>
                        {report.assumptions.map((s: string) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  <Group>
                    {report.sources?.map((s: Row) => (
                      <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" size="xs">
                        {s.title} ↗
                      </Anchor>
                    ))}
                  </Group>
                  <Text size="xs" c="dimmed">
                    Geprüft am {report.checked_on}. {saved?.notice}
                  </Text>
                  {report.phase === 'estimate' && report.eligible && report.amount_min != null && (
                    <>
                      <NumberInput
                        label="Als erwartet übernehmen (€)"
                        min={report.amount_min}
                        max={report.amount_max}
                        decimalScale={2}
                        decimalSeparator=","
                        thousandSeparator="."
                        value={amount}
                        onChange={(v) => {
                          setAmount(v);
                          setAccept(false);
                        }}
                        disabled={stale}
                      />
                      <Checkbox
                        label="Ich bestätige die gewählte Variante einschließlich der Annahmen. Die Schätzung ist unverbindlich und keine Förderzusage."
                        checked={accept}
                        disabled={stale}
                        onChange={(e) => setAccept(e.currentTarget.checked)}
                      />
                      <Button
                        disabled={!connected || stale || !accept || amount === ''}
                        onClick={adopt}
                      >
                        Als erwartete Förderung übernehmen
                      </Button>
                    </>
                  )}
                  {saved?.adopted_at && saved.funding.expected !== saved.adopted_amount && (
                    <Alert color="yellow">
                      Der erwartete Betrag wurde inzwischen manuell angepasst:{' '}
                      {money(saved.funding.expected)}. Die frühere KI-Übernahme bleibt als Grundlage
                      erhalten.
                    </Alert>
                  )}
                  {saved?.adopted_at && (
                    <Text size="sm" c="teal">
                      Übernommener Erwartungswert: {money(saved.adopted_amount)}. Bewilligung und
                      Auszahlung bleiben separat.
                    </Text>
                  )}
                </Stack>
              )}
            </>
          )}
          <ErrorBox value={failure || options.error || query.error} />
          {busy && (
            <Text role="status" size="sm">
              Vorgang läuft. Bitte Ergebnis oder Fehler abwarten.
            </Text>
          )}
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            {id && (
              <Button
                variant="subtle"
                mr="auto"
                onClick={() =>
                  void action(async () => {
                    const data = await saveDraft();
                    onManual(data.funding);
                  })
                }
              >
                Manuell weiterführen
              </Button>
            )}
            {step > 0 && (
              <Button variant="default" onClick={() => setStep(step - 1)}>
                Zurück
              </Button>
            )}
            {id && (
              <Button
                variant="default"
                leftSection={<IconDeviceFloppy size={15} />}
                onClick={() =>
                  void action(async () => {
                    await saveDraft();
                    success('Planungsentwurf gespeichert.');
                  })
                }
              >
                Entwurf speichern
              </Button>
            )}
            {step < 2 && (
              <Button type="submit" disabled={!id && !connected}>
                {!id ? 'Entwurf anlegen' : step === 0 ? 'Weiter' : 'Prüfung vorbereiten'}
              </Button>
            )}
          </div>
          {id && <SourceWork type="funding" id={id} />}
        </Stack>
      </form>
    </Editor>
  );
}

import {
  Accordion,
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ErrorBox, money, Row } from './core';
const yesNo = [
  { value: 'yes', label: 'Ja' },
  { value: 'no', label: 'Nein' },
];
export function FundingCheck({
  form,
  busy,
  setBusy,
}: {
  form: ReturnType<typeof useForm<Row>>;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const ai = useQuery({ queryKey: ['ai'], queryFn: () => api('/api/ai/status'), staleTime: 60000 }),
    pending = useRef(false);
  const [consent, setConsent] = useState(false),
    [report, setReport] = useState<Row | null>(null),
    [failure, setFailure] = useState<unknown>(null),
    [result, setResult] = useState<Row | null>(null);
  const inputs = form.values.assessment_inputs || {},
    path = (key: string) => 'assessment_inputs.' + key;
  const signature = JSON.stringify([inputs, form.values.offer_id, form.values.document_ids]);
  useEffect(() => {
    setResult(null);
    setReport(null);
    setFailure(null);
    setConsent(false);
  }, [signature]);
  const text = (key: string, label: string, type = 'text') => (
    <TextInput key={key} label={label} type={type} {...form.getInputProps(path(key))} />
  );
  const number = (key: string, label: string) => (
    <NumberInput
      key={key}
      label={label}
      description={
        key === 'household_income'
          ? 'Nach aktueller Programmdefinition ermittelter Durchschnitt; kein Brutto- oder Nettogehalt.'
          : key === 'used_budget'
            ? 'Bereits bei anderen Maßnahmen/Anträgen berücksichtigte förderfähige Kosten.'
            : undefined
      }
      min={0}
      decimalScale={['eligible_cost', 'used_budget', 'household_income'].includes(key) ? 2 : 0}
      decimalSeparator=","
      thousandSeparator="."
      {...form.getInputProps(path(key))}
    />
  );
  const select = (key: string, label: string, options = yesNo) => (
    <Select key={key} label={label} clearable data={options} {...form.getInputProps(path(key))} />
  );
  async function run(estimate: boolean) {
    if (busy || pending.current) return;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const body = {
        offer_id: form.values.offer_id,
        assessment_inputs: inputs,
        document_ids: form.values.document_ids || [],
      };
      const check = await api('/api/funding/estimate-readiness', 'POST', body);
      setReport(check);
      if (estimate && check.ready) {
        const choice = (window as any).PHBReactBridge.ai.selection();
        const answer = await api(
          '/api/funding/estimate',
          'POST',
          { ...body, ...choice, consent },
          true,
        );
        setResult(answer);
      }
    } catch (e) {
      setFailure(e);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Accordion variant="contained">
      <Accordion.Item value="check">
        <Accordion.Control>Antragsnahe Förderhöhe unverbindlich schätzen</Accordion.Control>
        <Accordion.Panel>
          <Stack>
            <Text size="sm" c="dimmed">
              Dieser antragsnahe Check benötigt die fachliche Bestätigung von Technik,
              Energieberatung und TPB/BzA. Für eine frühe Orientierung mit noch offenen Fachangaben
              nutze „Förderung planen“ im Förderbereich. Für private Eigentümer bestehender
              Wohngebäude: BAFA Gebäudehülle oder KfW 458 Heizung. Weitere Programme weiterhin
              manuell erfassen. Vor Antragstellung die aktuelle Richtlinie mit Energieberatung oder
              Fachbetrieb prüfen.
            </Text>
            <Alert color="yellow">
              Unverbindliche KI-Schätzung ohne Gewähr, keine Förderzusage. Bewilligung und
              Auszahlung werden dadurch nicht geändert. Ein angenommener Auftrag allein belegt keine
              Förderfähigkeit.
            </Alert>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {select('program_key', 'Programm für die Schätzung', [
                { value: 'bafa_envelope', label: 'BAFA – Gebäudehülle (BEG EM)' },
                { value: 'kfw_458', label: 'KfW 458 – Heizung' },
              ])}
              {text('postcode', 'Objekt-Postleitzahl')}
              {number('units', 'Wohneinheiten im Gebäude')}
              {select('ownership', 'Antragsteller', [
                { value: 'private_owner', label: 'Privateigentümer eines Wohngebäudes' },
                { value: 'other', label: 'Andere – individuell prüfen' },
              ])}
              {select('usage', 'Nutzung', [
                { value: 'self', label: 'Vollständig selbst genutzt' },
                { value: 'rented', label: 'Vermietet' },
                { value: 'mixed', label: 'Gemischt' },
              ])}
              {text('building_application', 'Bauantrag / Bauanzeige am', 'date')}
              {text('application_date', 'Geplanter Förderantrag am', 'date')}
              {number('eligible_cost', 'Förderfähiger Angebotsanteil (€)')}
              {number('used_budget', 'Kostengrenze bereits ausgeschöpft (€)')}
              {select('vat_deductible', 'Vorsteuerabzugsberechtigt?')}
              {select('contract', 'Liefer-/Leistungsvertrag', [
                { value: 'not_signed', label: 'Noch nicht unterschrieben' },
                { value: 'conditional', label: 'Förderkonforme Bedingung geprüft' },
                { value: 'unconditional', label: 'Unbedingt geschlossen / unklar' },
              ])}
              {select('started', 'Ausführung bereits begonnen?')}
              {select(
                'expert_involved',
                'Energieberatung / erforderlicher Fachbetrieb eingebunden?',
              )}
              {select('technical_verified', 'Technische Mindestanforderungen fachlich geprüft?')}
              {select('proof', 'TPB / BzA-Nachweis', [
                { value: 'prepared', label: 'Wird fachlich vorbereitet' },
                { value: 'available', label: 'Liegt vor' },
                { value: 'missing', label: 'Noch ungeklärt' },
              ])}
              {select('cumulation_reviewed', 'Doppelförderung / Steuerermäßigungen geprüft?')}
            </SimpleGrid>
            <Textarea
              label="Maßnahme und technische Ausführung"
              maxLength={2000}
              minRows={3}
              {...form.getInputProps(path('measure'))}
            />
            <Textarea
              label="Weitere Förderungen / Steuerermäßigungen (falls vorhanden)"
              maxLength={1500}
              {...form.getInputProps(path('other_aid'))}
            />
            {inputs.program_key === 'bafa_envelope' && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {select('isfp', 'Passender geförderter iSFP vorhanden?')}
                {inputs.isfp === 'yes' && (
                  <>
                    {text('isfp_date', 'iSFP erstellt am', 'date')}
                    {select('isfp_measure', 'Maßnahme im iSFP enthalten?')}
                  </>
                )}
              </SimpleGrid>
            )}
            {inputs.program_key === 'kfw_458' && (
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {text('old_heating', 'Bisherige Heizung (Brennstoff / Technik)')}
                {number('old_heating_year', 'Bisherige Heizung in Betrieb seit (Jahr)')}
                {text('new_heating', 'Neue Heizung (Technik / Brennstoff)')}
                {select('natural_refrigerant', 'Natürliches Kältemittel?', [
                  ...yesNo,
                  { value: 'not_applicable', label: 'Nicht zutreffend' },
                ])}
                {select('bonus_requested', 'Persönliche Einkommens-/Geschwindigkeitsboni prüfen?')}
                {inputs.bonus_requested === 'yes' && (
                  <>
                    {number(
                      'household_income',
                      'Maßgebliches zu versteuerndes Haushaltseinkommen (€)',
                    )}
                    {number('children', 'Berücksichtigungsfähige Kinder unter 18 Jahren')}
                  </>
                )}
              </SimpleGrid>
            )}
            {report &&
              (!report.ready ? (
                <Alert color="yellow" title="Bitte noch klären">
                  <ul>
                    {report.missing.map((s: string) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <Text size="sm" c="teal">
                  Die Angaben für eine erste Schätzung sind vollständig. Das ersetzt keine fachliche
                  Prüfung.
                </Text>
              ))}
            {ai.data?.sharing ? (
              <Checkbox
                label="Prüfangaben, ausgewähltes Angebot mit Positionen und Titel verknüpfter Unterlagen für diese Schätzung an ChatGPT übermitteln. Dokumentinhalte werden nicht automatisch übertragen."
                checked={consent}
                onChange={(e) => setConsent(e.currentTarget.checked)}
              />
            ) : (
              <Text size="sm" c="dimmed">
                ChatGPT verbinden, um nach der Prüfung eine Schätzung anzufordern. Deine Angaben
                lassen sich auch ohne Verbindung speichern.
              </Text>
            )}
            <ErrorBox value={failure} />
            <Group>
              <Button variant="light" loading={busy} onClick={() => run(false)}>
                Voraussetzungen prüfen
              </Button>
              {ai.data?.sharing && (
                <Button loading={busy} disabled={!consent} onClick={() => run(true)}>
                  Mit ChatGPT schätzen
                </Button>
              )}
            </Group>
            {busy && (
              <Text role="status" size="sm">
                Prüfung läuft. Bitte Ergebnis oder Fehlermeldung abwarten.
              </Text>
            )}
            {result && (
              <Stack>
                <Title order={4}>
                  {result.amount !== null
                    ? 'Unverbindlicher Vorschlag: ' + money(result.amount)
                    : 'Noch keine belastbare Schätzung'}
                </Title>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {result.explanation}
                </Text>
                {result.missing?.length > 0 && (
                  <ul>
                    {result.missing.map((s: string) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
                {result.assumptions?.length > 0 && (
                  <>
                    <Text fw={600} size="sm">
                      Annahmen und Grenzen
                    </Text>
                    <ul>
                      {result.assumptions.map((s: string) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
                <Group>
                  {result.sources.map((s: Row) => (
                    <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" size="sm">
                      {s.title} ↗
                    </Anchor>
                  ))}
                </Group>
                <Text size="xs" c="dimmed">
                  Geprüft am {result.checked_on}. {result.notice}
                </Text>
                {result.eligible && result.amount !== null && (
                  <Button
                    variant="light"
                    onClick={() => form.setFieldValue('expected', result.amount)}
                  >
                    Als erwartete Förderung übernehmen
                  </Button>
                )}
              </Stack>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

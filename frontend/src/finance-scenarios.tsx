import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconCopy,
  IconGitCompare,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconWallet,
} from '@tabler/icons-react';
import { api, Editor, ErrorBox, money, type Row, useConfirm, useConfirmVisible } from './core';
import { PageHeader, Metrics } from './page-layout';
import { displayDateTime } from './presentation';
import { projectID } from './project-context';
import { useDirtyGuard } from './shell';
import './finance-scenarios.css';

const endpoint = '/api/finance-scenarios';
const allocationTotal = (values: Row) =>
  Object.values(values).reduce((sum: number, value) => sum + Number(value || 0), 0);
const editable = (row: Row) => ({
  revision: row.revision,
  title: row.title,
  notes: row.notes,
  lines: row.data.lines.map((line: Row) => ({
    id: line.id,
    title: line.title,
    amount: line.amount,
    enabled: line.enabled,
    allocations: line.allocations,
  })),
  reserve: row.data.reserve,
});

export function FinanceScenarios() {
  const [params, setParams] = useSearchParams(),
    selected = Number(params.get('scenario')) || 0;
  const cache = useQueryClient(),
    ask = useConfirm();
  const query = useQuery({
    queryKey: ['finance-scenarios', projectID],
    queryFn: () => api(endpoint),
    staleTime: 0,
  });
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null),
    [compareIds, setCompareIds] = useState<number[]>([]),
    [comparison, setComparison] = useState<Row[] | null>(null);
  const lock = useRef(false),
    confirming = useConfirmVisible();
  const rows: Row[] = query.data?.scenarios || [];
  const choose = (id: number) => setParams(id ? { scenario: String(id) } : {});
  async function create(copy?: Row) {
    if (lock.current) return;
    const title = await ask({
      title: copy ? 'Szenario duplizieren' : 'Neues Szenario',
      message: copy
        ? 'Die Kopie erhält denselben Ausgangsstand und dieselbe Planung.'
        : 'Der aktuelle Projektstand wird als unveränderliche Basis übernommen. Offene Angebote sind zunächst ausgeschaltet.',
      initial: copy ? copy.title.slice(0, 110) + ' – Kopie' : 'Meine Variante',
    });
    if (typeof title !== 'string' || !title.trim() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api(endpoint, 'POST', {
        title: title.trim(),
        ...(copy ? { copy_id: copy.id } : {}),
      });
      await cache.invalidateQueries({ queryKey: ['finance-scenarios', projectID] });
      choose(result.scenario.id);
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function compare() {
    if (compareIds.length !== 2 || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      setComparison(
        await Promise.all(compareIds.map(async (id) => (await api(endpoint + '/' + id)).scenario)),
      );
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove(row: Row) {
    if (
      lock.current ||
      !(await ask(
        'Szenario „' + row.title + '“ löschen? Die echten Projektdaten bleiben erhalten.',
      ))
    )
      return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await api(endpoint + '/' + row.id, 'DELETE', { revision: row.revision, confirm: true });
      setCompareIds((ids) => ids.filter((id) => id !== row.id));
      await cache.invalidateQueries({ queryKey: ['finance-scenarios', projectID] });
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="page scenario-page">
      <ErrorBox value={failure || query.error} />
      {selected ? (
        <ScenarioDetail
          key={selected}
          id={selected}
          back={() => choose(0)}
          clone={(row) => void create(row)}
          outerBusy={busy}
        />
      ) : (
        <>
          <PageHeader
            title="Szenarien"
            description="Finanzielle Varianten durchspielen – unabhängig von Angeboten, Rechnungen und Buchungen."
          >
            <Button
              variant="default"
              leftSection={<IconGitCompare size={16} />}
              disabled={compareIds.length !== 2 || busy}
              loading={busy}
              onClick={() => void compare()}
            >
              Varianten vergleichen
            </Button>
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={busy}
              onClick={() => void create()}
            >
              Neues Szenario
            </Button>
          </PageHeader>
          <Text size="xs" c="dimmed" mb="md">
            Für einen Vergleich zwei Szenarien markieren. Jedes Szenario behält seinen eigenen
            Ausgangsstand.
          </Text>
          {query.isPending && <Loader />}
          {!query.isPending && !rows.length && (
            <Paper withBorder p="xl">
              <Text fw={600}>Was wäre, wenn …?</Text>
              <Text size="sm" c="dimmed" mt="xs">
                Angebotspreise variieren, Eigenleistungen und freie Planpositionen ergänzen und
                Kredit oder Eigenkapital zuordnen. Deine echten Projektkosten bleiben unverändert.
              </Text>
              <Button mt="md" onClick={() => void create()} disabled={busy}>
                Erstes Szenario erstellen
              </Button>
            </Paper>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
            {rows.map((row) => (
              <Paper key={row.id} withBorder p="md" className="scenario-card">
                <Group justify="space-between" wrap="nowrap">
                  <Checkbox
                    aria-label={row.title + ' vergleichen'}
                    checked={compareIds.includes(row.id)}
                    disabled={busy || (compareIds.length === 2 && !compareIds.includes(row.id))}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCompareIds((ids) =>
                        checked ? [...ids, row.id] : ids.filter((id) => id !== row.id),
                      );
                    }}
                  />
                  <Tooltip label="Szenario löschen">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={row.title + ' löschen'}
                      disabled={busy}
                      onClick={() => void remove(row)}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <UnstyledButton className="scenario-card-open" onClick={() => choose(row.id)}>
                  <Text fw={600} lineClamp={2}>
                    {row.title}
                  </Text>
                  <Text size="xl" fw={650} mt="sm">
                    {money(row.summary.total)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Gesamtkosten inkl. bereits bezahlt und Reserve
                  </Text>
                  <Text size="sm" mt="xs">
                    Noch zu finanzieren: {money(row.summary.required)}
                  </Text>
                  <Text size="xs" c="dimmed" mt="sm">
                    Ausgangsstand {displayDateTime(row.captured_at)}
                  </Text>
                </UnstyledButton>
                {row.summary.gap > 0 && (
                  <Badge color="red" variant="light" mt="sm">
                    Finanzierungslücke: {money(row.summary.gap)}
                  </Badge>
                )}
              </Paper>
            ))}
          </SimpleGrid>
        </>
      )}
      <Modal
        opened={!!comparison}
        onClose={() => setComparison(null)}
        title="Szenarien vergleichen"
        size="xl"
        closeOnClickOutside={false}
        closeOnEscape={!confirming}
        trapFocus={!confirming}
      >
        {comparison && <ScenarioComparison rows={comparison} />}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setComparison(null)}>
            Schließen
          </Button>
        </Group>
      </Modal>
    </div>
  );
}

function ScenarioDetail({
  id,
  back,
  clone,
  outerBusy,
}: {
  id: number;
  back: () => void;
  clone: (row: Row) => void;
  outerBusy: boolean;
}) {
  const query = useQuery({
    queryKey: ['finance-scenario', projectID, id],
    queryFn: async () => (await api(endpoint + '/' + id)).scenario,
    staleTime: 0,
  });
  const cache = useQueryClient(),
    ask = useConfirm();
  const [saved, setSaved] = useState<Row | null>(null),
    [draft, setDraft] = useState<Row | null>(null),
    [summary, setSummary] = useState<Row | null>(null),
    [failure, setFailure] = useState<unknown>(null),
    [previewError, setPreviewError] = useState<unknown>(null),
    [calculating, setCalculating] = useState(false),
    [busy, setBusy] = useState(false),
    [allocation, setAllocation] = useState<string | null>(null);
  const lock = useRef(false);
  const accept = (row: Row) => {
    cache.setQueryData(['finance-scenario', projectID, id], row);
    setSaved(row);
    setDraft(editable(row));
    setSummary(row.summary);
    setPreviewError(null);
  };
  const signature = draft ? JSON.stringify(draft) : '',
    dirty = !!saved && signature !== JSON.stringify(editable(saved));
  useEffect(() => {
    if (query.data && (!saved || (!dirty && query.data.revision !== saved.revision)))
      accept(query.data);
  }, [query.data, saved, dirty]);
  useDirtyGuard(dirty);
  useEffect(() => {
    if (!draft || !dirty) {
      setCalculating(false);
      setPreviewError(null);
      return;
    }
    let active = true;
    setCalculating(true);
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      void api(endpoint + '/' + id + '/preview', 'POST', draft, false, {}, { readOnly: true })
        .then((result) => {
          if (active) setSummary(result.summary);
        })
        .catch((e) => {
          if (active) setPreviewError(e);
        })
        .finally(() => {
          if (active) setCalculating(false);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [signature, dirty, id]);
  async function save() {
    if (!draft || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      accept((await api(endpoint + '/' + id, 'PUT', draft)).scenario);
      await cache.invalidateQueries({ queryKey: ['finance-scenarios', projectID] });
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (
      lock.current ||
      (dirty &&
        !(await ask(
          'Ungespeicherte Szenarioänderungen verwerfen und den gespeicherten Stand laden?',
        )))
    )
      return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      accept((await api(endpoint + '/' + id)).scenario);
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function applyPrice(change: Row) {
    if (
      !saved ||
      dirty ||
      lock.current ||
      !(await ask(
        'Den aktuellen Angebotswert in dieser Planposition übernehmen? Die eingefrorenen Zahlungen und Kontosalden bleiben unverändert.',
      ))
    )
      return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      accept(
        (
          await api(endpoint + '/' + id + '/offer-price', 'POST', {
            revision: saved.revision,
            line_id: change.line_id,
          })
        ).scenario,
      );
      await cache.invalidateQueries({ queryKey: ['finance-scenarios', projectID] });
    } catch (e) {
      setFailure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const goBack = () => {
    if (!busy) back();
  };
  if (query.isPending || !draft || !saved || !summary)
    return (
      <>
        <ErrorBox value={query.error} />
        <Group>
          <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={back}>
            Szenarien
          </Button>
          {query.isPending && <Loader />}
        </Group>
      </>
    );
  const updateLine = (lineId: string, patch: Row) =>
    setDraft(
      (value: Row | null) =>
        value && {
          ...value,
          lines: value.lines.map((line: Row) =>
            line.id === lineId ? { ...line, ...patch } : line,
          ),
        },
    );
  const original = new Map<string, Row>(saved.data.lines.map((line: Row) => [line.id, line]));
  const target =
    allocation === 'reserve'
      ? draft.reserve
      : draft.lines.find((line: Row) => line.id === allocation);
  const targetPaid =
    allocation === 'reserve' ? 0 : Number(original.get(allocation || '')?.paid || 0);
  const due =
    allocation === 'reserve'
      ? draft.reserve.mode === 'percent'
        ? (draft.lines
            .filter((line: Row) => line.enabled)
            .reduce(
              (sum: number, line: Row) =>
                sum + Math.max(0, Number(line.amount) - Number(original.get(line.id)?.paid || 0)),
              0,
            ) *
            Number(draft.reserve.value)) /
          100
        : Number(draft.reserve.value)
      : Math.max(0, Number(target?.amount || 0) - targetPaid);
  const disabled = busy || outerBusy;
  return (
    <>
      <PageHeader
        title={saved.title}
        description={
          'Planspiel · Ausgangsstand ' +
          displayDateTime(saved.captured_at) +
          ' · Echte Buchungen bleiben unverändert.'
        }
      >
        <Button
          variant="default"
          leftSection={<IconCopy size={16} />}
          disabled={disabled || dirty}
          onClick={() => clone(saved)}
        >
          Duplizieren
        </Button>
        <Tooltip label="Gespeichertes Szenario erneut laden">
          <ActionIcon
            size="lg"
            variant="default"
            aria-label="Szenario neu laden"
            disabled={disabled}
            onClick={() => void reload()}
          >
            <IconRefresh size={17} />
          </ActionIcon>
        </Tooltip>
      </PageHeader>
      <Group mb="sm" justify="space-between">
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={<IconArrowLeft size={16} />}
          disabled={disabled}
          onClick={() => void goBack()}
        >
          Szenarien
        </Button>
        {dirty && <Badge variant="light">Ungespeicherte Änderungen</Badge>}
      </Group>
      <ErrorBox value={failure || previewError} />
      <Metrics
        loading={calculating || !!previewError}
        values={[
          ['Gesamtkosten', money(summary.total)],
          ['Noch zu finanzieren', money(summary.required)],
          ['EK verbleibend', money(summary.equity_remaining)],
          ['Kredit verbleibend', money(summary.credit_remaining)],
        ]}
      />
      <Text size="xs" c="dimmed" mb="md">
        Gesamtkosten = {money(saved.data.basis.paid)} bereits bezahlt + offene Planung + Reserve.
        Die Finanzierung wird nur für die offenen Planbeträge aufgeteilt.
      </Text>
      {!calculating && !previewError && (
        <Stack gap="xs" mb="md">
          {summary.gap > 0 && (
            <Alert color="red">
              Finanzierungslücke: {money(summary.gap)} nach Abzug der hinterlegten EK-Reserve.
            </Alert>
          )}
          {summary.unassigned > 0 && (
            <Alert color="yellow">
              {money(summary.unassigned)} der Planung sind noch keiner Finanzierungsquelle
              zugeordnet.
            </Alert>
          )}
          {summary.warnings.map((warning: string) => (
            <Alert key={warning} color="yellow">
              {warning}
            </Alert>
          ))}
        </Stack>
      )}
      {saved.basis_changed && (
        <Alert color="blue" mb="md">
          Zahlungen oder Finanzierung im Projekt haben sich geändert. Dieses Szenario behält seinen
          Ausgangsstand. Für eine neue Finanzierungsbasis bitte ein neues Szenario erstellen; eine
          Kopie behält die bisherige Basis.
        </Alert>
      )}
      {saved.changes.length > 0 && (
        <Paper withBorder p="sm" mb="md">
          <Text size="sm" fw={600}>
            Geänderte Angebote
          </Text>
          {saved.changes.map((change: Row) => (
            <Group key={change.line_id} justify="space-between" mt="xs">
              <Text size="xs">
                {change.title}:{' '}
                {change.missing
                  ? 'im Projekt nicht mehr vorhanden; der Plan bleibt erhalten'
                  : 'aktueller Angebotswert ' + money(change.current_amount)}
              </Text>
              {!change.missing && (
                <Button
                  variant="light"
                  size="compact-xs"
                  disabled={disabled || dirty}
                  onClick={() => void applyPrice(change)}
                >
                  Angebotswert übernehmen
                </Button>
              )}
            </Group>
          ))}
          {dirty && (
            <Text size="xs" c="dimmed">
              Zum Übernehmen zuerst deine Planung speichern.
            </Text>
          )}
        </Paper>
      )}
      <Paper withBorder p="md" mb="md">
        <Group align="start" grow>
          <TextInput
            label="Szenariotitel"
            maxLength={120}
            value={draft.title}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
          />
          <Textarea
            label="Notizen"
            maxLength={4000}
            autosize
            minRows={1}
            maxRows={4}
            value={draft.notes}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, notes: event.currentTarget.value })}
          />
        </Group>
      </Paper>
      <Paper withBorder className="scenario-planning">
        <Group justify="space-between" p="sm" className="scenario-list-header">
          <div>
            <Text fw={600} size="sm">
              Planpositionen
            </Text>
            <Text size="xs" c="dimmed">
              Angebote und Vorhaben zuschalten oder frei ergänzen.
            </Text>
          </div>
          <Button
            variant="light"
            size="compact-sm"
            leftSection={<IconPlus size={15} />}
            disabled={disabled || draft.lines.length >= 500}
            onClick={() =>
              setDraft({
                ...draft,
                lines: [
                  ...draft.lines,
                  {
                    id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
                      x.toString(16).padStart(2, '0'),
                    ).join(''),
                    title: 'Neue Planposition',
                    amount: 0,
                    enabled: true,
                    allocations: {},
                  },
                ],
              })
            }
          >
            Planposition hinzufügen
          </Button>
        </Group>
        <ScrollArea.Autosize mah="55vh" type="auto">
          <Table className="scenario-table" miw={760} verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40}>Aktiv</Table.Th>
                <Table.Th>Position</Table.Th>
                <Table.Th w={150}>Plan gesamt</Table.Th>
                <Table.Th w={110}>Bereits bezahlt</Table.Th>
                <Table.Th w={120}>Offene Planung</Table.Th>
                <Table.Th w={180}>Finanzierung</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {draft.lines.map((line: Row) => {
                const source = original.get(line.id),
                  paid = Number(source?.paid || 0),
                  remaining = line.enabled ? Math.max(0, Number(line.amount) - paid) : 0,
                  allocated = allocationTotal(line.allocations);
                return (
                  <Table.Tr key={line.id} className={!line.enabled ? 'scenario-disabled-line' : ''}>
                    <Table.Td>
                      <Checkbox
                        aria-label={line.title + ' einplanen'}
                        checked={line.enabled}
                        disabled={disabled}
                        onChange={(event) =>
                          updateLine(line.id, { enabled: event.currentTarget.checked })
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label="Planposition"
                        maxLength={180}
                        value={line.title}
                        disabled={disabled}
                        onChange={(event) =>
                          updateLine(line.id, { title: event.currentTarget.value })
                        }
                      />
                      <Text size="xs" c="dimmed" mt={3}>
                        {source?.source
                          ? { offer: 'Angebot', receipt: 'Rechnung', self_work: 'Eigenleistung' }[
                              String(source.source.kind)
                            ] || 'Projektposition'
                          : 'Freie Planposition'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={line.title + ' Planbetrag'}
                        value={line.amount}
                        min={paid}
                        decimalScale={2}
                        hideControls
                        disabled={disabled}
                        error={Number(line.amount) < paid}
                        onChange={(value) => updateLine(line.id, { amount: value })}
                      />
                    </Table.Td>
                    <Table.Td>{money(paid)}</Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {money(remaining)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        leftSection={<IconWallet size={14} />}
                        variant="subtle"
                        size="compact-xs"
                        disabled={disabled || !line.enabled}
                        onClick={() => setAllocation(line.id)}
                      >
                        {money(allocated)}
                      </Button>
                      {line.enabled && (
                        <Text size="xs" c={allocated > remaining + 0.005 ? 'red' : 'dimmed'}>
                          {allocated > remaining + 0.005
                            ? 'Aufteilung zu hoch'
                            : money(Math.max(0, remaining - allocated)) + ' nicht zugeordnet'}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {!source?.source && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={line.title + ' entfernen'}
                          disabled={disabled}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              lines: draft.lines.filter((item: Row) => item.id !== line.id),
                            })
                          }
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {!draft.lines.length && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text size="sm" c="dimmed">
                      Noch keine Planpositionen. Ergänze beispielsweise Innenausbau, Garten oder
                      eine Kostenreserve.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Paper>
      <Paper withBorder p="md" mt="md">
        <Group align="end" wrap="wrap">
          <Select
            label="Reserve für offene Planung"
            value={draft.reserve.mode}
            allowDeselect={false}
            data={[
              { value: 'percent', label: 'Prozentual' },
              { value: 'fixed', label: 'Fester Betrag' },
            ]}
            onChange={(value) => setDraft({ ...draft, reserve: { ...draft.reserve, mode: value } })}
            disabled={disabled}
          />
          <NumberInput
            label={draft.reserve.mode === 'percent' ? 'Reserve (%)' : 'Reserve (€)'}
            value={draft.reserve.value}
            min={0}
            max={draft.reserve.mode === 'percent' ? 100 : undefined}
            decimalScale={2}
            hideControls
            onChange={(value) => setDraft({ ...draft, reserve: { ...draft.reserve, value } })}
            disabled={disabled}
          />
          <Button
            variant="light"
            disabled={disabled}
            leftSection={<IconWallet size={15} />}
            onClick={() => setAllocation('reserve')}
          >
            Reserve finanzieren
          </Button>
        </Group>
      </Paper>
      <details className="scenario-sources">
        <summary>Finanzierungsrahmen ansehen</summary>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs" mt="sm">
          {summary.accounts.map((account: Row) => (
            <Paper key={account.key} withBorder p="sm">
              <Text fw={600} size="sm">
                {account.name}
              </Text>
              <Text size="xs" c="dimmed">
                {account.kind === 'loan' ? 'Kredit' : 'Eigenkapital'} · Basis{' '}
                {money(account.available)}
              </Text>
              <Text size="sm" c={account.remaining < 0 ? 'red' : undefined}>
                Verbleibend {money(account.remaining)}
              </Text>
              {account.reserve > 0 && (
                <Text size="xs" c="dimmed">
                  Geschützte Reserve {money(account.reserve)}
                </Text>
              )}
            </Paper>
          ))}
        </SimpleGrid>
        {!summary.accounts.length && (
          <Text size="sm" c="dimmed">
            Im Ausgangsstand gibt es noch keine Kredite oder Eigenkapitalkonten. Positionen können
            trotzdem geplant werden; die Finanzierung bleibt offen.
          </Text>
        )}
      </details>
      <Group justify="flex-end" className="scenario-save-bar">
        <Button variant="default" disabled={disabled} onClick={() => void goBack()}>
          Schließen
        </Button>
        <Button
          disabled={disabled || !dirty || calculating || !!previewError}
          loading={busy}
          onClick={() => void save()}
        >
          Speichern
        </Button>
      </Group>
      {target && allocation && (
        <AllocationEditor
          key={allocation}
          title={allocation === 'reserve' ? 'Reserve finanzieren' : target.title + ' finanzieren'}
          due={due}
          accounts={saved.data.basis.accounts}
          initial={target.allocations}
          onClose={() => setAllocation(null)}
          onApply={(values) => {
            if (allocation === 'reserve')
              setDraft({ ...draft, reserve: { ...draft.reserve, allocations: values } });
            else updateLine(allocation, { allocations: values });
            setAllocation(null);
          }}
        />
      )}
    </>
  );
}

function AllocationEditor({
  title,
  due,
  accounts,
  initial,
  onClose,
  onApply,
}: {
  title: string;
  due: number;
  accounts: Row[];
  initial: Row;
  onClose: () => void;
  onApply: (value: Row) => void;
}) {
  const [values, setValues] = useState<Row>({ ...initial });
  const ask = useConfirm();
  const total = allocationTotal(values),
    excessive = Math.round(total * 100) > Math.round(due * 100),
    dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useDirtyGuard(dirty);
  return (
    <Editor opened title={title} size="lg" dirty={dirty} onClose={onClose}>
      <Stack>
        <Text size="sm">
          Offener Planbetrag: <strong>{money(due)}</strong>. Nur die Verteilung in diesem Szenario
          wird geändert.
        </Text>
        {accounts.map((account) => (
          <Paper key={account.key} withBorder p="sm">
            <Group grow align="center">
              <div>
                <Text size="sm" fw={600}>
                  {account.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {account.kind === 'loan' ? 'Kredit' : 'Eigenkapital'} · Ausgangsrahmen{' '}
                  {money(account.available)}
                  {account.reserve > 0 ? ' · Reserve ' + money(account.reserve) : ''}
                </Text>
              </div>
              <NumberInput
                aria-label={'Planbetrag aus ' + account.name}
                min={0}
                decimalScale={2}
                hideControls
                value={values[account.key] || 0}
                onChange={(value) => setValues({ ...values, [account.key]: value || 0 })}
              />
            </Group>
          </Paper>
        ))}
        {!accounts.length && (
          <Alert>
            Es sind keine Finanzierungsquellen im Ausgangsstand vorhanden. Lege Konten im Projekt an
            und starte anschließend ein neues Szenario mit dem aktuellen Stand.
          </Alert>
        )}
        <Text size="sm" c={excessive ? 'red' : undefined}>
          {excessive
            ? 'Aufteilung zu hoch: ' + money(total - due)
            : 'Noch nicht zugeordnet: ' + money(Math.max(0, due - total))}
        </Text>
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={async () => {
              if (!dirty || (await ask('Ungespeicherte Finanzierungsaufteilung verwerfen?')))
                onClose();
            }}
          >
            Schließen
          </Button>
          <Button disabled={excessive} onClick={() => onApply(values)}>
            Übernehmen
          </Button>
        </Group>
      </Stack>
    </Editor>
  );
}

function ScenarioComparison({ rows }: { rows: Row[] }) {
  const names = new Map<string, string>();
  const key = (line: Row) =>
    line.source
      ? line.source.kind + ':' + line.source.id
      : 'plan:' + line.title.trim().toLocaleLowerCase('de');
  for (const row of rows) for (const line of row.data.lines) names.set(key(line), line.title);
  const amounts = rows.map((row) => {
    const totals = new Map<string, number>();
    for (const line of row.data.lines)
      if (line.enabled)
        totals.set(
          key(line),
          (totals.get(key(line)) || 0) + Math.max(0, Number(line.amount) - Number(line.paid)),
        );
    return totals;
  });
  return (
    <Stack gap="sm">
      <SimpleGrid cols={2}>
        {rows.map((row) => (
          <Paper key={row.id} withBorder p="sm">
            <Text fw={600}>{row.title}</Text>
            <Text size="xs" c="dimmed">
              Ausgangsstand {displayDateTime(row.captured_at)}
            </Text>
            <Text fw={650} size="xl" mt="xs">
              {money(row.summary.total)}
            </Text>
            <Text size="sm">EK verbleibend: {money(row.summary.equity_remaining)}</Text>
            <Text size="sm">Kredit verbleibend: {money(row.summary.credit_remaining)}</Text>
            {row.summary.gap > 0 && (
              <Text size="sm" c="red">
                Finanzierungslücke: {money(row.summary.gap)}
              </Text>
            )}
          </Paper>
        ))}
      </SimpleGrid>
      <Text size="sm">
        Differenz der Gesamtkosten:{' '}
        <strong>{money(rows[1].summary.total - rows[0].summary.total)}</strong>
      </Text>
      <Text size="xs" c="dimmed">
        Verglichen werden offene Planbeträge. Abweichende Ausgangsstände, bereits bezahlte Kosten
        und Reserven sind zusätzlich berücksichtigt.
      </Text>
      <ScrollArea>
        <Table miw={480}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Position</Table.Th>
              {rows.map((row) => (
                <Table.Th key={row.id}>{row.title}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...names].map(([id, title]) => (
              <Table.Tr key={id}>
                <Table.Td>{title}</Table.Td>
                {amounts.map((map, index) => (
                  <Table.Td key={index}>{map.has(id) ? money(map.get(id)!) : '–'}</Table.Td>
                ))}
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td>Reserve</Table.Td>
              {rows.map((row) => (
                <Table.Td key={row.id}>{money(row.summary.reserve)}</Table.Td>
              ))}
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Bereits bezahlt</Table.Td>
              {rows.map((row) => (
                <Table.Td key={row.id}>{money(row.summary.paid)}</Table.Td>
              ))}
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconCashRegister, IconReceipt } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ErrorBox, money, useConfirm, type Row } from './core';
import { PageHeader } from './page-layout';
import { FilterSelect, FilterSummary, SearchField, useViewState } from './ui';
import { SortSelect, compareDate, compareText } from './list-sorting';
import { displayDate } from './presentation';
import { projectID, projectURL } from './project-context';
import { SourceWork } from './work';
import './receipt-page.css';

export function ReceiptPage({ bridge }: { bridge: Row }) {
  const navigate = useNavigate(),
    location = useLocation(),
    [params] = useSearchParams(),
    ask = useConfirm();
  const query = useQuery({
    queryKey: ['receipts-native'],
    queryFn: () => api('/api/receipts'),
    staleTime: 0,
  });
  const [search, setSearch] = useViewState('receipt-search', ''),
    [kind, setKind] = useViewState('receipt-kind', 'all'),
    [payment, setPayment] = useViewState('receipt-payment', 'all'),
    [cancel, setCancel] = useViewState('receipt-cancel', 'all'),
    [labor, setLabor] = useViewState('receipt-labor', 'all'),
    [year, setYear] = useViewState('receipt-year', 'all'),
    [sort, setSort] = useViewState('receipt-sort', 'newest');
  const rows: Row[] = query.data?.receipts || [],
    years = [...new Set(rows.map((row) => row.document_date?.slice(0, 4)).filter(Boolean))]
      .sort()
      .reverse();
  const unpaid = (row: Row) =>
    row.status === 'Gebucht' &&
    Math.round(Number(row.counted_amount) * 100) > Math.round(Number(row.paid_amount) * 100);
  const filtered = rows
    .filter(
      (row) =>
        (kind === 'all' || (row.kind || 'Rechnung') === kind) &&
        (payment === 'all' ||
          (payment === 'unpaid' ? unpaid(row) : row.status === 'Gebucht' && !unpaid(row))) &&
        (cancel === 'all' ||
          (cancel === 'cancelled' ? row.status === 'Storniert' : row.status !== 'Storniert')) &&
        (labor === 'all' || Number(row.labor_amount) > 0) &&
        (year === 'all' || row.document_date?.startsWith(year)) &&
        search
          .trim()
          .toLocaleLowerCase('de')
          .split(/\s+/)
          .every((term) =>
            [row.supplier, row.filename, row.invoice_number, row.trade, row.assignment_type].some(
              (value) =>
                String(value || '')
                  .toLocaleLowerCase('de')
                  .includes(term),
            ),
          ),
    )
    .sort((a, b) =>
      sort === 'az'
        ? compareText(a.supplier || a.filename, b.supplier || b.filename)
        : sort === 'za'
          ? compareText(b.supplier || b.filename, a.supplier || a.filename)
          : compareDate(
              a.document_date || a.created_at,
              b.document_date || b.created_at,
              sort !== 'oldest',
            ) || b.id - a.id,
    );
  const count =
    [kind, payment, cancel, labor, year].filter((v) => v !== 'all').length +
    Number(!!search.trim());
  const reset = () => {
    setSearch('');
    setKind('all');
    setPayment('all');
    setCancel('all');
    setLabor('all');
    setYear('all');
  };
  const opened = params.has('receipt_id') || params.get('upload') === '1';
  const frame = useRef<HTMLIFrameElement>(null),
    [source, setSource] = useState(''),
    [frameError, setFrameError] = useState(false),
    session = useRef(false);
  useEffect(() => {
    if (opened && !session.current) {
      const url = new URL('/belege' + location.search, window.location.origin);
      url.searchParams.set('_classic', '1');
      url.searchParams.set('_embedded', '1');
      url.searchParams.set('project_id', String(projectID));
      setSource(url.pathname + url.search);
      setFrameError(false);
    }
    if (!opened && session.current) void query.refetch();
    session.current = opened;
  }, [opened, location.search]);
  useEffect(() => {
    bridge.workflowWindow = () => frame.current?.contentWindow;
    return () => {
      delete bridge.workflowWindow;
    };
  }, [bridge]);
  async function close() {
    const embedded = (frame.current?.contentWindow as any)?.PHBEmbed;
    if (embedded?.busy()) {
      return;
    }
    if (embedded?.dirty() && !(await ask('Ungespeicherte Änderungen verwerfen?'))) return;
    embedded?.discard();
    navigate('/belege', { replace: true });
  }
  return (
    <div className="page receipt-native-page">
      <PageHeader
        title="Rechnungen & Belege"
        description="Belege erfassen, zuordnen und Zahlungen verwalten."
      >
        <Group gap="xs">
          <Button onClick={() => navigate('/belege?upload=1&receipt_kind=Rechnung')}>
            Rechnung erfassen
          </Button>
          <Button
            variant="light"
            onClick={() => navigate('/belege?upload=1&receipt_kind=Kassenzettel')}
          >
            Kassenzettel erfassen
          </Button>
        </Group>
      </PageHeader>
      <Paper withBorder p="sm" mb="sm" className="collection-toolbar">
        <Group wrap="nowrap" gap={6} className="receipt-native-toolbar">
          <SearchField
            placeholder="Rechnung suchen"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <FilterSelect
            aria-label="Belegart"
            value={kind}
            onChange={(v) => setKind(v || 'all')}
            data={[{ value: 'all', label: 'Alle Belegarten' }, 'Rechnung', 'Kassenzettel']}
          />
          <FilterSelect
            aria-label="Zahlungsstatus"
            value={payment}
            onChange={(v) => setPayment(v || 'all')}
            data={[
              { value: 'all', label: 'Alle Zahlungen' },
              { value: 'unpaid', label: 'Unbezahlt' },
              { value: 'paid', label: 'Bezahlt' },
            ]}
          />
          <FilterSelect
            aria-label="Storno"
            value={cancel}
            onChange={(v) => setCancel(v || 'all')}
            data={[
              { value: 'all', label: 'Alle Status' },
              { value: 'cancelled', label: 'Storniert' },
              { value: 'active', label: 'Nicht storniert' },
            ]}
          />
          <FilterSelect
            aria-label="Lohnkosten"
            value={labor}
            onChange={(v) => setLabor(v || 'all')}
            data={[
              { value: 'all', label: 'Alle Lohnanteile' },
              { value: 'labor', label: 'Mit Lohnkosten' },
            ]}
          />
          <FilterSelect
            aria-label="Belegjahr"
            value={year}
            onChange={(v) => setYear(v || 'all')}
            data={[{ value: 'all', label: 'Alle Jahre' }, ...years]}
          />
          <SortSelect value={sort} onChange={setSort} />
        </Group>
        <FilterSummary count={count} onReset={reset} />
      </Paper>
      <ErrorBox value={query.error} />
      {query.isPending && <Loader size="sm" />}
      <Paper withBorder p="sm" className="collection-content">
        <div className="phb-scroll-region receipt-native-grid">
          {filtered.map((row) => (
            <Paper
              key={row.id}
              withBorder
              p="xs"
              className="receipt-native-card"
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('button,a'))
                  navigate('/belege?receipt_id=' + row.id);
              }}
            >
              <Group justify="space-between" gap={4} wrap="nowrap">
                <Badge
                  variant="light"
                  size="xs"
                  color={
                    row.status === 'Storniert'
                      ? 'gray'
                      : unpaid(row)
                        ? 'red'
                        : row.status === 'Gebucht'
                          ? 'green'
                          : 'gray'
                  }
                >
                  {unpaid(row) ? 'Unbezahlt' : row.status}
                </Badge>
                <SourceWork type="receipt" id={row.id} compact />
              </Group>
              <UnstyledButton
                onClick={() => navigate('/belege?receipt_id=' + row.id)}
                className="receipt-native-open"
              >
                <Group gap={5} wrap="nowrap">
                  {row.kind === 'Kassenzettel' ? (
                    <IconCashRegister size={15} />
                  ) : (
                    <IconReceipt size={15} />
                  )}
                  <Text fw={600} size="sm" lineClamp={1} title={row.supplier || row.filename}>
                    {row.supplier || row.filename}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {row.invoice_number || 'Ohne Nummer'}
                </Text>
                <Text fw={700}>
                  {row.gross_amount == null ? 'Betrag offen' : money(row.gross_amount)}
                </Text>
                <Text size="xs" c="dimmed">
                  Lohnkosten: {row.labor_amount == null ? 'nicht erfasst' : money(row.labor_amount)}
                </Text>
                {Number(row.unassigned_amount) > 0.005 && (
                  <Text size="10px" c="red">
                    Nicht zugewiesen
                  </Text>
                )}
              </UnstyledButton>
              <Group justify="space-between" gap={4} wrap="nowrap">
                <Text size="10px" c="dimmed" truncate>
                  {row.assignment_label || row.assignment_type || 'Ohne Zuordnung'}
                </Text>
                <Text size="10px" c="dimmed" className="receipt-native-date">
                  {row.document_date ? displayDate(row.document_date) : 'Ohne Datum'}
                </Text>
              </Group>
            </Paper>
          ))}
        </div>
        {!query.isPending && !query.isError && !filtered.length && (
          <Text size="sm" c="dimmed">
            {count
              ? 'Keine Treffer für deine Filter.'
              : 'Noch keine Rechnungen oder Kassenzettel erfasst.'}
          </Text>
        )}
      </Paper>
      <Group mt="sm" justify="flex-end">
        <FilterSelect
          aria-label="Steuerjahr für Export"
          value={year}
          onChange={(v) => setYear(v || 'all')}
          data={[{ value: 'all', label: 'Steuerjahr auswählen' }, ...years]}
        />
        <Button
          component="a"
          variant="light"
          disabled={year === 'all'}
          href={
            year === 'all' ? undefined : projectURL('/api/receipts/labor-export.zip?year=' + year)
          }
        >
          Rechnungen mit Lohnkosten exportieren
        </Button>
      </Group>
      <Modal
        opened={opened}
        onClose={() => void close()}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        size={1550}
        padding={0}
        centered
        classNames={{ body: 'receipt-workflow-body' }}
      >
        {frameError ? (
          <Alert color="red" title="Belegdialog konnte nicht geladen werden">
            <Button
              onClick={() => {
                setFrameError(false);
                if (frame.current) frame.current.src = source;
              }}
            >
              Erneut laden
            </Button>
            <Button variant="subtle" onClick={() => void close()}>
              Schließen
            </Button>
          </Alert>
        ) : (
          source && (
            <iframe
              ref={frame}
              className="workflow-frame"
              title="Beleg erfassen oder bearbeiten"
              src={source}
              onError={() => setFrameError(true)}
              onLoad={() => {
                try {
                  if (!(frame.current?.contentWindow as any)?.PHBEmbed) setFrameError(true);
                } catch {
                  setFrameError(true);
                }
              }}
            />
          )
        )}
      </Modal>
    </div>
  );
}

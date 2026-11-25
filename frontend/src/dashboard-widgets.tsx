import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowLeft, IconArrowRight } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, ErrorBox, money, type Row } from './core';
import { displayDate } from './presentation';
import { projectID } from './project-context';
import { useWorkActions } from './work';
import { workshopViews } from './workshop-catalog';
import { sourceFor, spec, type Widget } from './dashboard-layout';

const sources = [
  { value: 'receipts', label: 'Rechnungen & Belege' },
  { value: 'offers', label: 'Angebote' },
  { value: 'todos', label: 'To-dos' },
  { value: 'self_work', label: 'Eigenleistungen' },
  { value: 'hours', label: 'Arbeitsstunden' },
];
const links = [
  { value: '/', label: 'Kalender' },
  { value: '/angebote', label: 'Angebote' },
  { value: '/belege', label: 'Rechnungen & Belege' },
  { value: '/aufgaben', label: 'To-dos & Notizen' },
  { value: '/eigenleistungen', label: 'Eigenleistungen' },
  { value: '/stunden', label: 'Zeiterfassung' },
  { value: '/finanzierung', label: 'Kredite & Eigenkapital' },
  { value: '/energieplanung', label: 'Energetische Planung' },
  { value: '/projektunterlagen', label: 'Projektunterlagen' },
  { value: '/daten', label: 'Daten & Backups' },
  { value: '/stammdaten', label: 'Stammdaten' },
  ...workshopViews.map((x) => ({ value: '/projektwerkstatt?tab=' + x.value, label: x.label })),
];
function useSource(source: string) {
  return useQuery<Row>({
    queryKey: [
      ['todos', 'notes'].includes(source) ? 'work' : 'dashboard-data',
      projectID,
      'dashboard',
      source,
    ],
    queryFn: () => api('/api/dashboard/source/' + source),
    enabled: !!source,
    staleTime: 0,
    refetchInterval: 60_000,
  });
}
function filtered(items: Row[], w: Widget) {
  const c = w.config;
  return items.filter(
    (x) =>
      (!c.search ||
        `${x.title} ${x.description || ''}`
          .toLocaleLowerCase('de')
          .includes(c.search.toLocaleLowerCase('de'))) &&
      (!c.status ||
        (w.config.source === 'todos' || w.type === 'todos'
          ? c.status === (x.done ? 'done' : 'open')
          : x.status === c.status)) &&
      (!c.trade || x.trade === c.trade) &&
      (!c.person || x.person === c.person) &&
      (!c.month || x.date?.startsWith(c.month)),
  );
}
const number = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 2 });
export const sourceURL = (source: string) =>
  ({
    events: '/',
    todos: '/aufgaben',
    notes: '/aufgaben',
    receipts: '/belege',
    offers: '/angebote',
    self_work: '/eigenleistungen',
    hours: '/stunden',
    finance: '/finanzierung',
    shopping: '/projektwerkstatt?tab=shopping',
    deadlines: '/energieplanung',
    inbox: '/daten',
  })[source] || '/uebersicht';

function MiniCalendar({ items, disabled }: { items: Row[]; disabled: boolean }) {
  const [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    navigate = useNavigate();
  const year = month.getFullYear(),
    m = month.getMonth(),
    first = (new Date(year, m, 1).getDay() + 6) % 7,
    days = new Date(year, m + 1, 0).getDate();
  return (
    <div className="dashboard-calendar">
      <Group justify="space-between" mb={6}>
        <ActionIcon
          variant="subtle"
          aria-label="Vorheriger Monat"
          onClick={() => setMonth(new Date(year, m - 1, 1))}
        >
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Text size="sm" fw={600}>
          {month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}
        </Text>
        <ActionIcon
          variant="subtle"
          aria-label="Nächster Monat"
          onClick={() => setMonth(new Date(year, m + 1, 1))}
        >
          <IconArrowRight size={16} />
        </ActionIcon>
      </Group>
      <div className="dashboard-month">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((x) => (
          <Text size="xs" c="dimmed" ta="center" key={x}>
            {x}
          </Text>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={'empty' + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${year}-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
            events = items.filter((x) => x.start_date <= date && x.end_date >= date);
          return (
            <Tooltip key={date} label={events.map((x) => x.title).join(' · ') || displayDate(date)}>
              <UnstyledButton
                className={'dashboard-day' + (events.length ? ' has-events' : '')}
                aria-label={displayDate(date) + ': ' + events.length + ' Termine'}
                disabled={disabled}
                onClick={() =>
                  navigate(
                    '/?' +
                      (events.length
                        ? 'calendar_event=' + events[0].id
                        : 'new_event=1&event_date=' + date),
                  )
                }
              >
                {i + 1}
                {events.length > 0 && <span>{events.length}</span>}
              </UnstyledButton>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
export function Content({ w, editing }: { w: Widget; editing: boolean }) {
  const source = sourceFor(w),
    q = useSource(source),
    navigate = useNavigate(),
    work = useWorkActions(),
    cache = useQueryClient();
  const items = filtered(q.data?.items || [], w),
    data = q.data || {},
    now = new Date().toLocaleDateString('sv-SE');
  if (w.type === 'links')
    return (
      <Stack gap={5}>
        {(w.config.links || []).map((url) => (
          <Button
            key={url}
            variant="light"
            justify="space-between"
            rightSection={<IconArrowRight size={14} />}
            disabled={editing}
            onClick={() => navigate(url)}
          >
            {links.find((x) => x.value === url)?.label || 'Bereich öffnen'}
          </Button>
        ))}
        {!w.config.links?.length && (
          <Text c="dimmed" size="sm">
            Schnellzugriffe über die Kacheleinstellungen auswählen.
          </Text>
        )}
      </Stack>
    );
  if (q.isPending) return <Loader size="sm" />;
  if (q.error)
    return (
      <Stack gap={8}>
        <ErrorBox value={q.error} />
        <Button size="compact-xs" variant="default" onClick={() => void q.refetch()}>
          Erneut versuchen
        </Button>
      </Stack>
    );
  if (w.type === 'calendar') return <MiniCalendar items={items} disabled={editing} />;
  if (w.type === 'note') {
    const note = items.find((x) => x.id === w.config.note_id);
    return note ? (
      <UnstyledButton className="dashboard-note" disabled={editing} onClick={() => work.edit(note)}>
        <Text fw={600} size="sm">
          {note.title}
        </Text>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {note.body || 'Keine weiteren Angaben.'}
        </Text>
      </UnstyledButton>
    ) : (
      <Text size="sm" c="dimmed">
        {w.config.note_id
          ? 'Diese Notiz ist nicht mehr verfügbar. Bitte eine andere auswählen.'
          : 'Bitte eine Notiz in den Kacheleinstellungen auswählen.'}
      </Text>
    );
  }
  if (['credit', 'equity', 'expenses', 'pending'].includes(w.type))
    return (
      <>
        <Text className="dashboard-value">{money(data[w.type])}</Text>
        {w.type === 'credit' && (
          <div
            className="dashboard-budget"
            role="progressbar"
            aria-label="Verbleibendes Kreditbudget"
            aria-valuenow={data.frame ? Math.round((data.credit / data.frame) * 100) : 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              style={{
                width: `${Math.max(0, Math.min(100, data.frame ? (data.credit / data.frame) * 100 : 0))}%`,
              }}
            />
          </div>
        )}
        {w.type === 'pending' && (
          <Text size="xs" c="dimmed">
            {data.pending_count} Abrufe
          </Text>
        )}
      </>
    );
  if (w.type === 'metric' || w.type === 'hours') {
    const count = w.config.aggregation === 'count',
      total = count ? items.length : items.reduce((n, x) => n + Number(x.amount || 0), 0);
    return (
      <>
        <Text className="dashboard-value">
          {count
            ? number(total)
            : source === 'hours'
              ? number(total) + ' h'
              : source === 'todos'
                ? number(items.length)
                : money(total)}
        </Text>
        <Text c="dimmed" size="xs">
          {source === 'hours'
            ? 'Geleistet; ohne geplante Zeiten'
            : count
              ? 'Passende Einträge'
              : 'Summe der gefilterten Einträge'}
        </Text>
      </>
    );
  }
  if (w.type === 'progress') {
    const done = items.filter(
      (x) => x.done || x.status === 'Erledigt' || x.status === 'Angenommen',
    ).length;
    const total =
      source === 'receipts' ? items.reduce((n, x) => n + Math.max(0, x.amount), 0) : items.length;
    const completed =
      source === 'receipts'
        ? items.reduce((n, x) => n + Math.min(Math.max(0, x.paid), Math.max(0, x.amount)), 0)
        : done;
    const percent = total ? Math.round((completed / total) * 100) : 0;
    return (
      <Stack gap={10}>
        <Text className="dashboard-value">{percent} %</Text>
        <div
          className="dashboard-progress"
          role="progressbar"
          aria-label="Fortschritt"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: percent + '%' }} />
        </div>
        <Text size="xs" c="dimmed">
          {source === 'receipts'
            ? money(completed) + ' von ' + money(total) + ' bezahlt'
            : `${done} von ${total} abgeschlossen`}
        </Text>
      </Stack>
    );
  }
  let rows = items;
  if (w.type === 'events') {
    const last = new Date();
    last.setDate(last.getDate() + 7);
    rows = items.filter(
      (x) => x.end_date >= now && x.start_date <= last.toLocaleDateString('sv-SE'),
    );
  }
  if (w.type === 'todos') rows = items.filter((x) => !x.done);
  if (w.type === 'receipts')
    rows = items
      .filter((x) => x.remaining > 0)
      .sort((a, b) => (a.due_on || '9999').localeCompare(b.due_on || '9999'));
  if (w.type === 'shopping')
    rows = [
      ...(data.materials || [])
        .filter((x: Row) => x.status === 'Benötigt')
        .map((x: Row) => ({
          ...x,
          id: 'material-' + x.key,
          detail: x.unknown_quantity ? 'Menge offen' : number(x.quantity) + ' ' + x.unit,
          url: sourceURL(source),
        })),
      ...(data.tools || [])
        .filter((x: Row) => !x.ready && x.source !== 'Vorhanden')
        .map((x: Row) => ({
          ...x,
          id: 'tool-' + x.plan_id + '-' + x.id,
          detail: 'Werkzeug · ' + x.plan,
          url: sourceURL(source),
        })),
    ];
  const total = rows.reduce((n, x) => n + Number(x.remaining || 0), 0);
  return (
    <>
      {w.type === 'receipts' && (
        <Text fw={700} mb={6}>
          {money(total)} offen
        </Text>
      )}
      <div className="dashboard-list">
        {rows.map((x: Row) => (
          <div className="dashboard-row" key={x.id}>
            {source === 'todos' && (
              <Checkbox
                size="xs"
                checked={x.done}
                disabled={editing || work.busy}
                aria-label={'Erledigen: ' + x.title}
                onChange={async () => {
                  await work.mutate(x, 'done');
                  void cache.invalidateQueries({ queryKey: ['work'] });
                }}
              />
            )}
            <UnstyledButton
              disabled={editing}
              className="dashboard-row-main"
              onClick={() => {
                if (source === 'todos') work.edit(x);
                else if (source === 'inbox')
                  window.dispatchEvent(new CustomEvent('phb-inbox-open', { detail: { id: x.id } }));
                else
                  navigate(
                    x.url || (source === 'events' ? '/?calendar_event=' + x.id : sourceURL(source)),
                  );
              }}
            >
              <Text size="sm" fw={500} lineClamp={2}>
                {x.title}
              </Text>
              <Text size="xs" c={x.due_on && x.due_on < now && !x.done ? 'red' : 'dimmed'}>
                {source === 'events'
                  ? [
                      displayDate(x.start_date),
                      x.start_time,
                      x.company_name || x.trades?.map((t: Row) => t.name).join(', '),
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : x.detail ||
                    (x.due_on
                      ? 'Fällig: ' + displayDate(x.due_on)
                      : x.until
                        ? displayDate(x.until)
                        : source === 'self_work'
                          ? ''
                          : x.status || (x.date ? displayDate(x.date) : ''))}
              </Text>
              {source === 'self_work' && (
                <Text size="xs" c="dimmed">
                  Plan {money(x.amount)} · Ist {money(x.actual)}
                </Text>
              )}
            </UnstyledButton>
            {typeof x.amount === 'number' && source !== 'todos' && (
              <Text className="dashboard-row-amount" size="sm">
                {source === 'hours'
                  ? number(x.amount) + ' h'
                  : money(w.type === 'receipts' ? x.remaining : x.amount)}
              </Text>
            )}
          </div>
        ))}
        {!rows.length && (
          <Text size="sm" c="dimmed">
            Keine passenden Einträge.
          </Text>
        )}
      </div>
    </>
  );
}

export function WidgetSettings({
  widget,
  onSave,
  onClose,
}: {
  widget: Widget;
  onSave: (w: Widget) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(widget),
    c = value.config,
    kind = value.type;
  const source = sourceFor(value),
    data = useSource(source),
    notes = useSource(kind === 'note' ? 'notes' : '');
  const change = (part: Partial<Widget['config']>) =>
    setValue({ ...value, config: { ...c, ...part } });
  const statuses =
    source === 'todos'
      ? [
          { value: 'open', label: 'Offen' },
          { value: 'done', label: 'Erledigt' },
        ]
      : [...new Set<string>((data.data?.items || []).map((x: Row) => x.status).filter(Boolean))]
          .sort()
          .map((x) => ({
            value: x,
            label: x === 'paid' ? 'Bezahlt' : x === 'unpaid' ? 'Unbezahlt' : x,
          }));
  return (
    <Modal opened onClose={onClose} title="Kachel einstellen" closeOnClickOutside={false} centered>
      <Stack>
        <TextInput
          label="Titel"
          maxLength={80}
          value={c.title || ''}
          placeholder={spec(kind).title}
          onChange={(e) => change({ title: e.currentTarget.value })}
        />
        {['metric', 'list', 'progress'].includes(kind) && (
          <Select
            label="Datenquelle"
            data={sources.filter((x) => kind !== 'progress' || x.value !== 'hours')}
            value={c.source || 'todos'}
            onChange={(v) =>
              setValue({
                ...value,
                config: { title: c.title, source: v || 'todos', aggregation: 'count' },
              })
            }
          />
        )}
        {kind === 'metric' && (
          <Select
            label="Berechnung"
            data={[
              { value: 'count', label: 'Anzahl' },
              ...(source === 'todos'
                ? []
                : [
                    {
                      value: 'sum',
                      label: source === 'hours' ? 'Stunden summieren' : 'Beträge summieren',
                    },
                  ]),
            ]}
            value={c.aggregation || 'count'}
            onChange={(v) => change({ aggregation: v || 'count' })}
          />
        )}
        {['metric', 'list', 'progress', 'offers', 'self_work'].includes(kind) && (
          <>
            <TextInput
              label="Titel enthält"
              maxLength={120}
              value={c.search || ''}
              onChange={(e) => change({ search: e.currentTarget.value })}
            />
            {statuses.length > 0 && (
              <Select
                label="Status"
                clearable
                placeholder="Alle"
                data={statuses}
                value={c.status || null}
                onChange={(v) => change({ status: v || '' })}
              />
            )}
            {source === 'receipts' && (
              <Select
                label="Gewerk"
                placeholder="Alle"
                clearable
                searchable
                data={[
                  ...new Set<string>(
                    (data.data?.items || []).map((x: Row) => x.trade).filter(Boolean),
                  ),
                ].sort()}
                value={c.trade || null}
                onChange={(v) => change({ trade: v || '' })}
              />
            )}
          </>
        )}
        {source === 'hours' && (
          <>
            <Select
              label="Person oder Firma"
              clearable
              placeholder="Alle"
              data={data.data?.people || []}
              value={c.person ? String(c.person) : null}
              onChange={(v) => {
                const next = { ...c };
                if (v) next.person = Number(v);
                else delete next.person;
                setValue({ ...value, config: next });
              }}
            />
            <TextInput
              label="Monat"
              type="month"
              value={c.month || ''}
              onChange={(e) => {
                const next = { ...c };
                if (e.currentTarget.value) next.month = e.currentTarget.value;
                else delete next.month;
                setValue({ ...value, config: next });
              }}
            />
          </>
        )}
        {kind === 'note' && (
          <>
            <Select
              label="Notiz"
              searchable
              placeholder="Notiz auswählen"
              data={(notes.data?.items || []).map((x: Row) => ({
                value: String(x.id),
                label: x.title,
              }))}
              value={c.note_id ? String(c.note_id) : null}
              onChange={(v) => change({ note_id: Number(v) })}
            />
            <ErrorBox value={notes.error} />
          </>
        )}
        {kind === 'links' && (
          <MultiSelect
            label="Schnellzugriffe"
            searchable
            data={links}
            value={c.links || []}
            maxValues={12}
            onChange={(v) => change({ links: v })}
          />
        )}
        <Group grow>
          <NumberInput
            label="Breite (Spalten)"
            allowDecimal={false}
            clampBehavior="strict"
            min={spec(kind).min[0]}
            max={12}
            value={value.w}
            onChange={(v) => {
              const w = Number(v) || spec(kind).min[0];
              setValue({ ...value, w, x: Math.min(value.x, 12 - w) });
            }}
          />
          <NumberInput
            label="Höhe (Rasterzeilen)"
            allowDecimal={false}
            clampBehavior="strict"
            min={spec(kind).min[1]}
            max={12}
            value={value.h}
            onChange={(v) => setValue({ ...value, h: Number(v) || spec(kind).min[1] })}
          />
        </Group>
        <Text size="xs" c="dimmed">
          Mindestgröße: {spec(kind).min.join(' × ')}. Überschneidende Kacheln werden nach unten
          verschoben.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Schließen
          </Button>
          <Button disabled={kind === 'note' && !c.note_id} onClick={() => onSave(value)}>
            Übernehmen
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

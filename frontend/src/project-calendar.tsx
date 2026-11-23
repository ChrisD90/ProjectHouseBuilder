import { displayDate } from './presentation';
import { companyChoices } from './presentation';
import {
  ActionIcon,
  Accordion,
  NumberInput,
  Button,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  Paper,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useForm } from '@mantine/form';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CompanionPanel } from './companion';
import { SourceWork as WorkButton } from './work';
import { projectURL } from './project-context';
import { Editor, ErrorBox, api, success, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { FilterSelect, SearchField, useViewState } from './ui';
import { useDirtyGuard } from './shell';
import { calendarDays, dayKey, onDay, shiftCalendar } from './calendar-model';
import './project-calendar.css';

type CalendarEvent = {
  id: number;
  title: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_time: string;
  end_time: string;
  notes: string;
  trade_ids: number[];
  trades: { id: number; name: string }[];
  contractor_id: number | null;
  company_name: string;
  company_trade?: string;
  performed: boolean;
  series?: string;
  work: { mode: string; weekdays: number[]; break_minutes: number; daily_minutes: number };
  hours?: { confirmed_minutes: number; planned_minutes: number };
};
type EventForm = Omit<
  CalendarEvent,
  'id' | 'trades' | 'trade_ids' | 'contractor_id' | 'company_name' | 'company_trade'
> & { trade_ids: string[]; contractor_id: string | null; assignment: string };
const empty = (day: string): EventForm => ({
  title: '',
  start_date: day,
  end_date: day,
  all_day: true,
  start_time: '08:00',
  end_time: '09:00',
  notes: '',
  trade_ids: [],
  contractor_id: null,
  assignment: 'trade',
  performed: false,
  work: { mode: 'daily', weekdays: [0, 1, 2, 3, 4], break_minutes: 0, daily_minutes: 480 },
});
const dateLabel = (day: string, options?: Intl.DateTimeFormatOptions) =>
  displayDate(day, options || { day: 'numeric', month: 'long' });

export function ProjectCalendar() {
  const today = dayKey(new Date()),
    cache = useQueryClient(),
    ask = useConfirm();
  const [view, setView] = useViewState('project-calendar-view', 'month');
  const [anchor, setAnchor] = useState(today),
    [search, setSearch] = useState(''),
    [trade, setTrade] = useState<string | null>(null),
    [company, setCompany] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false),
    [activeResult, setActiveResult] = useState(0);
  const [jump, setJump] = useState<{ id: number; day: string } | null>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const resultListId = useId();
  const [params, setParams] = useSearchParams();
  const processedRoute = useRef('');
  const linkedId = Number(params.get('calendar_event')) || null;
  const linked = useQuery({
    queryKey: ['calendar-event-detail', linkedId],
    enabled: !!linkedId,
    queryFn: () => api<{ event: CalendarEvent }>('/api/calendar-events/' + linkedId),
  });
  const [dossierEditing, setDossierEditing] = useState(false),
    [repeatCount, setRepeatCount] = useState<number | string>(4),
    [repeatDays, setRepeatDays] = useState<number | string>(7);
  const [opened, setOpened] = useState(false),
    [selected, setSelected] = useState<number | null>(null);
  const [scope, setScope] = useState<string>('one'),
    [keepHours, setKeepHours] = useState(true);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const days = calendarDays(anchor, view);
  const events = useQuery({
    queryKey: ['calendar-events', days[0], days.at(-1)],
    queryFn: () =>
      api<{ events: CalendarEvent[]; companies: { id: number; name: string }[] }>(
        `/api/calendar-events?from=${days[0]}&to=${days.at(-1)}`,
      ),
  });
  const searchEvents = useQuery({
    queryKey: ['calendar-events', 'search'],
    enabled: Boolean(search.trim()),
    queryFn: () => api<{ events: CalendarEvent[] }>('/api/calendar-events'),
  });
  const trades = useQuery({
    queryKey: ['calendar-trades'],
    queryFn: () => api<{ trades: { id: number; name: string }[] }>('/api/trades'),
  });
  const form = useForm<EventForm>({
    initialValues: empty(today),
    validate: {
      contractor_id: (value, values) =>
        values.assignment === 'company' && !value ? 'Bitte eine Firma auswählen.' : null,
      title: (value) => (!value.trim() ? 'Bitte einen Titel eingeben.' : null),
      start_date: (value) => (!value ? 'Bitte einen Beginn auswählen.' : null),
      end_date: (value, values) =>
        !value || value < values.start_date ? 'Das Ende darf nicht vor dem Beginn liegen.' : null,
      end_time: (value, values) =>
        !values.all_day &&
        (!values.start_time ||
          !value ||
          `${values.end_date}T${value}` <= `${values.start_date}T${values.start_time}`)
          ? 'Das Ende muss nach dem Beginn liegen.'
          : null,
    },
  });
  const [previewValues] = useDebouncedValue(form.values, 250);
  const hours = useQuery({
    queryKey: ['calendar-hours', previewValues],
    enabled:
      opened &&
      previewValues.assignment === 'company' &&
      !!previewValues.start_date &&
      !!previewValues.end_date,
    retry: false,
    queryFn: () => api('/api/calendar-hours/preview', 'POST', previewValues),
  });
  useDirtyGuard(opened && form.isDirty());
  function open(day: string, event?: CalendarEvent) {
    setFailure(null);
    setScope('one');
    setKeepHours(true);
    setSelected(event?.id ?? null);
    const values = event
      ? {
          ...event,
          trade_ids: event.trade_ids.map(String),
          contractor_id: event.contractor_id ? String(event.contractor_id) : null,
          assignment: event.contractor_id ? 'company' : 'trade',
          start_time: event.start_time || '08:00',
          end_time: event.end_time || '09:00',
        }
      : empty(day);
    form.setValues(values);
    form.resetDirty(values);
    form.clearErrors();
    setOpened(true);
  }
  useEffect(() => {
    const key = linkedId ? 'event:' + linkedId : params.has('new_event') ? 'new' : '';
    if (!key || processedRoute.current === key) return;
    if (linkedId && !linked.data) return;
    processedRoute.current = key;
    if (linked.data && linkedId) {
      setAnchor(linked.data.event.start_date);
      open(linked.data.event.start_date, linked.data.event);
    } else open(today);
  }, [linkedId, linked.dataUpdatedAt, params.get('new_event')]);
  useEffect(() => {
    if (opened || !processedRoute.current) return;
    const next = new URLSearchParams(params);
    next.delete('calendar_event');
    next.delete('new_event');
    processedRoute.current = '';
    setParams(next, { replace: true });
  }, [opened]);
  async function repeat() {
    if (
      !selected ||
      busy ||
      !(await ask(
        'Weitere Termine dieser Serie anlegen? Jeder Termin bleibt einzeln bearbeitbar und startet als geplant.',
      ))
    )
      return;
    setBusy(true);
    try {
      await api('/api/calendar-events/' + selected + '/repeat', 'POST', {
        confirm: true,
        count: Number(repeatCount),
        interval_days: Number(repeatDays),
      });
      await cache.invalidateQueries({ queryKey: ['calendar-events'] });
      success('Terminserie angelegt.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function save(values: EventForm) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const impact = selected
        ? await api('/api/calendar-events/' + selected + '/impact?scope=' + scope)
        : null;
      if (
        impact &&
        scope !== 'one' &&
        !(await ask(
          'Änderung auf ' +
            impact.event_count +
            ' Termine anwenden? Datumsverschiebungen werden um das gleiche Delta übertragen. Betroffen: ' +
            (impact.confirmed_minutes + impact.planned_minutes) / 60 +
            ' Stunden.',
        ))
      )
        return;
      const {
        title,
        start_date,
        end_date,
        all_day,
        start_time,
        end_time,
        notes,
        trade_ids,
        contractor_id,
        assignment,
        performed,
      } = values;
      await api(
        '/api/calendar-events' + (selected ? '/' + selected : ''),
        selected ? 'PATCH' : 'POST',
        {
          title,
          start_date,
          end_date,
          all_day,
          start_time,
          end_time,
          notes,
          performed,
          work: values.work,
          scope,
          ...(impact ? { impact_token: impact.token } : {}),
          trade_ids: assignment === 'trade' ? trade_ids.map(Number) : [],
          contractor_id: assignment === 'company' && contractor_id ? Number(contractor_id) : null,
        },
      );
      form.resetDirty();
      setOpened(false);
      await Promise.all(
        ['calendar-events', 'time-tracking', 'time-person'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
      success('Termin gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!selected || busy) return;
    let impact;
    try {
      impact = await api('/api/calendar-events/' + selected + '/impact?scope=' + scope);
    } catch (e) {
      setFailure(e);
      return;
    }
    if (
      !(await ask({
        title: 'Termin löschen',
        confirmLabel: 'Löschen',
        message:
          impact.event_count +
          ' Termin(e) löschen? ' +
          impact.confirmed_minutes / 60 +
          ' erfasste Stunden werden ' +
          (keepHours ? 'als unabhängige Ist-Stunden erhalten.' : 'gemeinsam gelöscht.') +
          ' ' +
          impact.planned_minutes / 60 +
          ' geplante Stunden entfallen.',
      }))
    )
      return;
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/calendar-events/' + selected, 'DELETE', {
        scope,
        time_action: keepHours ? 'keep' : 'delete',
        impact_token: impact.token,
      });
      form.resetDirty();
      setOpened(false);
      await Promise.all(
        ['calendar-events', 'time-tracking', 'time-person'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
      success('Termin gelöscht.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  const selectedTrade = trades.data?.trades.find((item) => String(item.id) === trade);
  const matchesFilters = (event: CalendarEvent) =>
    (!trade ||
      event.trade_ids.includes(Number(trade)) ||
      (!!selectedTrade &&
        event.company_trade?.toLocaleLowerCase('de') ===
          selectedTrade.name.toLocaleLowerCase('de'))) &&
    (!company || event.contractor_id === Number(company));
  // Searching navigates across the entire project; only the two filters restrict the calendar.
  const visible = (events.data?.events || []).filter(matchesFilters);
  const query = search.trim().toLocaleLowerCase('de');
  const results = (searchEvents.data?.events || []).filter(
    (event) =>
      matchesFilters(event) &&
      `${event.title} ${event.company_name || ''} ${event.trades.map((t) => t.name).join(' ')}`
        .toLocaleLowerCase('de')
        .includes(query),
  );
  const activeIndex = Math.min(activeResult, Math.max(0, results.length - 1));
  useEffect(() => setActiveResult(0), [search, trade, company]);
  useEffect(() => {
    if (!jump) return;
    const frame = requestAnimationFrame(() => {
      const target = calendar.current?.querySelector<HTMLButtonElement>(
        `[data-calendar-day="${jump.day}"] [data-calendar-event="${jump.id}"]`,
      );
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [jump, events.data, view]);
  function jumpTo(event: CalendarEvent) {
    setSearchFocused(false);
    setAnchor(event.start_date);
    setJump({ id: event.id, day: event.start_date });
  }
  const resultDate = (event: CalendarEvent) => {
    const format: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    };
    return `${dateLabel(event.start_date, format)}${event.start_date !== event.end_date ? ' – ' + dateLabel(event.end_date, format) : ''} · ${event.all_day ? 'Ganztägig' : event.start_time + ' – ' + event.end_time}`;
  };
  const heading =
    view === 'month'
      ? dateLabel(anchor, { month: 'long', year: 'numeric' })
      : `${dateLabel(days[0])} – ${dateLabel(days[6], { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return (
    <div className="page project-calendar-page">
      <PageHeader
        title="Projektkalender"
        description="Termine planen und Gewerke oder Firmen verknüpfen."
      >
        <Button leftSection={<IconPlus size={17} />} onClick={() => open(today)}>
          Termin erstellen
        </Button>
        <Button component="a" href={projectURL('/api/calendar.ics')} variant="default">
          Kalender exportieren
        </Button>
      </PageHeader>
      <Paper withBorder p="sm" className="project-calendar-filters">
        <div className="project-calendar-search">
          <Popover
            opened={searchFocused && Boolean(query)}
            onDismiss={() => setSearchFocused(false)}
            position="bottom-start"
            width="target"
            shadow="md"
            offset={6}
            returnFocus={false}
          >
            <Popover.Target>
              <div>
                <SearchField
                  placeholder="Termine suchen"
                  value={search}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={searchFocused && Boolean(query)}
                  aria-controls={resultListId}
                  aria-activedescendant={
                    searchFocused && Boolean(query) && results.length
                      ? `${resultListId}-${activeIndex}`
                      : undefined
                  }
                  onFocus={() => setSearchFocused(true)}
                  onChange={(e) => {
                    setSearch(e.currentTarget.value);
                    setSearchFocused(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setSearchFocused(false);
                    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      setSearchFocused(true);
                      const next = Math.max(
                        0,
                        Math.min(
                          results.length - 1,
                          activeIndex + (event.key === 'ArrowDown' ? 1 : -1),
                        ),
                      );
                      setActiveResult(next);
                      document
                        .getElementById(`${resultListId}-${next}`)
                        ?.scrollIntoView({ block: 'nearest' });
                    } else if (
                      event.key === 'Enter' &&
                      Boolean(query) &&
                      searchFocused &&
                      results[activeIndex]
                    ) {
                      event.preventDefault();
                      jumpTo(results[activeIndex]);
                    }
                  }}
                />
              </div>
            </Popover.Target>
            <Popover.Dropdown className="project-calendar-search-dropdown">
              <Text size="xs" c="dimmed" px="sm" py={8} aria-live="polite">
                {searchEvents.isFetching
                  ? 'Termine werden gesucht …'
                  : `${results.length} Treffer im Projekt`}
              </Text>
              {searchEvents.error ? (
                <ErrorBox value={searchEvents.error} />
              ) : (
                <ScrollArea.Autosize mah={300}>
                  <div role="listbox" id={resultListId} aria-label="Gefundene Termine">
                    {results.map((event, index) => (
                      <button
                        key={event.id}
                        type="button"
                        role="option"
                        aria-selected={index === activeIndex}
                        id={`${resultListId}-${index}`}
                        className="project-calendar-search-result"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveResult(index)}
                        onClick={() => jumpTo(event)}
                      >
                        <strong>{event.title}</strong>
                        <span>{resultDate(event)}</span>
                        {(event.company_name || event.trades.length > 0) && (
                          <span>
                            {event.company_name || event.trades.map((t) => t.name).join(' · ')}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {!searchEvents.isFetching && results.length === 0 && (
                    <Text size="sm" px="sm" pb="sm" c="dimmed">
                      Keine passenden Termine gefunden.
                    </Text>
                  )}
                </ScrollArea.Autosize>
              )}
            </Popover.Dropdown>
          </Popover>
        </div>
        <FilterSelect
          aria-label="Gewerk filtern"
          placeholder="Alle Gewerke"
          value={trade}
          onChange={setTrade}
          data={(trades.data?.trades || []).map((t) => ({ value: String(t.id), label: t.name }))}
          clearable
        />
        <FilterSelect
          aria-label="Firma filtern"
          placeholder="Alle Firmen"
          value={company}
          onChange={setCompany}
          searchable
          clearable
          data={companyChoices(events.data?.companies || [])}
        />
      </Paper>
      <ErrorBox value={events.error || trades.error || linked.error} />
      <Paper withBorder className="project-calendar-panel">
        <div className="project-calendar-toolbar">
          <Group gap={6} wrap="nowrap">
            <Button variant="default" size="compact-sm" onClick={() => setAnchor(today)}>
              Heute
            </Button>
            <Tooltip label={view === 'month' ? 'Vorheriger Monat' : 'Vorherige Woche'}>
              <ActionIcon
                aria-label="Vorheriger Zeitraum"
                variant="default"
                onClick={() => setAnchor(shiftCalendar(anchor, -1, view))}
              >
                <IconChevronLeft size={17} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={view === 'month' ? 'Nächster Monat' : 'Nächste Woche'}>
              <ActionIcon
                aria-label="Nächster Zeitraum"
                variant="default"
                onClick={() => setAnchor(shiftCalendar(anchor, 1, view))}
              >
                <IconChevronRight size={17} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Text fw={650} className="project-calendar-period" aria-live="polite">
            {heading}
          </Text>
          <Group gap={8} wrap="nowrap">
            {events.isFetching && <Loader size={14} />}
            <SegmentedControl
              aria-label="Kalenderansicht"
              size="xs"
              value={view}
              onChange={setView}
              data={[
                { value: 'week', label: 'Woche' },
                { value: 'month', label: 'Monat' },
              ]}
            />
          </Group>
        </div>
        <div ref={calendar} className="project-calendar-scroll" tabIndex={0} aria-label="Kalender">
          <div className={'project-calendar-grid ' + (view === 'week' ? 'is-week' : 'is-month')}>
            {days.slice(0, 7).map((day) => (
              <div className="project-calendar-weekday" key={day}>
                {dateLabel(day, { weekday: 'short' })}
              </div>
            ))}
            {days.map((day) => {
              const appointments = visible.filter((event) => onDay(event, day));
              return (
                <div
                  key={day}
                  data-calendar-day={day}
                  onClick={(event) => {
                    if (event.target instanceof Element && !event.target.closest('button')) {
                      open(day);
                    }
                  }}
                  className={
                    'project-calendar-day' +
                    (day === today ? ' is-today' : '') +
                    (view === 'month' && day.slice(0, 7) !== anchor.slice(0, 7)
                      ? ' is-outside'
                      : '')
                  }
                >
                  <button
                    type="button"
                    className="project-calendar-day-add"
                    aria-label={`Termin am ${dateLabel(day, { day: 'numeric', month: 'long', year: 'numeric' })} erstellen`}
                    onClick={() => open(day)}
                  >
                    <span>
                      {dateLabel(day, {
                        day: 'numeric',
                        ...(view === 'week' ? { month: 'short' } : {}),
                      })}
                    </span>
                    <IconPlus size={13} />
                  </button>
                  <div className="project-calendar-appointments">
                    {appointments.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        data-calendar-event={event.id}
                        className={
                          'project-calendar-event tone-' +
                          ((event.trade_ids[0] || 0) % 4) +
                          (jump?.id === event.id && jump.day === day ? ' is-search-target' : '')
                        }
                        onClick={() => open(day, event)}
                        title={
                          event.title +
                          (event.trades.length
                            ? ' · ' + event.trades.map((t) => t.name).join(', ')
                            : '')
                        }
                      >
                        <span className="project-calendar-event-time">
                          {event.all_day
                            ? event.start_date === event.end_date
                              ? 'Ganztägig'
                              : `${dateLabel(event.start_date, { day: '2-digit', month: '2-digit' })} – ${dateLabel(event.end_date, { day: '2-digit', month: '2-digit' })}`
                            : `${day === event.start_date ? event.start_time : '↳'} – ${day === event.end_date ? event.end_time : '…'}`}
                        </span>
                        <strong>{event.title}</strong>
                        {(event.company_name || event.trades.length > 0) && (
                          <span className="project-calendar-event-trades">
                            {event.company_name || event.trades.map((t) => t.name).join(' · ')}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {!events.isPending && !events.error && visible.length === 0 && (
          <Text className="project-calendar-empty" size="sm" c="dimmed">
            {trade || company
              ? 'Keine Termine für diese Auswahl.'
              : 'Noch keine Termine in diesem Zeitraum. Wähle einen Tag oder erstelle deinen ersten Termin.'}
          </Text>
        )}
      </Paper>
      <Editor
        opened={opened}
        title={selected ? 'Termin bearbeiten' : 'Termin erstellen'}
        dirty={form.isDirty()}
        busy={busy}
        suspended={dossierEditing}
        onClose={() => setOpened(false)}
      >
        <form onSubmit={form.onSubmit(save)}>
          <Stack gap="sm">
            <ErrorBox value={failure} />
            <TextInput
              label="Titel"
              placeholder="Zum Beispiel: Treppenbauer – Aufmaß"
              required
              maxLength={160}
              {...form.getInputProps('title')}
            />
            <Checkbox
              label="Wie geplant durchgeführt – Stunden als geleistet bestätigen"
              {...form.getInputProps('performed', { type: 'checkbox' })}
            />
            <Checkbox label="Ganztägig" {...form.getInputProps('all_day', { type: 'checkbox' })} />
            <div className="project-calendar-date-fields">
              <TextInput
                type="date"
                label="Beginn"
                required
                {...form.getInputProps('start_date')}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  form.setFieldValue('start_date', value);
                  if (value > form.values.end_date) form.setFieldValue('end_date', value);
                }}
              />
              <TextInput
                type="date"
                label="Ende"
                required
                min={form.values.start_date}
                {...form.getInputProps('end_date')}
              />
              {!form.values.all_day && (
                <>
                  <TextInput
                    type="time"
                    label="Von"
                    required
                    {...form.getInputProps('start_time')}
                  />
                  <TextInput type="time" label="Bis" required {...form.getInputProps('end_time')} />
                </>
              )}
            </div>
            <Select
              label="Verknüpfen mit"
              allowDeselect={false}
              data={[
                { value: 'trade', label: 'Gewerk' },
                { value: 'company', label: 'Firma aus Stammdaten' },
              ]}
              {...form.getInputProps('assignment')}
            />
            {form.values.assignment === 'company' ? (
              <>
                <Select
                  label="Firma"
                  placeholder="Firma aus den Stammdaten auswählen"
                  searchable
                  required
                  nothingFoundMessage="Keine Firma gefunden"
                  data={companyChoices(events.data?.companies || [])}
                  {...form.getInputProps('contractor_id')}
                />
                <SimpleWorkFields
                  work={form.values.work}
                  onChange={(work) => form.setFieldValue('work', work)}
                />
                <ErrorBox value={hours.error} />
                {hours.data && (
                  <Text size="sm" fw={600}>
                    Stundenvorschau: {Number(hours.data.total_minutes) / 60} Std. an{' '}
                    {hours.data.days.length} Tagen · {form.values.performed ? 'Ist' : 'Geplant'}
                  </Text>
                )}
              </>
            ) : (
              <MultiSelect
                label="Gewerke"
                placeholder="Optional aus den Stammdaten auswählen"
                searchable
                clearable
                data={(trades.data?.trades || []).map((t) => ({
                  value: String(t.id),
                  label: t.name,
                }))}
                {...form.getInputProps('trade_ids')}
              />
            )}
            <Textarea
              label="Notizen"
              placeholder="Was wird gemacht? Was ist vorzubereiten?"
              autosize
              minRows={3}
              maxRows={7}
              maxLength={4000}
              {...form.getInputProps('notes')}
            />
            {selected && (
              <>
                {form.values.series && (
                  <Select
                    label="Änderungen anwenden auf"
                    value={scope}
                    onChange={(v) => setScope(v || 'one')}
                    allowDeselect={false}
                    data={[
                      { value: 'one', label: 'Nur diesen Termin' },
                      { value: 'following', label: 'Diesen und folgende Termine' },
                      { value: 'series', label: 'Gesamte Serie' },
                    ]}
                  />
                )}
                <Checkbox
                  label="Beim Löschen erfasste Ist-Stunden erhalten"
                  checked={keepHours}
                  onChange={(e) => setKeepHours(e.currentTarget.checked)}
                />
              </>
            )}
            {selected && (
              <>
                <WorkButton type="event" id={selected} />
                <CompanionPanel
                  kind="dossier"
                  source={{ type: 'event', id: selected }}
                  onEditingChange={setDossierEditing}
                />
                <Accordion>
                  <Accordion.Item value="series">
                    <Accordion.Control>Termin wiederholen</Accordion.Control>
                    <Accordion.Panel>
                      <Group align="end">
                        <NumberInput
                          label="Weitere Termine"
                          min={1}
                          max={52}
                          value={repeatCount}
                          onChange={setRepeatCount}
                        />
                        <NumberInput
                          label="Abstand (Tage)"
                          min={1}
                          max={365}
                          value={repeatDays}
                          onChange={setRepeatDays}
                        />
                        <Button
                          variant="default"
                          disabled={busy || !!form.values.series}
                          onClick={() => void repeat()}
                        >
                          Serie anlegen
                        </Button>
                      </Group>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </>
            )}
            <Group justify="space-between" mt="sm">
              <div>
                {selected && (
                  <Button
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={16} />}
                    onClick={remove}
                    disabled={busy}
                  >
                    Löschen
                  </Button>
                )}
              </div>
              <Button type="submit" loading={busy}>
                Speichern
              </Button>
            </Group>
          </Stack>
        </form>
      </Editor>
    </div>
  );
}

function SimpleWorkFields({
  work,
  onChange,
}: {
  work: CalendarEvent['work'];
  onChange: (work: CalendarEvent['work']) => void;
}) {
  return (
    <Stack gap="xs">
      <Select
        label="Arbeitszeitberechnung"
        value={work.mode}
        allowDeselect={false}
        data={[
          { value: 'daily', label: 'Tägliche Arbeitszeit' },
          { value: 'continuous', label: 'Durchgehender Zeitraum (auch nachts)' },
        ]}
        onChange={(v) => onChange({ ...work, mode: v || 'daily' })}
      />
      <MultiSelect
        label="Arbeitstage"
        data={['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label, value) => ({
          label,
          value: String(value),
        }))}
        value={work.weekdays.map(String)}
        onChange={(v) => onChange({ ...work, weekdays: v.map(Number) })}
      />
      <Group grow>
        <NumberInput
          label="Pause je Tag (Min.)"
          min={0}
          max={720}
          value={work.break_minutes}
          onChange={(v) => onChange({ ...work, break_minutes: Number(v) || 0 })}
        />
        <NumberInput
          label="Ganztägig: Minuten je Tag"
          min={1}
          max={1440}
          value={work.daily_minutes}
          onChange={(v) => onChange({ ...work, daily_minutes: Number(v) || 480 })}
        />
      </Group>
    </Stack>
  );
}

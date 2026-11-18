import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Loader,
  MultiSelect,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Editor, ErrorBox, api, success, useConfirm } from './core';
import { PageHeader } from './page-layout';
import { FilterSelect, SearchField, useViewState } from './ui';
import { useDirtyGuard } from './shell';
import { calendarDays, dayKey, localDay, onDay, shiftCalendar } from './calendar-model';
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
};
type EventForm = Omit<CalendarEvent, 'id' | 'trades' | 'trade_ids'> & { trade_ids: string[] };
const empty = (day: string): EventForm => ({
  title: '',
  start_date: day,
  end_date: day,
  all_day: true,
  start_time: '08:00',
  end_time: '09:00',
  notes: '',
  trade_ids: [],
});
const dateLabel = (day: string, options?: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('de-DE', options || { day: 'numeric', month: 'long' }).format(
    localDay(day),
  );

export function ProjectCalendar() {
  const today = dayKey(new Date()),
    cache = useQueryClient(),
    ask = useConfirm();
  const [view, setView] = useViewState('project-calendar-view', 'month');
  const [anchor, setAnchor] = useState(today),
    [search, setSearch] = useState(''),
    [trade, setTrade] = useState<string | null>(null);
  const [opened, setOpened] = useState(false),
    [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  const days = calendarDays(anchor, view);
  const events = useQuery({
    queryKey: ['calendar-events', days[0], days.at(-1)],
    queryFn: () =>
      api<{ events: CalendarEvent[] }>(`/api/calendar-events?from=${days[0]}&to=${days.at(-1)}`),
  });
  const trades = useQuery({
    queryKey: ['calendar-trades'],
    queryFn: () => api<{ trades: { id: number; name: string }[] }>('/api/trades'),
  });
  const form = useForm<EventForm>({
    initialValues: empty(today),
    validate: {
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
  useDirtyGuard(opened && form.isDirty());
  function open(day: string, event?: CalendarEvent) {
    setFailure(null);
    setSelected(event?.id ?? null);
    const values = event
      ? {
          ...event,
          trade_ids: event.trade_ids.map(String),
          start_time: event.start_time || '08:00',
          end_time: event.end_time || '09:00',
        }
      : empty(day);
    form.setValues(values);
    form.resetDirty(values);
    form.clearErrors();
    setOpened(true);
  }
  async function save(values: EventForm) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const { title, start_date, end_date, all_day, start_time, end_time, notes, trade_ids } =
        values;
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
          trade_ids: trade_ids.map(Number),
        },
      );
      form.resetDirty();
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['calendar-events'] });
      success('Termin gespeichert.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !selected ||
      busy ||
      !(await ask({
        title: 'Termin löschen',
        message: 'Diesen Termin endgültig löschen?',
        confirmLabel: 'Löschen',
      }))
    )
      return;
    setBusy(true);
    setFailure(null);
    try {
      await api('/api/calendar-events/' + selected, 'DELETE');
      form.resetDirty();
      setOpened(false);
      await cache.invalidateQueries({ queryKey: ['calendar-events'] });
      success('Termin gelöscht.');
    } catch (e) {
      setFailure(e);
    } finally {
      setBusy(false);
    }
  }
  const visible = (events.data?.events || []).filter(
    (event) =>
      (!trade || event.trade_ids.includes(Number(trade))) &&
      `${event.title} ${event.trades.map((t) => t.name).join(' ')}`
        .toLocaleLowerCase('de')
        .includes(search.trim().toLocaleLowerCase('de')),
  );
  const heading =
    view === 'month'
      ? dateLabel(anchor, { month: 'long', year: 'numeric' })
      : `${dateLabel(days[0])} – ${dateLabel(days[6], { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return (
    <div className="page project-calendar-page">
      <PageHeader
        title="Projektkalender"
        description="Termine planen und die passenden Gewerke verknüpfen."
      >
        <Button leftSection={<IconPlus size={17} />} onClick={() => open(today)}>
          Termin erstellen
        </Button>
      </PageHeader>
      <Paper withBorder p="sm" className="project-calendar-filters">
        <SearchField
          placeholder="Termine suchen"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <FilterSelect
          aria-label="Gewerk filtern"
          placeholder="Alle Gewerke"
          value={trade}
          onChange={setTrade}
          data={(trades.data?.trades || []).map((t) => ({ value: String(t.id), label: t.name }))}
          clearable
        />
      </Paper>
      <ErrorBox value={events.error || trades.error} />
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
        <div className="project-calendar-scroll" tabIndex={0} aria-label="Kalender">
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
                        className={'project-calendar-event tone-' + ((event.trade_ids[0] || 0) % 4)}
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
                        {event.trades.length > 0 && (
                          <span className="project-calendar-event-trades">
                            {event.trades.map((t) => t.name).join(' · ')}
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
            {search || trade
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
            <Textarea
              label="Notizen"
              placeholder="Was wird gemacht? Was ist vorzubereiten?"
              autosize
              minRows={3}
              maxRows={7}
              maxLength={4000}
              {...form.getInputProps('notes')}
            />
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

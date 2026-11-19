import {
  ActionIcon,
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconArrowRight, IconExternalLink, IconStar, IconX } from '@tabler/icons-react';
import { useLocalStorage } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, Editor, ErrorBox, hasWrites, Row } from './core';
import { projectID } from './project-context';
import { SearchField } from './ui';
import { workshopViews } from './workshop-catalog';
import { Calculator } from './quantity-calculator';
import { roomEdgeLabels, roomGeometry, svgPath } from './tile-geometry';
import { tileLayout } from './tile-layout';
import './workshop-quick-access.css';

const format = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const date = (value: string) =>
  value ? new Date(value + 'T12:00:00').toLocaleDateString('de-DE') : '';
const sanitize = (value: unknown) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (v): v is string =>
              typeof v === 'string' && workshopViews.some((view) => view.value === v),
          ),
        ),
      ]
    : [];
export function useWorkshopFavorites() {
  const [stored, setStored] = useLocalStorage<string[]>({
    key: 'phb-workshop-favorites:' + projectID,
    defaultValue: [],
    getInitialValueInEffect: false,
  });
  const values = sanitize(stored);
  return {
    values,
    toggle: (id: string) =>
      setStored((current) => {
        const valid = sanitize(current);
        return valid.includes(id) ? valid.filter((v) => v !== id) : [...valid, id];
      }),
  };
}

function QuickRooms({ records }: { records: Row[] }) {
  const [id, setId] = useState<string | null>(null);
  const rooms = records
    .filter((row) => row.kind === 'room')
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const room = rooms.find((row) => String(row.id) === id) || rooms[0];
  if (!room)
    return (
      <Text size="sm" c="dimmed">
        Noch keine Räume erfasst.
      </Text>
    );
  try {
    const geometry = room.data.geometry,
      plan = roomGeometry(geometry.width, geometry.height, 0, geometry.contour);
    const walls = roomEdgeLabels(
      plan.room,
      geometry.width,
      geometry.height,
      Math.max(geometry.width, geometry.height) * 0.065,
    );
    return (
      <Stack gap="sm">
        <Select
          label="Raum"
          searchable
          value={String(room.id)}
          allowDeselect={false}
          onChange={setId}
          data={rooms.map((row) => ({
            value: String(row.id),
            label: row.title + (row.location ? ' · ' + row.location : ''),
          }))}
        />
        <Paper withBorder p="sm">
          <Group justify="space-between">
            <div>
              <Text size="xs" c="dimmed">
                Grundrissfläche
              </Text>
              <Text size="xl" fw={650}>
                {format(plan.area / 1e6)} m²
              </Text>
            </div>
            <Text size="sm" c="dimmed">
              Umfang {format(walls.edges.reduce((sum, edge) => sum + edge.length, 0) / 1000)} m
            </Text>
          </Group>
        </Paper>
        <svg
          className="workshop-quick-plan"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          role="img"
          aria-label={'Grundriss: ' + room.title}
        >
          <path
            d={svgPath([plan.room])}
            fill="#c2d7ae"
            stroke="#51685b"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <Text size="xs" c="dimmed">
          {geometry.contour ? 'Planrahmen' : 'Raummaße'}: {format(geometry.width / 1000)} ×{' '}
          {format(geometry.height / 1000)} m
        </Text>
        <Accordion variant="contained">
          <Accordion.Item value="edges">
            <Accordion.Control>Raumkanten ({walls.edges.length})</Accordion.Control>
            <Accordion.Panel>
              <Table>
                <Table.Tbody>
                  {walls.edges.map((edge) => (
                    <Table.Tr key={edge.id}>
                      <Table.Td>
                        {edge.id} · P{edge.from}–P{edge.to}
                      </Table.Td>
                      <Table.Td align="right">{format(edge.length / 10)} cm</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
        {room.body && (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {room.body}
          </Text>
        )}
      </Stack>
    );
  } catch (e) {
    return <ErrorBox value={e} />;
  }
}

function QuickTiles({ records }: { records: Row[] }) {
  const [id, setId] = useState<string | null>(null);
  const rows = records
    .filter((row) => row.kind === 'tile_plan')
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const row = rows.find((item) => String(item.id) === id) || rows[0];
  if (!row)
    return (
      <Text size="sm" c="dimmed">
        Noch keine Verlegepläne gespeichert.
      </Text>
    );
  try {
    const s = row.data.settings,
      plan = tileLayout(s);
    return (
      <Stack gap="sm">
        <Select
          label="Gespeicherter Verlegeplan"
          searchable
          allowDeselect={false}
          value={String(row.id)}
          onChange={setId}
          data={rows.map((item) => ({ value: String(item.id), label: item.title }))}
        />
        <Group justify="space-between">
          <Text fw={650}>{format(plan.area)} m²</Text>
          <Text size="sm">ca. {plan.purchase} Fliesen inkl. Reserve</Text>
        </Group>
        <Text size="sm" c="dimmed">
          {plan.full} ganze Fliesen · {plan.cut} Zuschnitte · Fliese {format(plan.tileWidth / 10)} ×{' '}
          {format(plan.tileHeight / 10)} cm
        </Text>
        <svg
          className="workshop-quick-plan"
          viewBox={`0 0 ${s.width} ${s.height}`}
          role="img"
          aria-label="Vorschau des gespeicherten Fliesenplans"
        >
          <path d={svgPath([plan.room])} fill="#ced6d0" />
          {plan.pieces.map((piece) => (
            <path
              key={piece.id}
              d={svgPath(piece.paths)}
              fill={piece.cut ? '#f5e1be' : '#c2d7ae'}
              stroke="#73846f"
              strokeWidth=".5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <Text size="xs" c="dimmed">
          Gespeicherter Stand · Änderungen und neue Pläne in der vollständigen Ansicht.
        </Text>
      </Stack>
    );
  } catch (e) {
    return <ErrorBox value={e} />;
  }
}

function QuickShopping() {
  const q = useQuery({
    queryKey: ['companion-shopping'],
    queryFn: () => api('/api/companion/shopping'),
  });
  if (q.isPending) return <Loader size="sm" />;
  const materials = (q.data?.materials || []).filter((row: Row) => row.status !== 'Vorhanden');
  return (
    <Stack gap="xs">
      <ErrorBox value={q.error} />
      {!materials.length && (
        <Text size="sm" c="dimmed">
          Keine offenen Materialbeschaffungen.
        </Text>
      )}
      {materials.map((row: Row) => (
        <Paper withBorder p="xs" key={row.key}>
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              {row.title}
            </Text>
            <Badge variant="light" size="sm">
              {row.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {format(row.quantity)} {row.unit}
            {row.unknown_quantity ? ' · Menge teilweise offen' : ''}
          </Text>
        </Paper>
      ))}
      <Accordion variant="contained">
        <Accordion.Item value="tools">
          <Accordion.Control>Werkzeuge ({q.data?.tools?.length || 0})</Accordion.Control>
          <Accordion.Panel>
            {(q.data?.tools || []).map((row: Row, index: number) => (
              <Text key={index} size="sm">
                {row.title}
                {row.quantity ? ' · ' + row.quantity + ' ' + (row.unit || '') : ''}
              </Text>
            ))}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

function QuickKnowledge({ data }: { data: Row }) {
  const [search, setSearch] = useState('');
  const glossary = [
    ...(data.glossary || []),
    ...(data.records || []).filter(
      (row: Row) => row.kind === 'glossary' && row.status !== 'Archiviert',
    ),
  ];
  const rows = glossary.filter((row) =>
    (row.title + ' ' + row.body).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <Stack gap="sm">
      <SearchField
        placeholder="Begriff oder Werkzeug suchen"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Accordion multiple>
        {rows.map((row, index) => (
          <Accordion.Item value={String(index)} key={index}>
            <Accordion.Control>{row.title}</Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {row.body}
              </Text>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      {!rows.length && (
        <Text size="sm" c="dimmed">
          Keine passenden Begriffe.
        </Text>
      )}
    </Stack>
  );
}

function QuickRecords({ view, data }: { view: string; data: Row }) {
  if (view === 'templates')
    return (
      <Accordion>
        {(data.templates || []).map((row: Row) => (
          <Accordion.Item value={row.id} key={row.id}>
            <Accordion.Control>{row.title}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {row.steps.map((step: string, index: number) => (
                  <Text size="sm" key={index}>
                    {index + 1}. {step}
                  </Text>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    );
  const kind = (
    { journal: 'journal', defect: 'defect', house: 'house', funding: 'reminder' } as Record<
      string,
      string
    >
  )[view];
  const rows = (data.records || [])
    .filter((row: Row) => row.kind === kind && row.status !== 'Archiviert')
    .sort((a: Row, b: Row) =>
      view === 'journal'
        ? (b.day || '').localeCompare(a.day || '')
        : (a.until || '9999').localeCompare(b.until || '9999'),
    );
  return (
    <Stack gap="xs">
      {!rows.length && (
        <Text size="sm" c="dimmed">
          Noch keine Einträge in diesem Bereich.
        </Text>
      )}
      {rows.map((row: Row) => (
        <Paper withBorder p="sm" key={row.id}>
          <Group justify="space-between" align="start">
            <Text fw={600} size="sm">
              {row.title}
            </Text>
            <Badge size="sm" variant="light">
              {row.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {[
              row.location,
              date(row.day),
              row.until ? 'Frist: ' + date(row.until) : '',
              row.data?.document_ids?.length ? row.data.document_ids.length + ' Unterlagen' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {row.body && (
            <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
              {row.body}
            </Text>
          )}
        </Paper>
      ))}
      {view === 'funding' && !!data.references?.funding?.length && (
        <Accordion>
          <Accordion.Item value="funding">
            <Accordion.Control>
              Erfasste Förderungen ({data.references.funding.length})
            </Accordion.Control>
            <Accordion.Panel>
              {data.references.funding.map((row: Row) => (
                <Text size="sm" key={row.id}>
                  {row.title}
                </Text>
              ))}
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  );
}

function QuickView({ view }: { view: string }) {
  const q = useQuery({
    queryKey: ['companion'],
    queryFn: () => api('/api/companion'),
    enabled: view !== 'tools' && view !== 'shopping',
  });
  if (view === 'tools') return <Calculator />;
  if (view === 'shopping') return <QuickShopping />;
  if (q.isPending) return <Loader size="sm" />;
  if (q.error) return <ErrorBox value={q.error} />;
  const data = q.data || {};
  if (view === 'rooms') return <QuickRooms records={data.records || []} />;
  if (view === 'tiles') return <QuickTiles records={data.records || []} />;
  if (view === 'knowledge') return <QuickKnowledge data={data} />;
  return <QuickRecords view={view} data={data} />;
}

export function WorkshopQuickAccess() {
  const favorites = useWorkshopFavorites(),
    navigate = useNavigate();
  const [menu, setMenu] = useState(false),
    [active, setActive] = useState<string | null>(null);
  const views = workshopViews.filter((view) => favorites.values.includes(view.value));
  const selected = workshopViews.find((view) => view.value === active);
  const close = () => {
    if (!hasWrites()) setActive(null);
  };
  return (
    <>
      <Popover
        opened={menu}
        onChange={setMenu}
        position="bottom-end"
        width={320}
        shadow="md"
        withinPortal
        zIndex={330}
      >
        <Popover.Target>
          <Tooltip label="Werkstatt-Favoriten">
            <ActionIcon
              size="lg"
              variant="default"
              aria-label="Werkstatt-Schnellzugriff"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <IconStar size={18} fill={views.length ? 'currentColor' : 'none'} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown
          style={{ maxHeight: '70dvh', overflowY: 'auto', maxWidth: 'calc(100vw - 20px)' }}
        >
          <Stack gap="xs">
            <Text fw={600} size="sm">
              Werkstatt-Schnellzugriff
            </Text>
            {!views.length && (
              <>
                <Text size="sm" c="dimmed">
                  Markiere Werkstattkacheln mit dem Stern, um sie hier schnell zu öffnen.
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    setMenu(false);
                    navigate('/projektwerkstatt');
                  }}
                >
                  Zur Projektwerkstatt
                </Button>
              </>
            )}
            {views.map((view) => (
              <Group key={view.value} gap="xs" wrap="nowrap">
                <UnstyledButton
                  className="workshop-favorite-link"
                  onClick={() => {
                    setMenu(false);
                    setActive(view.value);
                  }}
                >
                  <view.icon size={18} />
                  <Text size="sm">{view.label}</Text>
                  <IconArrowRight size={15} />
                </UnstyledButton>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={view.label + ' aus Favoriten entfernen'}
                  title="Aus Favoriten entfernen"
                  onClick={() => favorites.toggle(view.value)}
                >
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </Popover.Dropdown>
      </Popover>
      <Editor
        opened={!!selected}
        title={'Schnellzugriff · ' + (selected?.label || 'Werkstatt')}
        size="min(680px, 96vw)"
        zIndex={250}
        onClose={close}
        className="workshop-quick-dialog"
      >
        {selected && (
          <Stack gap="sm">
            <QuickView key={selected.value} view={selected.value} />
            <Group justify="flex-end">
              <Button
                variant="default"
                size="xs"
                leftSection={<IconExternalLink size={15} />}
                onClick={() => {
                  if (hasWrites()) return;
                  setActive(null);
                  navigate('/projektwerkstatt?tab=' + selected.value);
                }}
              >
                Vollständige Ansicht öffnen
              </Button>
            </Group>
          </Stack>
        )}
      </Editor>
    </>
  );
}

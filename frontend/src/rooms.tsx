import { DraftTools } from './draft-tools';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useForm } from '@mantine/form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, Editor, error, ErrorBox, Row, success, useConfirm } from './core';
import { SearchField } from './ui';
import { useDirtyGuard } from './shell';
import { RoomGeometry, RoomGeometryFields, roomGeometryOnly } from './room-geometry-fields';
import { roomGeometry, roomEdgeLabels, svgPath } from './tile-geometry';
import './tile-planner.css';
import './rooms.css';

const number = (n: number, digits = 2) =>
  n.toLocaleString('de-DE', { maximumFractionDigits: digits });
const fresh = () => ({
  title: '',
  location: '',
  body: '',
  geometry: { width: 4000, height: 3000, roomShape: 'rectangle' } as RoomGeometry,
});
function inspect(geometry: RoomGeometry) {
  if (
    !Number.isFinite(geometry.width) ||
    !Number.isFinite(geometry.height) ||
    geometry.width < 100 ||
    geometry.height < 100 ||
    geometry.width > 100000 ||
    geometry.height > 100000
  )
    throw Error('Raumbreite und -tiefe müssen zwischen 10 und 10.000 cm liegen.');
  return roomGeometry(geometry.width, geometry.height, 0, geometry.contour);
}
function RoomPreview({ geometry, compact = false }: { geometry: RoomGeometry; compact?: boolean }) {
  const [edge, setEdge] = useState('');
  try {
    const plan = inspect(geometry),
      margin = Math.max(geometry.width, geometry.height) * 0.065;
    const walls = roomEdgeLabels(plan.room, geometry.width, geometry.height, margin),
      box = walls.viewBox;
    return (
      <Stack gap="xs">
        <svg
          className={compact ? 'room-thumbnail' : 'tile-plan-svg'}
          viewBox={`${box.left} ${box.top} ${box.width} ${box.height}`}
          role="img"
          aria-label="Grundriss des Raums"
        >
          <path
            d={svgPath([plan.room])}
            fill="#c2d7ae"
            stroke="#51685b"
            strokeWidth={margin / 35}
          />
          {!compact &&
            walls.edges.map((w) => (
              <g key={w.id} pointerEvents="none">
                {edge === w.id && (
                  <line
                    x1={w.a.x}
                    y1={w.a.y}
                    x2={w.b.x}
                    y2={w.b.y}
                    stroke="#1b5533"
                    strokeWidth="4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <line
                  x1={w.middle.x}
                  y1={w.middle.y}
                  x2={w.label.x}
                  y2={w.label.y}
                  stroke="#7b8e82"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={w.label.x}
                  cy={w.label.y}
                  r={walls.fontSize * 1.12}
                  fill="#f4f6f1"
                  stroke="#51685b"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={w.label.x}
                  y={w.label.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#355344"
                  fontSize={walls.fontSize}
                  fontWeight="600"
                >
                  {w.id}
                </text>
              </g>
            ))}
          {!compact &&
            plan.room.map((point, index) => (
              <g key={'point-' + index} className="room-point-marker">
                <title>{`P${index + 1} · X: ${number(point.x, 3)} mm · Y: ${number(point.y, 3)} mm`}</title>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={margin * 0.045}
                  fill="#1b5533"
                  stroke="#f4f6f1"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={point.x + margin * 0.09}
                  y={point.y + margin * 0.19}
                  fill="#173e29"
                  stroke="#f4f6f1"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                  paintOrder="stroke"
                  fontSize={margin * 0.21}
                  fontWeight="700"
                >
                  P{index + 1}
                </text>
              </g>
            ))}
        </svg>
        {!compact && (
          <>
            <Text size="xs" c="dimmed">
              P1, P2, … sind die Raumpunkte in derselben Reihenfolge wie in der Eckpunktbearbeitung.
            </Text>
            <Group gap="xs">
              <Badge variant="light">{number(plan.area / 1e6)} m²</Badge>
              <Badge variant="light">
                Umfang {number(walls.edges.reduce((sum, w) => sum + w.length, 0) / 1000)} m
              </Badge>
            </Group>
            <div className="tile-edge-legend" role="group" aria-label="Raumkanten und Längen">
              {walls.edges.map((w) => (
                <button
                  type="button"
                  className="tile-edge-item"
                  key={w.id}
                  aria-pressed={edge === w.id}
                  onClick={() => setEdge(w.id)}
                >
                  <strong>{w.id}</strong>
                  <span>{number(w.length, 3)} mm</span>
                  <small>
                    P{w.from}–P{w.to}
                  </small>
                </button>
              ))}
            </div>
          </>
        )}
      </Stack>
    );
  } catch (e) {
    return compact ? null : (
      <Alert color="orange">{e instanceof Error ? e.message : String(e)}</Alert>
    );
  }
}

export function Rooms() {
  const query = useQuery({
    queryKey: ['companion', 'rooms'],
    queryFn: () => api('/api/companion?kind=room&references=0'),
  });
  const cache = useQueryClient(),
    ask = useConfirm(),
    navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [opened, setOpened] = useState(false),
    [id, setId] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [showPoints, setShowPoints] = useState(false),
    [search, setSearch] = useState('');
  const form = useForm({ initialValues: fresh() }),
    version = useRef(''),
    handled = useRef('');
  useDirtyGuard(opened && form.isDirty());
  const rows: Row[] = (query.data?.records || [])
    .filter((x: Row) => x.kind === 'room')
    .sort((a: Row, b: Row) => a.title.localeCompare(b.title, 'de'));
  const valid = useMemo(() => {
    try {
      inspect(form.values.geometry);
      return true;
    } catch {
      return false;
    }
  }, [form.values.geometry]);
  function route(value: number | null) {
    const next = new URLSearchParams(params);
    if (value) next.set('record', String(value));
    else next.delete('record');
    handled.current = value ? String(value) : '';
    setParams(next, { replace: true });
  }
  function edit(row?: Row) {
    const values = row
      ? {
          title: row.title,
          location: row.location,
          body: row.body,
          geometry: roomGeometryOnly(row.data.geometry),
        }
      : fresh();
    form.setValues(values);
    form.resetDirty(values);
    setId(row?.id || null);
    setShowPoints(false);
    setOpened(true);
    version.current = row ? query.data?._versions?.['/api/companion/records/' + row.id] || '' : '';
  }
  useEffect(() => {
    const target = params.get('record');
    if (!target || handled.current === target || !query.data) return;
    handled.current = target;
    const row = rows.find((x) => String(x.id) === target);
    if (row && !opened) edit(row);
  }, [params.get('record'), query.dataUpdatedAt]);
  async function save() {
    if (!valid || !form.values.title.trim()) return;
    setBusy(true);
    try {
      const result = await api(
        '/api/companion/records' + (id ? '/' + id : ''),
        id ? 'PATCH' : 'POST',
        {
          kind: 'room',
          title: form.values.title.trim(),
          location: form.values.location,
          body: form.values.body,
          data: { geometry: roomGeometryOnly(form.values.geometry), document_ids: [] },
        },
        false,
        version.current ? { 'If-Match': version.current } : {},
      );
      version.current = result._versions?.['/api/companion/records/' + result.record.id] || '';
      setId(result.record.id);
      route(result.record.id);
      form.resetDirty();
      await cache.invalidateQueries({ queryKey: ['companion'] });
      success('Raum gespeichert.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !id ||
      !(await ask(
        'Diesen Raum löschen? Bereits übernommene Grundrisse in Verlegeplänen bleiben erhalten.',
      ))
    )
      return;
    setBusy(true);
    try {
      await api(
        '/api/companion/records/' + id,
        'DELETE',
        undefined,
        false,
        version.current ? { 'If-Match': version.current } : {},
      );
      setOpened(false);
      route(null);
      await cache.invalidateQueries({ queryKey: ['companion'] });
      success('Raum gelöscht.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Räume & Grundrisse</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => {
            route(null);
            edit();
          }}
        >
          Raum anlegen
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Grundrisse einmal erfassen und für weitere Planungen wiederverwenden.
      </Text>
      <SearchField
        placeholder="Raum oder Etage suchen"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <ErrorBox value={query.error} />
      <div className="companion-workshop-grid">
        {rows
          .filter((row) =>
            (row.title + ' ' + row.location)
              .toLocaleLowerCase()
              .includes(search.toLocaleLowerCase()),
          )
          .map((row) => {
            let area = '';
            try {
              area = number(inspect(row.data.geometry).area / 1e6) + ' m²';
            } catch {
              /* The editor can repair an old invalid contour. */
            }
            return (
              <UnstyledButton
                key={row.id}
                className="companion-workshop-card room-card"
                onClick={() => {
                  route(row.id);
                  edit(row);
                }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600} size="sm" lineClamp={1}>
                    {row.title}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    {area}
                  </Text>
                </Group>
                <RoomPreview geometry={row.data.geometry} compact />
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {row.location || 'Ohne Etage / Lage'}
                </Text>
              </UnstyledButton>
            );
          })}
      </div>
      {!query.isPending && !rows.length && (
        <Text size="sm" c="dimmed">
          Noch keine Räume erfasst. Lege deinen ersten Grundriss an.
        </Text>
      )}
      <Editor
        photoSource={id ? { type: 'companion', id } : null}
        opened={opened}
        headerActions={
          opened ? (
            <DraftTools
              name={'room:' + (id || 'new')}
              value={form.values}
              onRestore={(values) => form.setValues(values)}
              disabled={busy}
            />
          ) : undefined
        }
        title={id ? 'Raum bearbeiten' : 'Raum anlegen'}
        size="min(1150px, calc(96vw / var(--phb-ui-zoom, 1)))"
        dirty={form.isDirty()}
        busy={busy}
        onClose={() => {
          setOpened(false);
          route(null);
        }}
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Raumname" maxLength={200} {...form.getInputProps('title')} />
            <TextInput
              label="Etage / Lage (optional)"
              maxLength={200}
              {...form.getInputProps('location')}
            />
          </SimpleGrid>
          <div className="tile-planner-grid">
            <RoomGeometryFields
              value={form.values.geometry}
              onChange={(g) => form.setFieldValue('geometry', g)}
              busy={busy}
              showPoints={showPoints}
              setShowPoints={setShowPoints}
            />
            <RoomPreview geometry={form.values.geometry} />
          </div>
          <Textarea
            label="Notizen (optional)"
            maxLength={10000}
            autosize
            minRows={2}
            {...form.getInputProps('body')}
          />
          <Text size="xs" c="dimmed">
            Grundrissmaße ohne Abzug von Fugen. Rundungen sind angenähert; innere Aussparungen sind
            noch nicht enthalten.
          </Text>
          <Group justify="space-between">
            <div>
              {id && (
                <Button
                  variant="subtle"
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => void remove()}
                >
                  Löschen
                </Button>
              )}
            </div>
            <Group gap="xs">
              {id && (
                <Button
                  variant="default"
                  disabled={form.isDirty() || busy}
                  onClick={() => navigate('/projektwerkstatt?tab=tiles&room=' + id)}
                >
                  Im Fliesenplan verwenden
                </Button>
              )}
              <Button
                loading={busy}
                disabled={!valid || !form.values.title.trim() || (!!id && !form.isDirty())}
                onClick={() => void save()}
              >
                Speichern
              </Button>
            </Group>
          </Group>
        </Stack>
      </Editor>
    </Stack>
  );
}

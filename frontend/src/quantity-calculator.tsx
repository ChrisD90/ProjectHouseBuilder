import {
  Accordion,
  ActionIcon,
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconClipboard } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, error, ErrorBox, Row, success } from './core';
import { roomGeometry } from './tile-geometry';

const format = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 3 });
export function Calculator() {
  const q = useQuery({ queryKey: ['companion'], queryFn: () => api('/api/companion') });
  const cache = useQueryClient();
  const [length, setLength] = useState<number | string>(1),
    [width, setWidth] = useState<number | string>(1),
    [height, setHeight] = useState<number | string>(1);
  const [waste, setWaste] = useState<number | string>(10),
    [pack, setPack] = useState<number | string>(1),
    [mode, setMode] = useState<string | null>('area');
  const [plan, setPlan] = useState<string | null>(null),
    [title, setTitle] = useState('Materialbedarf'),
    [busy, setBusy] = useState(false),
    [room, setRoom] = useState<string | null>(null);
  const rooms: Row[] = (q.data?.records || [])
    .filter((x: Row) => x.kind === 'room')
    .sort((a: Row, b: Row) => a.title.localeCompare(b.title, 'de'));
  const selected = rooms.find((x) => String(x.id) === room);
  let baseArea = Number(length) * Number(width),
    roomFailure = '';
  if (room) {
    try {
      if (!selected) throw Error('Raum nicht mehr verfügbar. Bitte neu auswählen.');
      const g = selected.data.geometry;
      baseArea = roomGeometry(g.width, g.height, 0, g.contour).area / 1e6;
    } catch (e) {
      baseArea = NaN;
      roomFailure = e instanceof Error ? e.message : String(e);
    }
  }
  const base = baseArea * (mode === 'volume' ? Number(height) : 1);
  const amount = base * (1 + Number(waste) / 100),
    packs = Math.ceil(amount / Number(pack)),
    unit = mode === 'volume' ? 'm³' : 'm²';
  const valid =
    !roomFailure &&
    (!!room || (length !== '' && width !== '' && Number(length) > 0 && Number(width) > 0)) &&
    (mode !== 'volume' || (height !== '' && Number(height) > 0)) &&
    waste !== '' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= 10000000 &&
    Number(waste) >= 0 &&
    Number(waste) <= 100 &&
    Number.isFinite(packs) &&
    Number(pack) >= 0.001;
  async function transfer() {
    if (!plan || !valid || !title.trim()) return;
    setBusy(true);
    try {
      const path = '/api/self-work/' + plan,
        result = await api(path);
      const materials = [
        ...result.plan.materials,
        {
          id: crypto.randomUUID(),
          title: title.trim(),
          quantity: Number(amount.toFixed(3)),
          unit,
          unit_price: null,
          status: 'Benötigt',
          notes: `${selected ? 'Raum: ' + selected.title + '. ' : ''}Berechnet mit ${waste} % Verschnitt; ${packs} Packungen à ${pack}.`,
        },
      ];
      const token = result._versions?.[path];
      await api(path, 'PATCH', { materials }, false, token ? { 'If-Match': token } : {});
      await Promise.all(
        ['self-work', 'companion-shopping'].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
      success('In Materialliste übernommen.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy} className="workshop-calculator">
      <Stack gap="sm">
        <ErrorBox value={q.error} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            size="sm"
            label="Berechnung"
            value={mode}
            onChange={setMode}
            allowDeselect={false}
            data={[
              { value: 'area', label: 'Fläche' },
              { value: 'volume', label: 'Volumen' },
            ]}
          />
          <Select
            size="sm"
            label="Gespeicherter Raum (optional)"
            searchable
            clearable
            placeholder="Eigene Maße eingeben"
            value={room}
            onChange={setRoom}
            data={rooms.map((x) => ({ value: String(x.id), label: x.title }))}
          />
        </SimpleGrid>
        {roomFailure && <Alert color="orange">{roomFailure}</Alert>}
        <SimpleGrid cols={{ base: 2, sm: mode === 'volume' ? 3 : 2 }} spacing="sm">
          {!room && (
            <>
              <NumberInput
                size="sm"
                label="Länge (m)"
                min={0}
                decimalSeparator=","
                thousandSeparator="."
                value={length}
                onChange={setLength}
              />
              <NumberInput
                size="sm"
                label="Breite (m)"
                min={0}
                decimalSeparator=","
                thousandSeparator="."
                value={width}
                onChange={setWidth}
              />
            </>
          )}
          {room && (
            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                Tatsächliche Grundrissfläche
              </Text>
              <Text size="sm" fw={600}>
                {Number.isFinite(baseArea) ? format(baseArea) + ' m²' : '—'}
              </Text>
            </Paper>
          )}
          {mode === 'volume' && (
            <NumberInput
              size="sm"
              label="Höhe / Stärke (m)"
              min={0}
              decimalSeparator=","
              thousandSeparator="."
              value={height}
              onChange={setHeight}
            />
          )}
        </SimpleGrid>
        <SimpleGrid cols={2} spacing="sm">
          <NumberInput
            size="sm"
            label="Verschnitt (%)"
            min={0}
            max={100}
            decimalSeparator=","
            value={waste}
            onChange={setWaste}
          />
          <NumberInput
            size="sm"
            label={`Packungsinhalt (${unit})`}
            min={0.001}
            decimalSeparator=","
            thousandSeparator="."
            value={pack}
            onChange={setPack}
          />
        </SimpleGrid>
        <Paper withBorder p="sm">
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="xs" c="dimmed">
                Bedarf inklusive Verschnitt
              </Text>
              <Text fw={650}>
                {valid
                  ? `${format(amount)} ${unit} · ${format(packs)} Packungen`
                  : 'Maße vervollständigen'}
              </Text>
            </div>
            <Tooltip label="Ergebnis kopieren">
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Ergebnis kopieren"
                disabled={!valid}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${format(amount)} ${unit} · ${format(packs)} Packungen`,
                    );
                    success('In Zwischenablage kopiert.');
                  } catch (e) {
                    error(e);
                  }
                }}
              >
                <IconClipboard size={17} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Paper>
        <Accordion variant="contained">
          <Accordion.Item value="transfer">
            <Accordion.Control>In eine Materialliste übernehmen</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <TextInput
                  size="sm"
                  label="Materialbezeichnung"
                  value={title}
                  onChange={(e) => setTitle(e.currentTarget.value)}
                />
                <Select
                  size="sm"
                  label="Eigenleistung"
                  searchable
                  clearable
                  value={plan}
                  onChange={setPlan}
                  data={(q.data?.references.self_work || []).map((x: Row) => ({
                    value: String(x.id),
                    label: x.title,
                  }))}
                />
                <Group justify="flex-end">
                  <Button
                    size="sm"
                    disabled={!plan || !valid || !title.trim()}
                    loading={busy}
                    onClick={() => void transfer()}
                  >
                    Übernehmen
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </fieldset>
  );
}

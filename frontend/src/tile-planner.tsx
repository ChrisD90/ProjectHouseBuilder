import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconDownload, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react';
import { useForm } from '@mantine/form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, error, ErrorBox, Row, success, useConfirm } from './core';
import { useDirtyGuard } from './shell';
import { defaultTiles, tileLayout, TileSettings } from './tile-layout';
import './tile-planner.css';

const number = (n: number, digits = 1) =>
  n.toLocaleString('de-DE', { maximumFractionDigits: digits });
const mm = (n: number) => number(n, 3) + ' mm';
const initial = () => ({ title: 'Fliesenplan', settings: { ...defaultTiles } });

// Keep intermediate input such as "3," while converting cm to internal mm.
function Measurement({
  value,
  scale,
  label,
  max,
  disabled,
  onChange,
}: {
  value: number;
  scale: number;
  label: string;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [raw, setRaw] = useState<number | string>(Number.isFinite(value) ? value / scale : '');
  useEffect(() => {
    setRaw(Number.isFinite(value) ? value / scale : '');
  }, [value, scale]);
  return (
    <NumberInput
      label={label}
      value={raw}
      min={0}
      max={max}
      decimalScale={3}
      decimalSeparator=","
      hideControls
      disabled={disabled}
      onChange={(v) => {
        setRaw(v);
        onChange(v === '' ? NaN : Number(v) * scale);
      }}
    />
  );
}

export function TilePlanner() {
  const query = useQuery({ queryKey: ['companion'], queryFn: () => api('/api/companion') });
  const cache = useQueryClient(),
    ask = useConfirm();
  const form = useForm({ initialValues: initial() });
  const [id, setId] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  const [active, setActive] = useState('');
  const [params, setParams] = useSearchParams();
  const opened = useRef('');
  const version = useRef('');
  const svg = useRef<SVGSVGElement>(null);
  useDirtyGuard(form.isDirty());
  const rows: Row[] = (query.data?.records || []).filter((x: Row) => x.kind === 'tile_plan');
  const s = form.values.settings;
  const { plan, failure } = useMemo(() => {
    try {
      return { plan: tileLayout(s), failure: '' };
    } catch (e) {
      return { plan: null, failure: e instanceof Error ? e.message : String(e) };
    }
  }, [s]);
  const selected = plan?.pieces.find((x) => x.id === active);
  function route(ident: number | null) {
    const next = new URLSearchParams(params);
    if (ident) next.set('record', String(ident));
    else next.delete('record');
    opened.current = ident ? String(ident) : '';
    setParams(next, { replace: true });
  }
  function load(row?: Row) {
    const values = row
      ? { title: row.title, settings: { ...defaultTiles, ...row.data.settings } as TileSettings }
      : initial();
    form.setValues(values);
    form.resetDirty(values);
    setId(row?.id || null);
    setActive('');
    version.current = row ? query.data?._versions?.['/api/companion/records/' + row.id] || '' : '';
  }
  useEffect(() => {
    const target = params.get('record');
    if (!target || opened.current === target || !query.data) return;
    const row = rows.find((x) => String(x.id) === target);
    opened.current = target;
    if (row && !form.isDirty()) load(row);
  }, [params.get('record'), query.dataUpdatedAt]);
  async function choose(value: string | null) {
    if (form.isDirty() && !(await ask('Ungespeicherte Änderungen am Fliesenplan verwerfen?')))
      return;
    const row = rows.find((x) => String(x.id) === value);
    load(row);
    route(row?.id || null);
  }
  async function save() {
    if (!plan || !form.values.title.trim()) return;
    setBusy(true);
    try {
      const result = await api(
        '/api/companion/records' + (id ? '/' + id : ''),
        id ? 'PATCH' : 'POST',
        {
          kind: 'tile_plan',
          title: form.values.title.trim(),
          status: 'Offen',
          data: { settings: s, document_ids: [] },
        },
        false,
        version.current ? { 'If-Match': version.current } : {},
      );
      version.current = result._versions?.['/api/companion/records/' + result.record.id] || '';
      form.resetDirty();
      setId(result.record.id);
      route(result.record.id);
      await cache.invalidateQueries({ queryKey: ['companion'] });
      success('Fliesenplan gespeichert.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!id || !(await ask('Diesen gespeicherten Fliesenplan endgültig löschen?'))) return;
    setBusy(true);
    try {
      await api(
        '/api/companion/records/' + id,
        'DELETE',
        undefined,
        false,
        version.current ? { 'If-Match': version.current } : {},
      );
      load();
      route(null);
      await cache.invalidateQueries({ queryKey: ['companion'] });
      success('Fliesenplan gelöscht.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  function exportPlan(print: boolean) {
    if (!svg.current || !plan) return;
    // React renders all user input as text. Export the SVG with explicit colors,
    // independent of the application's theme, with no external resources.
    const copy = svg.current.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute('class');
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', '100%');
    copy.setAttribute('height', 'auto');
    copy.querySelectorAll('.tile-selected').forEach((x) => x.removeAttribute('stroke'));
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = form.values.title;
    copy.prepend(title);
    if (!print) {
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Fliesenplan.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    const win = window.open('', '_blank');
    if (!win) {
      error(Error('Bitte Pop-ups für die Druckansicht erlauben.'));
      return;
    }
    win.opener = null;
    const doc = win.document;
    doc.title = form.values.title;
    const style = doc.createElement('style');
    style.textContent =
      'body{font:14px system-ui;color:#172b22;margin:24px}svg{display:block;max-height:65vh;margin:12px auto}table{border-collapse:collapse;width:100%;margin-top:16px}td,th{padding:6px;border-bottom:1px solid #ccc;text-align:left}tr{break-inside:avoid}button{padding:8px 16px}@media print{button{display:none}svg{max-height:150mm}@page{margin:12mm}}';
    doc.head.append(style);
    const append = (tag: string, text: string) => {
      const el = doc.createElement(tag);
      el.textContent = text;
      doc.body.append(el);
      return el;
    };
    const button = append('button', 'Drucken / als PDF speichern');
    button.onclick = () => win.print();
    append('h1', form.values.title);
    append(
      'p',
      `Raum ${mm(s.width)} × ${mm(s.height)} · Fliese ${mm(plan.tileWidth)} × ${mm(plan.tileHeight)} · Fuge ${mm(s.joint)} · Rand ${mm(s.edge)} · ${s.pattern === 'half' ? 'Halbverband' : 'Gerade Verlegung'}`,
    );
    append(
      'p',
      `Start: ${s.start === 'center' ? 'Mittig, Randstücke ausgeglichen' : s.start === 'corner' ? 'Oben links' : `Versatz ${mm(s.offsetX)} / ${mm(s.offsetY)}`}. Oben links = Bezugsecke. Alle Maße in mm.`,
    );
    doc.body.append(doc.importNode(copy, true));
    append(
      'p',
      `${plan.full} ganze Fliesen · ${plan.cut} Zuschnitte · Einkauf: ca. ${plan.purchase} Fliesen inkl. ${s.reserve}% Reserve. Grün = ganz, schraffiert = Zuschnitt.`,
    );
    const table = doc.createElement('table');
    for (const cells of [
      ['Zuschnitt Breite × Höhe', 'Stück'],
      ...plan.cuts.map((c) => [`${mm(c.width)} × ${mm(c.height)}`, String(c.count)]),
    ]) {
      const tr = doc.createElement('tr');
      for (const text of cells) {
        const td = doc.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      table.append(tr);
    }
    doc.body.append(table);
    append(
      'p',
      'Orientierungshilfe für rechteckige Räume ohne Aussparungen. Bestellschätzung: eine neue Fliese je Feld, keine Wiederverwendung von Reststücken. Maße und Untergrund vor Ort prüfen; Bewegungsfugen und Hersteller-Vorgaben gesondert planen.',
    );
    doc.close();
  }
  function dimension(
    key: keyof Pick<
      TileSettings,
      | 'width'
      | 'height'
      | 'tileWidth'
      | 'tileHeight'
      | 'joint'
      | 'edge'
      | 'reserve'
      | 'offsetX'
      | 'offsetY'
    >,
    label: string,
    scale = 1,
    max = 10000,
  ) {
    return (
      <Measurement
        label={label}
        value={s[key]}
        scale={scale}
        max={max}
        disabled={busy}
        onChange={(v) => form.setFieldValue(`settings.${key}`, v)}
      />
    );
  }
  const margin = Math.max(s.width, s.height) * 0.065;
  return (
    <Stack className="tile-planner">
      <Group justify="space-between" align="end">
        <div>
          <Title order={3}>Fliesen-Verlegeplan</Title>
          <Text size="sm" c="dimmed">
            Raum aufnehmen, Raster ausrichten und Zuschnitte prüfen.
          </Text>
        </div>
        <Group gap="xs">
          <Select
            aria-label="Gespeicherten Fliesenplan öffnen"
            placeholder="Gespeicherte Pläne"
            w={230}
            searchable
            clearable
            data={rows.map((x) => ({ value: String(x.id), label: x.title }))}
            value={id ? String(id) : null}
            disabled={busy || query.isPending}
            onChange={(v) => void choose(v)}
          />
          <Button
            variant="default"
            leftSection={<IconPlus size={16} />}
            disabled={busy}
            onClick={() => void choose(null)}
          >
            Neuer Plan
          </Button>
        </Group>
      </Group>
      <ErrorBox value={query.error} />
      <div className="tile-planner-grid">
        <fieldset disabled={busy} className="tile-settings">
          <Stack gap="sm">
            <TextInput label="Plan / Raum" maxLength={200} {...form.getInputProps('title')} />
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  1. Raum
                </Text>
                <SimpleGrid cols={2}>
                  {dimension('width', 'Breite (cm)', 10)}
                  {dimension('height', 'Tiefe (cm)', 10)}
                </SimpleGrid>
                {dimension('edge', 'Randabstand je Wand (mm)', 1, 100)}
              </Stack>
            </Paper>
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  2. Fliesen & Fugen
                </Text>
                <SimpleGrid cols={2}>
                  {dimension('tileWidth', 'Fliesenbreite (cm)', 10, 500)}
                  {dimension('tileHeight', 'Fliesenlänge (cm)', 10, 500)}
                </SimpleGrid>
                <SimpleGrid cols={2}>
                  {dimension('joint', 'Fugenbreite (mm)', 1, 30)}
                  {dimension('reserve', 'Reserve (%)', 1, 100)}
                </SimpleGrid>
                <Checkbox
                  label="Fliesen um 90° drehen"
                  {...form.getInputProps('settings.rotated', { type: 'checkbox' })}
                />
              </Stack>
            </Paper>
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <Text fw={600} size="sm">
                  3. Verlegung
                </Text>
                <Select
                  label="Muster"
                  data={[
                    { value: 'straight', label: 'Gerade Verlegung' },
                    { value: 'half', label: 'Halbverband (½ Versatz)' },
                  ]}
                  allowDeselect={false}
                  {...form.getInputProps('settings.pattern')}
                />
                <Select
                  label="Startpunkt"
                  data={[
                    { value: 'center', label: 'Mittig · ausgewogene Randstücke' },
                    { value: 'corner', label: 'Ganze Fliese oben links' },
                    { value: 'offset', label: 'Eigener Rasterversatz' },
                  ]}
                  allowDeselect={false}
                  {...form.getInputProps('settings.start')}
                />
                {s.start === 'offset' && (
                  <SimpleGrid cols={2}>
                    {dimension('offsetX', 'Versatz nach rechts (mm)')}
                    {dimension('offsetY', 'Versatz nach unten (mm)')}
                  </SimpleGrid>
                )}
                <Text size="xs" c="dimmed">
                  Oben links ist die Bezugsecke. Positiver Versatz verschiebt das ganze Raster; an
                  der Wand entstehen dabei Zuschnitte.
                </Text>
              </Stack>
            </Paper>
          </Stack>
        </fieldset>
        <Stack gap="sm" className="tile-preview-column">
          {failure ? (
            <Alert color="orange">{failure}</Alert>
          ) : (
            plan && (
              <>
                <Paper withBorder p="sm" className="tile-preview">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      Verlegeplan · Draufsicht
                    </Text>
                    <Group gap="xs">
                      <Badge color="green" variant="light">
                        Ganze Fliese
                      </Badge>
                      <Badge color="orange" variant="light">
                        Zuschnitt
                      </Badge>
                    </Group>
                  </Group>
                  <svg
                    ref={svg}
                    viewBox={`${-margin} ${-margin} ${s.width + 2 * margin} ${s.height + 2 * margin}`}
                    className="tile-plan-svg"
                    role="img"
                    aria-label="Maßstäblicher Fliesenplan, oben links ist die Bezugsecke"
                  >
                    <defs>
                      <pattern
                        id="tile-cut-hatch"
                        patternUnits="userSpaceOnUse"
                        width={Math.max(8, margin / 6)}
                        height={Math.max(8, margin / 6)}
                        patternTransform="rotate(45)"
                      >
                        <rect width="100%" height="100%" fill="#f5e1be" />
                        <line
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="100%"
                          stroke="#bd8a47"
                          strokeWidth={Math.max(1, margin / 100)}
                        />
                      </pattern>
                    </defs>
                    <rect
                      x="0"
                      y="0"
                      width={s.width}
                      height={s.height}
                      fill="#ced6d0"
                      stroke="#51685b"
                      strokeWidth={margin / 50}
                    />
                    {plan.pieces.map((p) => (
                      <rect
                        key={p.id}
                        x={p.x}
                        y={p.y}
                        width={p.width}
                        height={p.height}
                        fill={p.cut ? 'url(#tile-cut-hatch)' : '#c2d7ae'}
                        stroke={active === p.id ? '#1b5533' : '#73846f'}
                        strokeWidth={active === p.id ? margin / 20 : margin / 180}
                        className={active === p.id ? 'tile-selected' : ''}
                        onClick={() => setActive(p.id)}
                      >
                        <title>{`Reihe ${p.row}, Feld ${p.column}: ${mm(p.width)} × ${mm(p.height)}${p.cut ? ' (Zuschnitt)' : ''}`}</title>
                      </rect>
                    ))}
                    <text
                      x={s.width / 2}
                      y={-margin * 0.3}
                      textAnchor="middle"
                      fill="#355344"
                      fontSize={margin * 0.3}
                    >
                      {mm(s.width)}
                    </text>
                    <text
                      transform={`translate(${-margin * 0.3},${s.height / 2}) rotate(-90)`}
                      textAnchor="middle"
                      fill="#355344"
                      fontSize={margin * 0.3}
                    >
                      {mm(s.height)}
                    </text>
                  </svg>
                  <Text size="xs" c="dimmed" className="tile-selection" aria-live="polite">
                    {selected
                      ? `Reihe ${selected.row} · Feld ${selected.column}: ${mm(selected.width)} × ${mm(selected.height)}${selected.cut ? ' · Zuschnitt' : ' · Ganze Fliese'}`
                      : 'Ein Feld anklicken, um dessen Zuschnittmaße zu sehen. Alle Planmaße in mm.'}
                  </Text>
                </Paper>
                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <Paper withBorder p="sm">
                    <Text size="xs" c="dimmed">
                      Belegbare Fläche
                    </Text>
                    <Text fw={600}>{number(plan.area, 2)} m²</Text>
                  </Paper>
                  <Paper withBorder p="sm">
                    <Text size="xs" c="dimmed">
                      Verlegung
                    </Text>
                    <Text fw={600}>
                      {plan.full} ganz · {plan.cut} Zuschnitte
                    </Text>
                  </Paper>
                  <Paper withBorder p="sm">
                    <Text size="xs" c="dimmed">
                      Einkauf inkl. {s.reserve}% Reserve
                    </Text>
                    <Text fw={600}>ca. {plan.purchase} Fliesen</Text>
                  </Paper>
                </SimpleGrid>
                {!!plan.narrow && (
                  <Alert color="orange" variant="light">
                    {plan.narrow} schmale Randstücke unter einem Drittel des Fliesenmaßes. Prüfe
                    Drehung oder Rasterversatz.
                  </Alert>
                )}
                <details className="tile-cut-list">
                  <summary>Zuschnittliste ({plan.cut} Stück)</summary>
                  {plan.cut ? (
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Breite × Höhe (mm)</Table.Th>
                          <Table.Th>Stück</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {plan.cuts.map((c) => (
                          <Table.Tr key={`${c.width}-${c.height}`}>
                            <Table.Td>
                              {number(c.width, 3)} × {number(c.height, 3)}
                            </Table.Td>
                            <Table.Td>{c.count}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  ) : (
                    <Text size="sm">Keine Zuschnitte erforderlich.</Text>
                  )}
                </details>
              </>
            )
          )}
        </Stack>
      </div>
      <Text size="xs" c="dimmed">
        Erste Version für rechteckige Räume ohne Aussparungen. Die Bestellschätzung rechnet mit
        einer neuen Fliese je Feld, ohne Wiederverwendung von Reststücken. Maße vor Ort prüfen;
        Bewegungsfugen, Untergrund und zulässigen Verband nach Herstellerangaben gesondert planen.
      </Text>
      <Group justify="space-between" className="tile-footer">
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconPrinter size={16} />}
            disabled={!plan || busy}
            onClick={() => exportPlan(true)}
          >
            Drucken / PDF
          </Button>
          <Button
            variant="subtle"
            leftSection={<IconDownload size={16} />}
            disabled={!plan || busy}
            onClick={() => exportPlan(false)}
          >
            SVG
          </Button>
        </Group>
        <Group gap="xs">
          {id && (
            <Button
              color="red"
              variant="subtle"
              leftSection={<IconTrash size={16} />}
              disabled={busy}
              onClick={() => void remove()}
            >
              Löschen
            </Button>
          )}
          <Button
            loading={busy}
            disabled={!plan || !form.values.title.trim() || (!form.isDirty() && !!id)}
            onClick={() => void save()}
          >
            Speichern
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}

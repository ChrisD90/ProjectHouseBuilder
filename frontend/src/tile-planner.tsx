import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
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
import { useElementSize } from '@mantine/hooks';
import { useSearchParams } from 'react-router-dom';
import { api, error, ErrorBox, Row, success, useConfirm } from './core';
import { useDirtyGuard } from './shell';
import { defaultTiles, tileLayout, TileSettings, TilePiece } from './tile-layout';
import { svgPath, labelPoint, roomEdgeLabels } from './tile-geometry';
import './tile-planner.css';
import { Measurement, RoomGeometryFields, roomGeometryOnly } from './room-geometry-fields';
import { TileHeading, TileInfo } from './tile-info';
import { TileProducts, TileProduct } from './tile-products';

const number = (n: number, digits = 1) =>
  n.toLocaleString('de-DE', { maximumFractionDigits: digits });
const mm = (n: number) => number(n, 3) + ' mm';
const cutCoordinates = (p: TilePiece) =>
  p.paths
    .map((path) => path.map((q) => `${number(q.x - p.x, 3)}/${number(q.y - p.y, 3)}`).join(' → '))
    .join(' | ');
const initial = () => ({
  title: 'Fliesenplan',
  settings: { ...defaultTiles },
  roomId: null as number | null,
  roomTitle: '',
  products: [] as TileProduct[],
  documentIds: [] as number[],
});

export function TilePlanner() {
  const query = useQuery({ queryKey: ['companion'], queryFn: () => api('/api/companion') });
  const cache = useQueryClient(),
    ask = useConfirm();
  const form = useForm({ initialValues: initial() });
  const [id, setId] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  const [active, setActive] = useState('');
  const [highlightedEdge, setHighlightedEdge] = useState('');
  const [showPoints, setShowPoints] = useState(false);
  const [cutsOpen, setCutsOpen] = useState(false),
    [productsOpen, setProductsOpen] = useState(false);
  const { ref: settingsRef, height: settingsHeight } = useElementSize<HTMLFieldSetElement>();
  const [roomChoice, setRoomChoice] = useState('');
  const importedRoom = useRef('');
  const [params, setParams] = useSearchParams();
  const opened = useRef('');
  const version = useRef('');
  const svg = useRef<SVGSVGElement>(null);
  useDirtyGuard(form.isDirty());
  const rows: Row[] = (query.data?.records || []).filter((x: Row) => x.kind === 'tile_plan');
  const rooms: Row[] = (query.data?.records || [])
    .filter((x: Row) => x.kind === 'room')
    .sort((a: Row, b: Row) => a.title.localeCompare(b.title, 'de'));
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
    next.delete('room');
    opened.current = ident ? String(ident) : '';
    setParams(next, { replace: true });
  }
  function load(row?: Row) {
    const values = row
      ? {
          title: row.title,
          settings: { ...defaultTiles, ...row.data.settings } as TileSettings,
          roomId: row.data.room_id || null,
          roomTitle: row.data.room_title || '',
          products: row.data.tile_products || [],
          documentIds: (row.data.document_ids || []).filter(
            (ident: number) =>
              !(row.data.tile_products || []).some(
                (product: TileProduct) => product.image_document_id === ident,
              ),
          ),
        }
      : initial();
    form.setValues(values);
    form.resetDirty(values);
    setId(row?.id || null);
    setActive('');
    setRoomChoice(row?.data.room_id ? String(row.data.room_id) : '');
    version.current = row ? query.data?._versions?.['/api/companion/records/' + row.id] || '' : '';
  }
  useEffect(() => {
    const target = params.get('record');
    if (!target || opened.current === target || !query.data) return;
    const row = rows.find((x) => String(x.id) === target);
    opened.current = target;
    if (row && !form.isDirty()) load(row);
  }, [params.get('record'), query.dataUpdatedAt]);
  function takeRoom(room: Row, newPlan = false) {
    form.setValues({
      ...form.values,
      ...(newPlan ? { title: (room.title + ' · Fliesen').slice(0, 200) } : {}),
      settings: { ...form.values.settings, ...roomGeometryOnly(room.data.geometry) },
      roomId: room.id,
      roomTitle: room.title,
    });
    setRoomChoice(String(room.id));
    setActive('');
    setHighlightedEdge('');
    setShowPoints(false);
  }
  useEffect(() => {
    const target = params.get('room');
    if (
      !target ||
      params.get('record') ||
      importedRoom.current === target ||
      !query.data ||
      form.isDirty()
    )
      return;
    const room = rooms.find((x) => String(x.id) === target);
    if (room) {
      importedRoom.current = target;
      takeRoom(room, true);
    }
  }, [params.get('room'), query.dataUpdatedAt]);
  async function importRoom() {
    const room = rooms.find((x) => String(x.id) === roomChoice);
    if (!room) return;
    if (
      form.isDirty() &&
      !(await ask(
        'Aktuelle Raumkontur durch den gespeicherten Grundriss ersetzen? Fliesenformat und Verlegung bleiben erhalten.',
      ))
    )
      return;
    takeRoom(room);
  }
  async function storeRoom() {
    if (!plan) return;
    const title = await ask({
      title: 'Grundriss als Raum speichern',
      message: 'Wie soll der Raum heißen?',
      initial: form.values.roomTitle || form.values.title,
      confirmLabel: 'Raum speichern',
    });
    if (typeof title !== 'string' || !title.trim()) return;
    setBusy(true);
    try {
      const result = await api('/api/companion/records', 'POST', {
        kind: 'room',
        title: title.trim(),
        data: { geometry: roomGeometryOnly(s), document_ids: [] },
      });
      form.setValues({ ...form.values, roomId: result.record.id, roomTitle: result.record.title });
      setRoomChoice(String(result.record.id));
      await cache.invalidateQueries({ queryKey: ['companion'] });
      success('Grundriss als Raum gespeichert.');
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
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
          data: {
            settings: s,
            document_ids: [
              ...new Set([
                ...form.values.documentIds,
                ...form.values.products.flatMap((product) =>
                  product.image_document_id ? [product.image_document_id] : [],
                ),
              ]),
            ],
            tile_products: form.values.products,
            room_id: form.values.roomId,
            room_title: form.values.roomTitle,
          },
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
  async function uploadProductImage(ident: string, file: File) {
    setBusy(true);
    try {
      const data = new FormData();
      data.set('file', file);
      data.set('title', file.name);
      data.set('category', 'Sonstiges');
      const result = await api('/api/project-documents', 'POST', data);
      form.setFieldValue(
        'products',
        form.values.products.map((product) =>
          product.id === ident ? { ...product, image_document_id: result.document.id } : product,
        ),
      );
      await cache.invalidateQueries({ queryKey: ['companion-documents'] });
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
    if (!svg.current || !plan || !walls) return;
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
      const box = walls.viewBox,
        columns = 3;
      const font = Math.min(walls.fontSize, box.width / (columns * 14)),
        line = font * 1.8;
      const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const heading = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      heading.setAttribute('x', String(box.left + font));
      heading.setAttribute('y', String(box.top + box.height + line));
      heading.setAttribute('font-size', String(font));
      heading.setAttribute('fill', '#355344');
      heading.textContent = 'Raumkanten (vor Randabstand)';
      legend.append(heading);
      walls.edges.forEach((edge, i) => {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(box.left + font + ((i % columns) * box.width) / columns));
        text.setAttribute('y', String(box.top + box.height + line * (Math.floor(i / columns) + 2)));
        text.setAttribute('font-size', String(font));
        text.setAttribute('fill', '#355344');
        text.textContent = `${edge.id}: ${mm(edge.length)}`;
        legend.append(text);
      });
      copy.append(legend);
      copy.setAttribute(
        'viewBox',
        `${box.left} ${box.top} ${box.width} ${box.height + line * (Math.ceil(walls.edges.length / columns) + 3)}`,
      );
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
      `${s.contour ? 'Raumkontur, Planrahmen' : 'Raum'} ${mm(s.width)} × ${mm(s.height)} · Fliese ${mm(plan.tileWidth)} × ${mm(plan.tileHeight)} · Fuge ${mm(s.joint)} · Rand ${mm(s.edge)} · ${s.pattern === 'half' ? 'Halbverband' : 'Gerade Verlegung'}`,
    );
    append(
      'p',
      `Start: ${s.start === 'center' ? 'Mittig am umschließenden Rechteck' : s.start === 'corner' ? 'Oben links' : `Versatz ${mm(s.offsetX)} / ${mm(s.offsetY)}`}. Rasterbezug: links oben am umschließenden Rechteck der belegbaren Fläche. Alle Maße in mm.`,
    );
    doc.body.append(doc.importNode(copy, true));
    append('h2', 'Raumkanten');
    append(
      'p',
      'Längen der ursprünglichen Raumkontur, vor Abzug des Randabstands. Bei Rundungen sind dies die geraden Teilstücke der angenäherten Kontur.',
    );
    const edgeTable = doc.createElement('table');
    for (const cells of [
      ['Kante', 'Eckpunkte', 'Länge'],
      ...walls.edges.map((edge) => [edge.id, `P${edge.from} – P${edge.to}`, mm(edge.length)]),
    ]) {
      const tr = doc.createElement('tr');
      for (const text of cells) {
        const td = doc.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      edgeTable.append(tr);
    }
    doc.body.append(edgeTable);
    append(
      'p',
      `${plan.full} ganze Fliesen · ${plan.cut} Zuschnitte · Einkauf: ca. ${plan.purchase} Fliesen inkl. ${s.reserve}% Reserve. Grün = ganz, schraffiert = Zuschnitt.`,
    );
    const table = doc.createElement('table');
    for (const cells of [
      ['Zuschnitt Breite × Höhe', 'Stück'],
      ...plan.cuts.map((c) => [
        `${mm(c.width)} × ${mm(c.height)}${c.shaped ? ' · Kontur, Außenmaße · Felder ' + c.fields.join(', ') + ' · Schnittpunkte X/Y (mm ab linker oberer Zuschnittkante): ' + cutCoordinates(plan.pieces.find((p) => p.id === c.fields[0])!) : ''}`,
        String(c.count),
      ]),
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
      'Orientierungshilfe. Konturzuschnitte: Außenmaße und Rasterfeld-ID beachten; Schnittverlauf siehe Plan. Rundungen sind angenähert. Bestellschätzung: eine neue Fliese je Feld, keine Wiederverwendung von Reststücken. Maße und Untergrund vor Ort prüfen; Bewegungsfugen und Hersteller-Vorgaben gesondert planen.',
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
  const walls = plan ? roomEdgeLabels(plan.room, s.width, s.height, margin) : null;
  return (
    <Stack className="tile-planner">
      <Group justify="space-between" align="end">
        <TileHeading
          large
          title="Fliesen-Verlegeplan"
          info="Raum aufnehmen, Raster ausrichten und Zuschnitte prüfen. Konturzuschnitte zeigen Außenmaße; den Schnittverlauf siehst du im Plan. Rundungen werden durch 48 Kanten angenähert, innere Aussparungen sind noch nicht enthalten. Maße vor Ort prüfen; Bewegungsfugen, Untergrund und zulässigen Verband nach Herstellerangaben gesondert planen."
        />
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
      <div
        className="tile-planner-grid tile-planner-bounded"
        style={
          {
            '--tile-panel-height': settingsHeight ? `${settingsHeight}px` : undefined,
          } as React.CSSProperties
        }
      >
        <fieldset ref={settingsRef} disabled={busy} className="tile-settings">
          <Stack gap="sm">
            <TextInput label="Plan / Raum" maxLength={200} {...form.getInputProps('title')} />
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <TileHeading
                  title="1. Raum"
                  info="Gespeicherte Grundrisse werden als Kopie übernommen. Spätere Änderungen am Raum verändern diesen Verlegeplan erst, wenn du den Grundriss erneut übernimmst. Außenmaße skalieren die Kontur. Eckpunkte der Reihe nach um den Raum herum eingeben: X nach rechts, Y nach unten. Der letzte Punkt wird automatisch mit dem ersten verbunden. Der Randabstand wird an jeder Wand abgezogen."
                />
                <Select
                  label="Gespeicherten Raum verwenden"
                  placeholder="Raum auswählen"
                  searchable
                  clearable
                  value={roomChoice || null}
                  data={rooms.map((room) => ({
                    value: String(room.id),
                    label: room.title + (room.location ? ' · ' + room.location : ''),
                  }))}
                  onChange={(v) => setRoomChoice(v || '')}
                  disabled={busy || query.isPending}
                />
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={!roomChoice || busy}
                    onClick={() => void importRoom()}
                  >
                    Grundriss übernehmen
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={!plan || busy}
                    onClick={() => void storeRoom()}
                  >
                    Als Raum speichern
                  </Button>
                </Group>
                {form.values.roomTitle && (
                  <Text size="xs" c="dimmed">
                    Übernommen aus: {form.values.roomTitle}
                  </Text>
                )}
                <RoomGeometryFields
                  value={s}
                  onChange={(geometry) => form.setFieldValue('settings', { ...s, ...geometry })}
                  busy={busy}
                  showPoints={showPoints}
                  setShowPoints={setShowPoints}
                  hideHints
                />
                {dimension('edge', 'Randabstand je Wand (mm)', 1, 100)}
              </Stack>
            </Paper>
            <Paper withBorder p="sm">
              <Stack gap="xs">
                <TileHeading
                  title="2. Fliesen & Fugen"
                  info="Fliesenmaße in Zentimetern, Fugen und Randabstand in Millimetern eingeben. Die Einkaufsmenge zählt eine neue Fliese je belegtem Rasterfeld plus Reserve. Reststücke werden nicht automatisch wiederverwendet. Die Variantenpreise beziehen sich auf diese Einkaufsmenge."
                />
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
                <TileHeading
                  title="3. Verlegung"
                  warning={!!plan?.narrow}
                  info={`Links oben am umschließenden Rechteck der belegbaren Fläche ist der Rasterbezug. Positiver Versatz verschiebt das ganze Raster; an der Wand entstehen dabei Zuschnitte.${plan?.narrow ? '\n\n' + plan.narrow + ' schmale Randstücke unter einem Drittel des Fliesenmaßes. Prüfe Drehung oder Rasterversatz.' : ''}`}
                />
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
                    {
                      value: 'center',
                      label: s.contour
                        ? 'Mittig · umschließendes Rechteck'
                        : 'Mittig · ausgewogene Randstücke',
                    },
                    {
                      value: 'corner',
                      label: s.contour ? 'Raster ab links oben' : 'Ganze Fliese oben links',
                    },
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
              </Stack>
            </Paper>
          </Stack>
        </fieldset>
        <Stack gap="sm" className="tile-preview-column">
          {failure ? (
            <Alert color="orange">{failure}</Alert>
          ) : (
            plan &&
            walls && (
              <>
                <Paper withBorder p="sm" className="tile-preview">
                  <TileHeading
                    title="Verlegeplan · Draufsicht"
                    info="Ein Feld anklicken, um dessen Zuschnittmaße zu sehen. Alle Planmaße sind in Millimetern. Grün steht für ganze Fliesen; Schraffur markiert Zuschnitte. Bei Konturzuschnitten sind die Maße Außenmaße; Schnittpunkte beziehen sich auf die linke obere Zuschnittkante."
                  />
                  <Group justify="flex-end" gap="xs">
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
                    viewBox={`${walls.viewBox.left} ${walls.viewBox.top} ${walls.viewBox.width} ${walls.viewBox.height}`}
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
                    <path
                      d={svgPath([plan.room])}
                      fill="#ced6d0"
                      stroke="#51685b"
                      strokeWidth={margin / 50}
                    />
                    {plan.pieces.map((p) => (
                      <path
                        key={p.id}
                        d={svgPath(p.paths)}
                        fill={p.cut ? 'url(#tile-cut-hatch)' : '#c2d7ae'}
                        stroke={active === p.id ? '#1b5533' : '#73846f'}
                        strokeWidth={active === p.id ? margin / 20 : margin / 180}
                        className={active === p.id ? 'tile-selected' : ''}
                        onClick={() => setActive(p.id)}
                      >
                        <title>{`Reihe ${p.row}, Feld ${p.column}: ${mm(p.width)} × ${mm(p.height)}${p.shaped ? ' (Konturzuschnitt, Außenmaße)' : p.cut ? ' (Zuschnitt)' : ''}`}</title>
                      </path>
                    ))}
                    {plan.pieces
                      .filter((p) => plan.pieces.length <= 200 || p.shaped)
                      .map((p) => {
                        const label = labelPoint(p.paths);
                        return (
                          <text
                            key={'label' + p.id}
                            x={label.x}
                            y={label.y}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="#355344"
                            fontSize={Math.min(margin * 0.18, label.width * 0.16, p.height * 0.22)}
                            pointerEvents="none"
                          >
                            {p.id}
                          </text>
                        );
                      })}
                    {showPoints &&
                      plan.room.length <= 16 &&
                      plan.room.map((p, i) => (
                        <g key={'point' + i} pointerEvents="none">
                          <circle cx={p.x} cy={p.y} r={margin * 0.05} fill="#1b5533" />
                          <text
                            x={p.x + margin * 0.07}
                            y={p.y - margin * 0.06}
                            fill="#173e29"
                            fontSize={margin * 0.22}
                            fontWeight="bold"
                          >
                            P{i + 1}
                          </text>
                        </g>
                      ))}
                    {walls.edges.map((edge) => (
                      <g key={edge.id} pointerEvents="none">
                        {highlightedEdge === edge.id && (
                          <line
                            x1={edge.a.x}
                            y1={edge.a.y}
                            x2={edge.b.x}
                            y2={edge.b.y}
                            stroke="#1b5533"
                            strokeWidth="4"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        <line
                          x1={edge.middle.x}
                          y1={edge.middle.y}
                          x2={edge.label.x}
                          y2={edge.label.y}
                          stroke={highlightedEdge === edge.id ? '#1b5533' : '#7b8e82'}
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          cx={edge.label.x}
                          cy={edge.label.y}
                          r={walls.fontSize * 1.12}
                          fill={highlightedEdge === edge.id ? '#1b5533' : '#f4f6f1'}
                          stroke="#51685b"
                          strokeWidth="1"
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={edge.label.x}
                          y={edge.label.y}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={highlightedEdge === edge.id ? '#ffffff' : '#355344'}
                          fontSize={walls.fontSize}
                          fontWeight="600"
                        >
                          {edge.id}
                          <title>{`Kante ${edge.id}: ${mm(edge.length)} (P${edge.from}–P${edge.to})`}</title>
                        </text>
                      </g>
                    ))}
                  </svg>
                  <TileHeading
                    title="Raumkanten"
                    info="Längen vor Abzug des Randabstands. Eine Kante in der Legende anklicken, um sie im Plan hervorzuheben. Bei Rundungen entspricht jede Kante einem geraden Teilstück der angenäherten Kontur."
                  />
                  <div className="tile-edge-legend" role="group" aria-label="Raumkanten und Längen">
                    {walls.edges.map((edge) => (
                      <button
                        key={edge.id}
                        type="button"
                        aria-pressed={highlightedEdge === edge.id}
                        className="tile-edge-item"
                        onClick={() => setHighlightedEdge(edge.id)}
                      >
                        <strong>{edge.id}</strong>
                        <span>{mm(edge.length)}</span>
                        <small>
                          P{edge.from}–P{edge.to}
                        </small>
                      </button>
                    ))}
                  </div>
                  <Text size="xs" c="dimmed" className="tile-selection" aria-live="polite">
                    {selected
                      ? `Reihe ${selected.row} · Feld ${selected.column}: ${mm(selected.width)} × ${mm(selected.height)}${selected.shaped ? ' · Konturzuschnitt (Außenmaße)' : selected.cut ? ' · Zuschnitt' : ' · Ganze Fliese'}`
                      : ''}
                  </Text>
                  {selected?.shaped && (
                    <Text size="xs" c="dimmed">
                      Schnittpunkte X/Y in mm ab linker oberer Zuschnittkante:{' '}
                      {cutCoordinates(selected)}
                    </Text>
                  )}
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
                <div className="tile-plan-lists" data-expanded={cutsOpen || productsOpen}>
                  <details
                    className="tile-cut-list"
                    open={cutsOpen}
                    onToggle={(event) => setCutsOpen(event.currentTarget.open)}
                  >
                    <summary className="tile-section-heading tile-list-heading">
                      Zuschnittliste ({plan.cut} Stück)
                      <TileInfo
                        title="Zuschnittliste"
                        text="Breite und Höhe sind die Außenmaße des Zuschnitts. Bei Konturzuschnitten zeigt der Plan den tatsächlichen Schnittverlauf. Die Feldnummern ordnen die Zuschnitte dem Raster zu."
                      />
                    </summary>
                    {plan.cut ? (
                      <Table>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Breite × Höhe (mm)</Table.Th>
                            <Table.Th>Stück</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {plan.cuts.map((c, i) => (
                            <Table.Tr key={i}>
                              <Table.Td>
                                {number(c.width, 3)} × {number(c.height, 3)}
                                {c.shaped && (
                                  <Text size="xs" c="dimmed">
                                    Kontur · Außenmaße · Felder {c.fields.join(', ')}
                                  </Text>
                                )}
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
                  <TileProducts
                    products={form.values.products}
                    quantity={plan.purchase}
                    busy={busy}
                    open={productsOpen}
                    onToggle={setProductsOpen}
                    onChange={(products) => form.setFieldValue('products', products)}
                    onUpload={(ident, file) => void uploadProductImage(ident, file)}
                  />
                </div>
              </>
            )
          )}
        </Stack>
      </div>
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

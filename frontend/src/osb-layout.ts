import { defaultTiles, OsbConfig, summarizePieces, tileLayout, TileSettings } from './tile-layout';
import { GapBand, Point, roomGeometry } from './tile-geometry';

export const osbSources = [
  {
    title: 'EGGER TLBP104 · Verarbeitungshinweise, Rev. 03 vom 02.09.2026, S. 2–6',
    url: 'https://binary.egger.link/pis/70fce4de-778e-4cb9-9e7b-5d00d300ffd2/TL-TLBP104-EGGER-OSB-tg-basic-installation-guideline-de',
  },
  {
    title: 'OBI · OSB-Platten verlegen (schwimmender Boden)',
    url: 'https://www.obi.de/magazin/bauen/boden/osb-platten-verlegen',
  },
];
export const defaultOsb: TileSettings = {
  ...defaultTiles,
  tileWidth: 2500,
  tileHeight: 675,
  edge: 15,
  joint: 0,
  pattern: 'half',
  start: 'corner',
  osb: {
    installation: 'floating',
    profile: 'tg',
    thickness: 22,
    minStagger: 400,
    joistSpacing: 625,
    joistOffset: 0,
    joistWidth: 60,
  },
};
type Line = { a: Point; b: Point };
export function osbLayout(settings: TileSettings) {
  const c = settings.osb;
  if (!c) throw Error('OSB-Aufbau fehlt.');
  const ranges: Record<keyof Omit<OsbConfig, 'installation' | 'profile'>, [number, number]> = {
    thickness: [6, 60],
    minStagger: [100, 2500],
    joistSpacing: [100, 2000],
    joistOffset: [0, 2000],
    joistWidth: [40, 200],
  };
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[])
    if (!Number.isFinite(c[key]) || c[key] < ranges[key][0] || c[key] > ranges[key][1])
      throw Error('Ungültige OSB-Einstellung: ' + key);
  if (!['floating', 'joists'].includes(c.installation) || !['tg', 'square'].includes(c.profile))
    throw Error('Unbekannter OSB-Aufbau.');
  if (settings.edge <= 10)
    throw Error(
      'Im gewählten Planungsprofil muss die Randfuge größer als 10 mm sein (Vorgabe: 15 mm).',
    );
  if (settings.pattern !== 'half') throw Error('OSB wird im Verband ohne Kreuzfugen geplant.');
  if (c.profile === 'tg' && settings.joint !== 0)
    throw Error(
      'Für das modellierte Nut/Feder-Profil die integrierte Fuge verwenden: Zusatzfuge 0 mm.',
    );
  if (c.profile === 'square' && settings.joint <= 0)
    throw Error(
      'Geradkantige Platten benötigen eine Herstellervorgabe für die Plattenfuge größer als 0 mm.',
    );
  if (settings.tileWidth < settings.tileHeight)
    throw Error('Die Plattenlänge (Hauptachse) muss mindestens der Plattenbreite entsprechen.');
  if (c.installation === 'joists' && c.profile !== 'tg')
    throw Error(
      'Balkenlage: Diese Version unterstützt vierseitige Nut/Feder-Platten. Geradkantige Platten benötigen zusätzlich Unterstützung an allen Kanten.',
    );
  if (c.installation === 'joists' && c.joistOffset >= c.joistSpacing)
    throw Error('Die erste Balkenachse muss innerhalb eines Balkenabstands liegen.');
  const rotated = settings.rotated,
    swap = (p: Point) => (rotated ? { x: p.y, y: p.x } : { ...p });
  const s = {
    ...settings,
    width: rotated ? settings.height : settings.width,
    height: rotated ? settings.width : settings.height,
    contour: settings.contour?.map(swap),
    rotated: false,
    offsetX: rotated ? settings.offsetY : settings.offsetX,
    offsetY: rotated ? settings.offsetX : settings.offsetY,
  };
  let length = s.tileWidth,
    shift = (length + s.joint) / 2,
    originX: number | undefined;
  const notices = [
    'Bodenplanung für eine Plattenlage. Plattendicke und zulässiger Balkenabstand sind keine statische Bemessung.',
    'Für Böden freigegebene OSB/3- oder OSB/4-Platten und ihr Deckmaß verwenden. Nut/Feder, Zuschnittkanten, Klimatisierung (OBI: mindestens 48 Stunden), trockenen/ebenen Untergrund und Feuchteschutz nach Produkt und Bodenaufbau prüfen. OSB ist keine Abdichtung.',
  ];
  if (c.installation === 'joists') {
    const spans = Math.floor((length + 0.001) / c.joistSpacing),
      required = Math.ceil(Math.max(c.minStagger, c.joistSpacing) / c.joistSpacing);
    if (spans < 2 || spans < required * 2)
      throw Error(
        'Plattenlänge und Balkenraster erlauben keinen ausreichenden Stoßversatz. Format oder tatsächliche Auflagerplanung prüfen.',
      );
    length = spans * c.joistSpacing;
    shift = Math.max(required, Math.floor(spans / 2)) * c.joistSpacing;
    const bounds = roomGeometry(s.width, s.height, s.edge, s.contour).bounds;
    const desired =
      s.start === 'center'
        ? (bounds.left + bounds.right - length) / 2
        : s.start === 'offset'
          ? bounds.left + s.offsetX
          : bounds.left;
    originX =
      c.joistOffset +
      Math.round((desired - c.joistOffset) / c.joistSpacing) * c.joistSpacing -
      bounds.left;
    if (length < settings.tileWidth - 0.001)
      notices.push(
        `Platten werden für das Balkenraster auf ${length} mm Länge zugeschnitten. Diese Felder zählen als Zuschnitte.`,
      );
    notices.push(
      'Platten-Hauptachse quer zu den eingezeichneten Balken. Kurze innere Stöße liegen auf Balkenachsen; Randabfangungen und Lasten müssen vor Ort geprüft werden.',
    );
  }
  if (Math.min(shift, length + s.joint - shift) + 0.001 < c.minStagger)
    throw Error('Das gewählte Format erreicht den eingestellten Mindest-Stoßversatz nicht.');
  const gaps: GapBand[] = [];
  for (let x = 10000; x < s.width - s.edge; x += 10000)
    gaps.push({ x: x - 7.5, y: 0, width: 15, height: s.height });
  for (let y = 10000; y < s.height - s.edge; y += 10000)
    gaps.push({ x: 0, y: y - 7.5, width: s.width, height: 15 });
  if (gaps.length)
    notices.push(
      'Automatische 15-mm-Feldfugen teilen große Flächen spätestens alle 10 m. Vorhandene Bauwerksfugen und Türübergänge zusätzlich übernehmen.',
    );
  const base = tileLayout(
    { ...s, tileWidth: length },
    { gaps, originX, rowShift: (r) => (r % 2 ? shift : 0) },
  );
  const pieces = base.pieces.map((p) => ({
    ...p,
    x: rotated ? p.y : p.x,
    y: rotated ? p.x : p.y,
    width: rotated ? p.height : p.width,
    height: rotated ? p.width : p.height,
    paths: p.paths.map((path) => path.map(swap)),
    cut: p.cut || length < settings.tileWidth - 0.001,
  }));
  const beams: Line[] = [],
    unsupported: Line[] = [];
  if (c.installation === 'joists') {
    for (let x = c.joistOffset; x <= s.width; x += c.joistSpacing)
      beams.push({ a: swap({ x, y: 0 }), b: swap({ x, y: s.height }) });
    const supported = (x: number) =>
      Math.abs(
        x - (c.joistOffset + Math.round((x - c.joistOffset) / c.joistSpacing) * c.joistSpacing),
      ) <=
      c.joistWidth / 2 - 0.5;
    for (const piece of base.pieces)
      for (const path of piece.paths)
        path.forEach((a, i) => {
          const b = path[(i + 1) % path.length];
          if (
            (Math.abs(a.x - b.x) < 0.001 && !supported(a.x)) ||
            (Math.abs(a.x - b.x) > 0.001 && Math.abs(a.y - b.y) > 0.001)
          )
            unsupported.push({ a: swap(a), b: swap(b) });
        });
    if (unsupported.length)
      notices.push(
        `${unsupported.length} kurze oder schräge Zuschnittkanten sind im eingegebenen Balkenraster nicht aufgelagert. Rote Kanten benötigen eine gesonderte Rand-/Querabfangung.`,
      );
  }
  const physicalGaps = gaps.map((g) =>
    rotated ? { x: g.y, y: g.x, width: g.height, height: g.width } : g,
  );
  return {
    ...base,
    ...summarizePieces(
      pieces,
      rotated ? settings.tileHeight : settings.tileWidth,
      rotated ? settings.tileWidth : settings.tileHeight,
      settings.reserve,
    ),
    room: base.room.map(swap),
    footprint: base.footprint.map((path) => path.map(swap)),
    osb: {
      beams,
      unsupported,
      gaps: physicalGaps,
      notices,
      stagger: Math.min(shift, length + s.joint - shift),
      effectiveLength: length,
      joistWidth: c.joistWidth,
    },
  };
}

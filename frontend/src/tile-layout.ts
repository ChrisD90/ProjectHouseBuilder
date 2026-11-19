import { clipTile, contourKey, Point, roomGeometry, signedArea, GapBand } from './tile-geometry';
export type OsbConfig = {
  installation: 'floating' | 'joists';
  profile: 'tg' | 'square';
  thickness: number;
  minStagger: number;
  joistSpacing: number;
  joistOffset: number;
  joistWidth: number;
};

/** All dimensions are millimetres. Clipped pieces consume one tile each;
 * offcut reuse is deliberately not assumed in the purchase estimate. */
export type TileSettings = {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  joint: number;
  edge: number;
  reserve: number;
  rotated: boolean;
  pattern: 'straight' | 'half';
  start: 'center' | 'corner' | 'offset';
  offsetX: number;
  offsetY: number;
  contour?: Point[];
  roomShape?: 'rectangle' | 'l' | 'trapezoid' | 'round' | 'custom';
  osb?: OsbConfig;
};
export const defaultTiles: TileSettings = {
  width: 4000,
  height: 3000,
  tileWidth: 600,
  tileHeight: 300,
  joint: 3,
  edge: 5,
  reserve: 10,
  rotated: false,
  pattern: 'straight',
  start: 'center',
  offsetX: 0,
  offsetY: 0,
};
export type TilePiece = {
  id: string;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  cut: boolean;
  shaped: boolean;
  paths: Point[][];
  area: number;
};
const EPS = 0.001;
const round = (n: number) => Math.round(n * 1000) / 1000;
function segments(length: number, tile: number, joint: number, origin: number) {
  const pitch = tile + joint;
  const first = Math.floor((-origin - tile) / pitch) + 1;
  const last = Math.ceil((length - origin) / pitch) - 1;
  const result = [];
  for (let i = first; i <= last; i++) {
    const from = Math.max(0, origin + i * pitch),
      to = Math.min(length, origin + i * pitch + tile);
    if (to - from > EPS) result.push({ from, size: round(to - from), index: i });
  }
  return result;
}
function centered(length: number, tile: number, joint: number, stagger = false) {
  const candidates = [(length - tile) / 2, (length + joint) / 2];
  const score = (origin: number) => {
    const a = segments(length, tile, joint, origin);
    const b = stagger ? segments(length, tile, joint, origin + (tile + joint) / 2) : [];
    return Math.min(...a.concat(b).map((x) => x.size));
  };
  return score(candidates[1]) > score(candidates[0]) + EPS ? candidates[1] : candidates[0];
}
export function tileLayout(
  s: TileSettings,
  options: { gaps?: GapBand[]; originX?: number; rowShift?: (row: number) => number } = {},
) {
  const nums = [
    'width',
    'height',
    'tileWidth',
    'tileHeight',
    'joint',
    'edge',
    'reserve',
    'offsetX',
    'offsetY',
  ] as const;
  if (nums.some((k) => !Number.isFinite(s[k])))
    throw Error('Bitte alle Maße vollständig eingeben.');
  if (
    s.width < 100 ||
    s.height < 100 ||
    s.width > 100000 ||
    s.height > 100000 ||
    s.tileWidth < 10 ||
    s.tileHeight < 10 ||
    s.tileWidth > 5000 ||
    s.tileHeight > 5000 ||
    s.joint < 0 ||
    s.joint > 30 ||
    s.edge < 0 ||
    s.edge > 100 ||
    s.reserve < 0 ||
    s.reserve > 100 ||
    s.offsetX < 0 ||
    s.offsetY < 0 ||
    s.offsetX > 10000 ||
    s.offsetY > 10000 ||
    !['straight', 'half'].includes(s.pattern) ||
    !['center', 'corner', 'offset'].includes(s.start)
  )
    throw Error('Bitte gültige Maße eingeben (Raum: 10–10.000 cm, Fliesen: 1–500 cm).');
  const outerWidth = s.width - 2 * s.edge,
    outerHeight = s.height - 2 * s.edge;
  if (outerWidth <= EPS || outerHeight <= EPS)
    throw Error('Der Randabstand lässt keine belegbare Fläche übrig.');
  const tw = s.rotated ? s.tileHeight : s.tileWidth,
    th = s.rotated ? s.tileWidth : s.tileHeight;
  if (
    (Math.ceil(outerWidth / (tw + s.joint)) + 2) * (Math.ceil(outerHeight / (th + s.joint)) + 2) >
    5000
  )
    throw Error(
      'Mehr als 5.000 Fliesenfelder: Bitte einen kleineren Raum oder größere Fliesen wählen.',
    );
  const geometry = roomGeometry(s.width, s.height, s.edge, s.contour, options.gaps);
  const { left, top, right, bottom } = geometry.bounds;
  const width = right - left,
    height = bottom - top;
  const ox =
    options.originX ??
    (s.start === 'center'
      ? centered(width, tw, s.joint, s.pattern === 'half')
      : s.start === 'offset'
        ? s.offsetX % (tw + s.joint)
        : 0);
  const oy =
    s.start === 'center'
      ? centered(height, th, s.joint)
      : s.start === 'offset'
        ? s.offsetY % (th + s.joint)
        : 0;
  const rows = segments(height, th, s.joint, oy);
  const pieces: TilePiece[] = [];
  rows.forEach((row, r) => {
    const shift = options.rowShift
      ? options.rowShift(r)
      : s.pattern === 'half' && r % 2
        ? (tw + s.joint) / 2
        : 0;
    segments(width, tw, s.joint, ox + shift).forEach((col, c) => {
      const paths = clipTile(geometry.paths, col.from + left, row.from + top, col.size, row.size);
      if (!paths.length) return;
      const points = paths.flat(),
        x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      const pw = round(Math.max(...points.map((p) => p.x)) - x),
        ph = round(Math.max(...points.map((p) => p.y)) - y);
      const area = paths.reduce((sum, p) => sum + Math.abs(signedArea(p)), 0);
      const shaped = Math.abs(area - pw * ph) > Math.max(0.01, pw * ph * 1e-7);
      pieces.push({
        id: `${r + 1}.${c + 1}`,
        row: r + 1,
        column: c + 1,
        x,
        y,
        width: pw,
        height: ph,
        paths,
        area,
        shaped,
        cut: shaped || pw < tw - EPS || ph < th - EPS,
      });
    });
  });
  return {
    ...summarizePieces(pieces, tw, th, s.reserve),
    area: geometry.area / 1e6,
    room: geometry.room,
    footprint: geometry.paths.map((path) => path.map((p) => ({ x: p.X / 1000, y: p.Y / 1000 }))),
  };
}
export function summarizePieces(pieces: TilePiece[], tw: number, th: number, reserve: number) {
  const cuts = pieces.filter((p) => p.cut);
  const grouped = new Map<
    string,
    { width: number; height: number; count: number; shaped: boolean; fields: string[] }
  >();
  cuts.forEach((p) => {
    const key = `${p.width}x${p.height}:${p.shaped ? contourKey(p.paths, p.x, p.y) : 'rect'}`;
    const found = grouped.get(key);
    if (found) {
      found.count++;
      found.fields.push(p.id);
    } else
      grouped.set(key, {
        width: p.width,
        height: p.height,
        count: 1,
        shaped: p.shaped,
        fields: [p.id],
      });
  });
  return {
    pieces,
    cuts: [...grouped.values()],
    full: pieces.length - cuts.length,
    cut: cuts.length,
    purchase: Math.ceil(pieces.length * (1 + reserve / 100)),
    tileArea: pieces.reduce((sum, p) => sum + p.area, 0) / 1e6,
    narrow: cuts.filter((p) => p.width < tw / 3 - EPS || p.height < th / 3 - EPS).length,
    tileWidth: tw,
    tileHeight: th,
  };
}

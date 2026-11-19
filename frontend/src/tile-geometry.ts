import ClipperLib from 'clipper-lib';

export type Point = { x: number; y: number };

/** Wall lengths refer to the original room, before deducting the edge joint.
 * Arrange identifiers in four outer gutters, keeping short neighbouring edges readable. */
export function roomEdgeLabels(room: Point[], width: number, height: number, margin: number) {
  const clockwise = signedArea(room) > 0;
  const alphabet = (index: number) => {
    let label = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
      label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
    return label;
  };
  const edges = room.map((a, i) => {
    const b = room[(i + 1) % room.length],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const nx = clockwise ? dy : -dy,
      ny = clockwise ? -dx : dx;
    const side =
      Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'right' : 'left') : ny > 0 ? 'bottom' : 'top';
    return {
      id: alphabet(i),
      from: i + 1,
      to: ((i + 1) % room.length) + 1,
      a,
      b,
      length: Math.hypot(dx, dy),
      middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      side,
      label: { x: 0, y: 0 },
    };
  });
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const vertical = side === 'left' || side === 'right',
      axis = vertical ? 'y' : 'x';
    const group = edges
      .filter((e) => e.side === side)
      .sort((a, b) => a.middle[axis] - b.middle[axis] || a.from - b.from);
    const length = vertical ? height : width,
      gap = margin * 0.62;
    const span = Math.max(length, gap * (group.length - 1)),
      start = (length - span) / 2;
    const positions: number[] = [];
    group.forEach((edge, i) =>
      positions.push(Math.max(start, edge.middle[axis], i ? positions[i - 1] + gap : start)),
    );
    for (let i = positions.length - 1; i >= 0; i--)
      positions[i] = Math.min(
        positions[i],
        i === positions.length - 1 ? start + span : positions[i + 1] - gap,
      );
    group.forEach((edge, i) => {
      edge.label = vertical
        ? { x: side === 'left' ? -margin * 0.65 : width + margin * 0.65, y: positions[i] }
        : { x: positions[i], y: side === 'top' ? -margin * 0.65 : height + margin * 0.65 };
    });
  }
  const pad = margin * 0.35;
  const left = Math.min(-margin, ...edges.map((e) => e.label.x - pad)),
    top = Math.min(-margin, ...edges.map((e) => e.label.y - pad));
  const right = Math.max(width + margin, ...edges.map((e) => e.label.x + pad)),
    bottom = Math.max(height + margin, ...edges.map((e) => e.label.y + pad));
  return {
    edges,
    viewBox: { left, top, width: right - left, height: bottom - top },
    fontSize: margin * 0.23,
  };
}
const SCALE = 1000; // integer micrometres, safely below Clipper's integer limit
const EPS = 0.001;
export const signedArea = (points: Point[]) =>
  points.reduce((a, p, i) => {
    const q = points[(i + 1) % points.length];
    return a + p.x * q.y - q.x * p.y;
  }, 0) / 2;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function touches(a: Point, b: Point, c: Point, d: Point) {
  const on = (p: Point, q: Point, r: Point) =>
    Math.abs(cross(p, q, r)) < EPS &&
    r.x >= Math.min(p.x, q.x) - EPS &&
    r.x <= Math.max(p.x, q.x) + EPS &&
    r.y >= Math.min(p.y, q.y) - EPS &&
    r.y <= Math.max(p.y, q.y) + EPS;
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}
export function validateContour(points: Point[], width: number, height: number) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 64)
    throw Error('Die Raumkontur benötigt 3 bis 64 Eckpunkte.');
  if (
    points.some(
      (p) =>
        !p ||
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > width ||
        p.y > height,
    )
  )
    throw Error('Alle Eckpunkte müssen innerhalb von Raumbreite und -tiefe liegen.');
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPS)
      throw Error('Zwei aufeinanderfolgende Eckpunkte sind identisch.');
    const c = points[(i + 2) % points.length];
    if (Math.abs(cross(a, b, c)) < EPS && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0)
      throw Error('Die Kontur darf nicht entlang derselben Wand zurücklaufen.');
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (touches(a, b, points[j], points[(j + 1) % points.length]))
        throw Error('Die Raumkontur darf sich nicht überschneiden oder selbst berühren.');
    }
  }
  if (Math.abs(signedArea(points)) < 1)
    throw Error('Die Raumkontur muss eine Fläche einschließen.');
}
const toPath = (points: Point[]) =>
  points.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path: ClipperLib.Path) => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
export function roomGeometry(width: number, height: number, edge: number, contour?: Point[]) {
  const room = contour ?? [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  validateContour(room, width, height);
  const path = toPath(room);
  if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
  let paths: ClipperLib.Paths = [path];
  if (edge > 0) {
    const offset = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
    offset.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    paths = [];
    offset.Execute(paths, -edge * SCALE);
  }
  if (!paths.length)
    throw Error('Der Randabstand lässt keine belegbare Fläche in dieser Kontur übrig.');
  const area = paths.reduce((sum, p) => sum + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE);
  if (area < 1) throw Error('Der Randabstand lässt keine belegbare Fläche in dieser Kontur übrig.');
  const points = paths.flat();
  const bounds = {
    left: Math.min(...points.map((p) => p.X)),
    top: Math.min(...points.map((p) => p.Y)),
    right: Math.max(...points.map((p) => p.X)),
    bottom: Math.max(...points.map((p) => p.Y)),
  };
  return {
    room,
    paths,
    area,
    bounds: {
      left: bounds.left / SCALE,
      top: bounds.top / SCALE,
      right: bounds.right / SCALE,
      bottom: bounds.bottom / SCALE,
    },
  };
}
export function clipTile(
  paths: ClipperLib.Paths,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(
    toPath([
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ]),
    ClipperLib.PolyType.ptClip,
    true,
  );
  const result: ClipperLib.Paths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    result,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return result.map(fromPath).filter((p) => Math.abs(signedArea(p)) > EPS * EPS);
}
export const svgPath = (paths: Point[][]) =>
  paths.map((p) => 'M' + p.map((q) => `${q.x},${q.y}`).join('L') + 'Z').join('');

/** Place field identifiers inside the material, also for concave cuts. */
export function labelPoint(paths: Point[][]) {
  let best = { x: paths[0][0].x, y: paths[0][0].y, width: 0 };
  for (const path of paths) {
    const y = (Math.min(...path.map((p) => p.y)) + Math.max(...path.map((p) => p.y))) / 2;
    const xs = path
      .flatMap((a, i) => {
        const b = path[(i + 1) % path.length];
        return a.y > y !== b.y > y ? [a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y)] : [];
      })
      .sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      if (xs[i + 1] - xs[i] > best.width)
        best = { x: (xs[i] + xs[i + 1]) / 2, y, width: xs[i + 1] - xs[i] };
  }
  return best;
}

/** Canonical translation-independent contour; different shapes are never grouped by bounding box alone. */
export function contourKey(paths: Point[][], x: number, y: number) {
  return paths
    .map((p) => {
      const points = p.map(
        (q) => `${Math.round((q.x - x) * SCALE)},${Math.round((q.y - y) * SCALE)}`,
      );
      return points.map((_, i) => points.slice(i).concat(points.slice(0, i)).join(';')).sort()[0];
    })
    .sort()
    .join('|');
}

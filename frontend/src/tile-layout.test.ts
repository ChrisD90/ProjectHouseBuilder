import { describe, expect, it } from 'vitest';
import { defaultTiles, tileLayout } from './tile-layout';

describe('tile planning calculation integrity', () => {
  it('fits exact tiles without phantom edge pieces and includes reserve', () => {
    const plan = tileLayout({
      ...defaultTiles,
      width: 1203,
      height: 603,
      edge: 0,
      start: 'corner',
    });
    expect(plan.pieces).toHaveLength(4);
    expect(plan.full).toBe(4);
    expect(plan.cut).toBe(0);
    expect(plan.purchase).toBe(5);
  });
  it('clips every piece to the usable rectangle without overlaps for all patterns and origins', () => {
    for (const pattern of ['straight', 'half'] as const)
      for (const start of ['center', 'corner', 'offset'] as const) {
        const s = {
          ...defaultTiles,
          width: 1400,
          height: 950,
          pattern,
          start,
          offsetX: 173,
          offsetY: 77,
        };
        const plan = tileLayout(s);
        for (const p of plan.pieces) {
          expect(p.x).toBeGreaterThanOrEqual(s.edge);
          expect(p.y).toBeGreaterThanOrEqual(s.edge);
          expect(p.x + p.width).toBeLessThanOrEqual(s.width - s.edge + 0.001);
          expect(p.y + p.height).toBeLessThanOrEqual(s.height - s.edge + 0.001);
          expect(p.width).toBeGreaterThan(0);
          expect(p.height).toBeGreaterThan(0);
          for (const other of plan.pieces.filter((x) => x.id !== p.id)) {
            expect(
              Math.min(p.x + p.width, other.x + other.width) - Math.max(p.x, other.x) <= 0.001 ||
                Math.min(p.y + p.height, other.y + other.height) - Math.max(p.y, other.y) <= 0.001,
            ).toBe(true);
          }
        }
        expect(plan.cuts.reduce((sum, c) => sum + c.count, 0)).toBe(plan.cut);
        expect(plan.full + plan.cut).toBe(plan.pieces.length);
        expect(plan.tileArea).toBeLessThanOrEqual(plan.area);
        expect(plan.purchase).toBeGreaterThanOrEqual(plan.pieces.length);
      }
  });
  it('balances opposite cuts, rotates dimensions, and keeps a single oversized tile', () => {
    const plan = tileLayout({ ...defaultTiles, width: 1400, height: 950 });
    const top = plan.pieces.filter((x) => x.row === 1);
    expect(top[0].width).toBeCloseTo(top.at(-1)!.width, 3);
    expect(tileLayout({ ...defaultTiles, rotated: true }).tileWidth).toBe(300);
    const small = tileLayout({ ...defaultTiles, width: 200, height: 200 });
    expect(small.pieces).toHaveLength(1);
    expect(small.pieces[0].width).toBe(190);
  });
  it('rejects invalid sizes and unbounded raster sizes before allocating pieces', () => {
    expect(() => tileLayout({ ...defaultTiles, width: NaN })).toThrow();
    expect(() => tileLayout({ ...defaultTiles, width: 100, height: 100, edge: 50 })).toThrow();
    expect(() =>
      tileLayout({ ...defaultTiles, width: 100000, height: 100000, tileWidth: 10, tileHeight: 10 }),
    ).toThrow('5.000');
  });
  it('clips concave L-shaped rooms and applies clearance at the inner corner', () => {
    const contour = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 400 },
      { x: 400, y: 400 },
      { x: 400, y: 1000 },
      { x: 0, y: 1000 },
    ];
    const s = {
      ...defaultTiles,
      width: 1000,
      height: 1000,
      tileWidth: 600,
      tileHeight: 600,
      joint: 0,
      edge: 0,
      start: 'corner' as const,
      contour,
    };
    const plan = tileLayout(s);
    expect(plan.area).toBeCloseTo(0.64, 6);
    expect(plan.tileArea).toBeCloseTo(plan.area, 6);
    expect(plan.pieces).toHaveLength(3);
    expect(plan.pieces.find((p) => p.id === '1.1')?.shaped).toBe(true);
    expect(plan.full).toBe(0);
    expect(plan.pieces.flatMap((p) => p.paths.flat()).every((p) => p.x <= 400 || p.y <= 400)).toBe(
      true,
    );
    const inset = tileLayout({ ...s, edge: 5 });
    expect(inset.area).toBeCloseTo(0.6201, 6);
    expect(
      inset.pieces
        .flatMap((p) => p.paths.flat())
        .every((p) => p.x >= 5 && p.y >= 5 && (p.x <= 395 || p.y <= 395)),
    ).toBe(true);
    const reversed = tileLayout({ ...s, contour: [...contour].reverse() });
    expect(reversed.area).toBe(plan.area);
    expect(reversed.purchase).toBe(plan.purchase);
  });
  it('preserves actual areas and contour cuts for diagonal and approximated round rooms', () => {
    const s = {
      ...defaultTiles,
      width: 1000,
      height: 1000,
      tileWidth: 300,
      tileHeight: 300,
      joint: 0,
      edge: 0,
    };
    const diagonal = tileLayout({
      ...s,
      contour: [
        { x: 200, y: 0 },
        { x: 800, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
      ],
    });
    expect(diagonal.area).toBeCloseTo(0.8, 6);
    expect(diagonal.tileArea).toBeCloseTo(0.8, 5);
    expect(diagonal.cuts.some((c) => c.shaped)).toBe(true);
    const round = tileLayout({
      ...s,
      contour: Array.from({ length: 48 }, (_, i) => ({
        x: 500 + Math.cos((i * Math.PI) / 24) * 500,
        y: 500 + Math.sin((i * Math.PI) / 24) * 500,
      })),
    });
    expect(round.area).toBeGreaterThan(Math.PI * 0.25 * 0.995);
    expect(round.area).toBeLessThan(Math.PI * 0.25);
    expect(round.tileArea).toBeCloseTo(round.area, 5);
  });
  it('rejects crossing, repeated, backtracking and out-of-bounds contour points', () => {
    for (const contour of [
      [
        { x: 0, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 },
        { x: 1000, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 0 },
        { x: 0, y: 1000 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 500, y: 0 },
        { x: 0, y: 1000 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1001, y: 0 },
        { x: 0, y: 1000 },
      ],
    ])
      expect(() => tileLayout({ ...defaultTiles, width: 1000, height: 1000, contour })).toThrow();
  });
});

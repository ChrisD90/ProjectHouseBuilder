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
});

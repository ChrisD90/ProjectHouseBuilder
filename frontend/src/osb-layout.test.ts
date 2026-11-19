import { describe, expect, it } from 'vitest';
import { defaultOsb, osbLayout } from './osb-layout';
describe('OSB layout process integrity', () => {
  it('uses staggered joints and rejects incompatible floor assumptions', () => {
    const plan = osbLayout(defaultOsb);
    expect(plan.osb.stagger).toBeGreaterThanOrEqual(400);
    const joints = (row: number) =>
      plan.pieces
        .filter((p) => p.row === row && p.x + p.width < defaultOsb.width - defaultOsb.edge - 0.001)
        .map((p) => p.x + p.width);
    expect(joints(1).some((x) => joints(2).some((y) => Math.abs(x - y) < 0.001))).toBe(false);
    expect(() => osbLayout({ ...defaultOsb, edge: 5 })).toThrow();
    expect(() => osbLayout({ ...defaultOsb, pattern: 'straight' })).toThrow();
    expect(() =>
      osbLayout({
        ...defaultOsb,
        osb: { ...defaultOsb.osb!, installation: 'joists', profile: 'square' },
      }),
    ).toThrow();
  });
  it('cuts lengths to the joist grid and rotates the entire structural layout', () => {
    const s = {
      ...defaultOsb,
      tileWidth: 2440,
      osb: { ...defaultOsb.osb!, installation: 'joists' as const },
    };
    const plan = osbLayout(s);
    expect(plan.osb.effectiveLength).toBe(1875);
    expect(plan.osb.stagger).toBe(625);
    expect(plan.full).toBe(0);
    for (const p of plan.pieces) {
      const end = p.x + p.width;
      if (end < s.width - s.edge - 0.001) expect(end / 625).toBeCloseTo(Math.round(end / 625), 5);
    }
    const rotated = osbLayout({ ...s, rotated: true });
    expect(rotated.tileWidth).toBe(675);
    expect(rotated.tileHeight).toBe(2440);
    expect(rotated.osb.beams.every((line) => line.a.y === line.b.y)).toBe(true);
    for (const p of rotated.pieces) {
      expect(p.x + p.width).toBeLessThanOrEqual(s.width - s.edge + 0.001);
      expect(p.y + p.height).toBeLessThanOrEqual(s.height - s.edge + 0.001);
    }
  });
  it('removes actual expansion bands from material coverage and quantities', () => {
    const s = { ...defaultOsb, width: 12000 };
    const plan = osbLayout(s);
    expect(plan.osb.gaps).toHaveLength(1);
    expect(plan.area).toBeCloseTo(
      ((s.width - 30) * (s.height - 30) - 15 * (s.height - 30)) / 1e6,
      5,
    );
    expect(plan.tileArea).toBeCloseTo(plan.area, 5);
    expect(
      plan.pieces.flatMap((p) => p.paths.flat()).every((p) => p.x <= 9992.5 || p.x >= 10007.5),
    ).toBe(true);
  });
});

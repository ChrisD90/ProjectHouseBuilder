import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function service(nodes = []) {
  const data = new Map();
  const window = { addEventListener() {}, dispatchEvent() {} };
  const context = {
    window,
    document: {
      body: {},
      readyState: 'loading',
      addEventListener() {},
      querySelectorAll: () => [],
      createTreeWalker: () => {
        let index = 0;
        return { nextNode: () => nodes[index++] || null };
      },
    },
    localStorage: {
      getItem: (key) => data.get(key) || null,
      setItem: (key, value) => data.set(key, value),
    },
    requestAnimationFrame(fn) {
      window.flush = fn;
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    Event,
    Intl,
    Date,
  };
  runInNewContext(
    readFileSync(new URL('../../static/presentation.js', import.meta.url), 'utf8'),
    context,
  );
  return Object.assign(window.PHBDisplay, { flush: () => window.flush?.() });
}
describe('presentation preserves canonical project values', () => {
  it('keeps implicit native option values intact when unit labels change', () => {
    const node = { data: 'm²', parentElement: { closest: () => option } };
    const option = {
      label: 'm²',
      hasAttribute: () => false,
      get value() {
        return node.data;
      },
    };
    const api = service([node]);
    api.set({ unitDisplay: 'long' });
    api.flush();
    expect(option.label).toBe('Quadratmeter');
    expect(option.value).toBe('m²');
    expect(node.data).toBe('m²');
    api.set({ unitDisplay: 'short' });
    api.flush();
    expect(option.label).toBe('m²');
    expect(option.value).toBe('m²');
  });
  it('preserves date-like identifiers and filenames in displayed records',()=>{
    const nodes=['RE-2026-12-31','2026-12-31.pdf','file_2026-12-31','2026-12-31/01'].map(data=>({data,parentElement:{closest:()=>null}}));
    const api=service(nodes);api.set({dateFormat:'slash'});api.flush();
    expect(nodes.map(node=>node.data)).toEqual(['RE-2026-12-31','2026-12-31.pdf','file_2026-12-31','2026-12-31/01']);
  });
  it('changes date and currency presentation without modifying source values', () => {
    const api = service(),
      source = { amount: 1234.56, date: '2026-12-31', unit: 'm²' },
      before = JSON.stringify(source);
    expect(api.date(source.date)).toBe('31.12.2026');
    api.set({ dateFormat: 'iso', currencyDisplay: 'code', unitDisplay: 'long' });
    expect(api.date(source.date)).toBe('2026-12-31');
    expect(api.money(source.amount)).toContain('EUR');
    expect(api.unit(source.unit)).toBe('Quadratmeter');
    api.set({ dateFormat: 'slash' });
    expect(api.date(source.date)).toBe('31/12/2026');
    expect(JSON.stringify(source)).toBe(before);
  });
  it('orders favorites alphabetically without changing IDs, names or input order', () => {
    const api = service(),
      rows = [
        { id: 3, name: 'Alpha', favorite: false },
        { id: 2, name: 'Zulu', favorite: true },
        { id: 1, name: 'Beta', favorite: true },
      ],
      before = JSON.stringify(rows);
    const choices = api.companyOptions(rows);
    expect(Array.from(choices, (x) => x.value)).toEqual(['1', '2', '3']);
    expect(Array.from(choices, (x) => x.label)).toEqual(['★ Beta', '★ Zulu', 'Alpha']);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('rejects unsupported preference values and keeps German as the only language', () => {
    const api = service();
    api.set({ language: 'xx', dateFormat: 'unknown', currencyDisplay: 'XXX', unitDisplay: 'bad' });
    expect(api.get()).toEqual({
      language: 'de',
      dateFormat: 'de',
      currencyDisplay: 'symbol',
      unitDisplay: 'short',
    });
  });
});

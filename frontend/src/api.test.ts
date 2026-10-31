import { afterEach, describe, it, expect, vi } from 'vitest';
import { api, hasWrites } from './core';
afterEach(() => vi.unstubAllGlobals());
describe('shared API boundary', () => {
  it('holds the mutation guard until a response completes, then releases it', async () => {
    let complete!: (r: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const saving = api('/api/example', 'POST', { amount: 23 });
    expect(hasWrites()).toBe(true);
    complete(Response.json({ ok: true }));
    expect(await saving).toEqual({ ok: true });
    expect(hasWrites()).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toBeDefined();
  });
  it('preserves server validation failures and never retries a mutation', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'Zuordnung nicht gültig.' }, { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/api/example', 'PATCH', { id: 1 })).rejects.toThrow(
      'Zuordnung nicht gültig.',
    );
    expect(hasWrites()).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('leaves multipart encoding to the browser and only sets AI consent explicitly', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    vi.stubGlobal('fetch', fetcher);
    const form = new FormData();
    form.append('file', new Blob(['sample']), 'sample.txt');
    await api('/api/import-jobs', 'POST', form);
    const first = fetcher.mock.calls[0][1];
    expect(first.body).toBe(form);
    expect(first.headers['Content-Type']).toBeUndefined();
    expect(first.headers['X-PHB-AI']).toBeUndefined();
    await api('/api/ai/example', 'POST', { plan_only: true }, true);
    expect(fetcher.mock.calls[1][1].headers['X-PHB-AI']).toBe('1');
  });
  it('redirects an expired session without leaving the app locked', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(api('/api/example', 'POST', {})).rejects.toThrow('Bitte erneut anmelden.');
    expect(assign).toHaveBeenCalledWith('/login');
    expect(hasWrites()).toBe(false);
  });
});

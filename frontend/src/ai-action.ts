import { api, type Row } from './core';
export async function runAIAction(
  action: string,
  payload: Row,
  options: { target?: number; title?: string; background?: boolean } = {},
) {
  const created = await api(
    '/api/ai-actions',
    'POST',
    { action, payload, target: options.target, title: options.title },
    true,
  );
  const ident = created.job.id;
  void (window as any).PHBReactBridge?.imports.refresh();
  if (options.background) {
    (window as any).PHBReactBridge?.imports.open();
    return null;
  }
  const poll = async (shouldStop = () => false) => {
    let failures = 0;
    while (!shouldStop()) {
      let state: Row;
      try {
        state = await api('/api/ai-actions/' + ident);
        failures = 0;
      } catch (error) {
        if (++failures >= 3)
          throw Error(
            'Verbindung unterbrochen. Der KI-Auftrag bleibt in der Warteschlange und kann später geöffnet werden.',
          );
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      if (state.job.status === 'Fertig') return state.result;
      if (['Fehler', 'Unterbrochen', 'Ausgeblendet'].includes(state.job.status))
        throw Error(state.job.error || 'KI-Auftrag unterbrochen. Bitte Warteschlange öffnen.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return null;
  };
  const bridge = (window as any).PHBReactBridge;
  return bridge?.actions?.wait
    ? bridge.actions.wait(options.title || 'ChatGPT-Auftrag', poll)
    : poll();
}

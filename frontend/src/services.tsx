import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, error, Row, success, useConfirm, useConfirmVisible, useModalLayer } from './core';
import { ModelInfo } from './model-info';
export function useServices(navigate: (url: string) => void) {
  const { setExternal } = useModalLayer();
  const confirming = useConfirmVisible(),
    cache = useQueryClient(),
    [aiOpen, setAiOpen] = useState(false),
    [queueOpen, setQueueOpen] = useState(false),
    [model, setModel] = useState<string | null>(() => {
      try {
        return localStorage.getItem('phb-chatgpt-model');
      } catch {
        return null;
      }
    }),
    [wait, setWait] = useState('');
  useEffect(() => {
    setExternal(aiOpen || queueOpen || !!wait);
    return () => setExternal(false);
  }, [aiOpen, queueOpen, wait, setExternal]);
  const aiQuery = useQuery({
    queryKey: ['ai'],
    queryFn: () => api('/api/ai/status'),
    staleTime: 60000,
  });
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api('/api/import-jobs'),
    refetchInterval: (query) =>
      (query.state.data?.jobs || []).some((j: Row) => ['Wartend', 'Läuft'].includes(j.status))
        ? 2500
        : 8000,
  });
  const diagnostics = useQuery({
    queryKey: ['ai-diagnostics'],
    queryFn: () => api('/api/ai/diagnostics', 'GET', undefined, true),
    enabled: aiOpen && new URLSearchParams(window.location.search).get('ai') === 'error',
  });
  const models = useQuery({
    queryKey: ['ai-models', aiQuery.data?.email || 'local'],
    queryFn: () => api('/api/ai/models'),
    enabled: !!aiQuery.data?.sharing,
    staleTime: 0,
  });
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('ai')) setAiOpen(true);
  }, []);
  const state = useRef<Row>({ ai: {}, model: '', jobs: [] });
  const catalog: Row[] = models.data?.models || [];
  const currentModel = catalog.some((item) => item.slug === model) ? model : catalog[0]?.slug || '';
  const modelLabel =
    catalog.find((item) => item.slug === currentModel)?.title ||
    catalog.find((item) => item.slug === currentModel)?.name ||
    currentModel;
  state.current = {
    ai: aiQuery.data || {},
    model: currentModel,
    jobs: jobsQuery.data?.jobs || [],
  };
  const running = useRef(new Set<string>()),
    seenJobs = useRef<Map<number, string> | null>(null),
    ask = useConfirm();
  const refreshJobs = () => cache.invalidateQueries({ queryKey: ['jobs'] });
  async function enqueue(options: Row) {
    const {
      kind,
      files,
      analysisMode = 'local',
      model = '',
      fields = {},
      processingMode = 'foreground',
    } = options;
    if (
      running.current.has(kind) ||
      state.current.jobs.some(
        (j: Row) => j.kind === kind && ['Wartend', 'Läuft'].includes(j.status),
      )
    )
      throw Error('Diese Verarbeitung läuft bereits. Bitte Ergebnis oder Fehler abwarten.');
    const selected = Array.from(files || []) as File[];
    if (!selected.length || selected.length > 8)
      throw Error('Bitte eine bis acht Dateien auswählen.');
    running.current.add(kind);
    try {
      if (
        processingMode === 'background' &&
        'Notification' in window &&
        Notification.permission === 'default'
      )
        void Notification.requestPermission().catch(() => {});
      const data = new FormData();
      data.set('kind', kind);
      data.set('analysis_mode', analysisMode);
      if (analysisMode === 'ai') {
        data.set('model', model);
        data.set('plan_only', 'true');
      }
      selected.forEach((file) => data.append('files', file, file.name));
      Object.entries(fields).forEach(([key, value]) => data.set(key, String(value ?? '')));
      const result = await api('/api/import-jobs', 'POST', data, analysisMode === 'ai');
      if (!seenJobs.current) seenJobs.current = new Map();
      result.jobs.forEach((job: Row) => seenJobs.current!.set(job.id, job.status));
      await refreshJobs();
      if (processingMode === 'background') {
        success('Die Dateien werden im Hintergrund verarbeitet.');
        return result.jobs;
      }
      let attempts = 0;
      while (true) {
        let batch: Row;
        try {
          batch = await api('/api/import-jobs/batches/' + result.batch_id);
          attempts = 0;
        } catch (e) {
          if (++attempts >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        const active = batch.jobs.find((j: Row) => ['Wartend', 'Läuft'].includes(j.status));
        setWait(active ? active.filename + ' · ' + active.stage : 'Abgeschlossen');
        if (!active) {
          const failed = batch.jobs.filter((j: Row) =>
            ['Fehler', 'Unterbrochen'].includes(j.status),
          );
          if (failed.length) throw Error(failed.map((j: Row) => j.error || j.stage).join(' · '));
          return batch.jobs;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      running.current.delete(kind);
      await refreshJobs();
    }
  }
  const methods = useRef<Row>({});
  methods.current = {
    ai: {
      selection() {
        const s = state.current;
        if (!s.ai.sharing || !s.ai.credits_acknowledged || !s.model) {
          setAiOpen(true);
          throw Error(
            'Bitte ChatGPT verbinden, die Credit-Warnung bestätigen und ein Modell wählen.',
          );
        }
        return { model: s.model, plan_only: true };
      },
      connected: () => !!state.current.ai.sharing,
      show: () => setAiOpen(true),
      refresh: () => cache.invalidateQueries({ queryKey: ['ai'] }),
      status: () => state.current.ai,
    },
    imports: {
      enqueue,
      async run({ form, processingMode, ...options }: Row) {
        const mode =
          processingMode || form?.querySelector('[name=processing_mode]')?.value || 'foreground';
        setWait('Dateien werden hochgeladen …');
        try {
          return {
            jobs: await enqueue({ ...options, processingMode: mode }),
            background: mode === 'background',
          };
        } finally {
          setWait('');
        }
      },
      review(jobs: Row[]) {
        const job = jobs.find((j) => j.status === 'Fertig' && j.review_url);
        if (job) setTimeout(() => navigate(job.review_url), 0);
        else setQueueOpen(true);
      },
      release(control: HTMLButtonElement) {
        if (!control) return;
        const embedded = (control.ownerDocument.defaultView as any)?.PHBEmbed;
        if (embedded) embedded.release(control);
        else control.disabled = false;
      },
      refresh: refreshJobs,
      open: () => setQueueOpen(true),
    },
    isBusy: () => !!wait || running.current.size > 0,
  };
  const bridge = useRef<Row>({
    ai: {
      selection: () => methods.current.ai.selection(),
      connected: () => methods.current.ai.connected(),
      show: () => methods.current.ai.show(),
      refresh: () => methods.current.ai.refresh(),
      status: () => methods.current.ai.status(),
    },
    imports: {
      enqueue: (options: Row) => methods.current.imports.enqueue(options),
      run: (options: Row) => methods.current.imports.run(options),
      review: (jobs: Row[]) => methods.current.imports.review(jobs),
      release: (control: HTMLButtonElement) => methods.current.imports.release(control),
      refresh: () => methods.current.imports.refresh(),
      open: () => methods.current.imports.open(),
    },
    navigate: (url: string) => navigate(url),
    jobs: () => state.current.jobs,
    changed: () => cache.invalidateQueries(),
    busy: () => methods.current.isBusy(),
  });
  useEffect(() => {
    (window as any).PHBReactBridge = bridge.current;
    return () => {
      delete (window as any).PHBReactBridge;
    };
  }, []);
  useEffect(() => {
    const jobs: Row[] = jobsQuery.data?.jobs || [];
    if (!jobsQuery.data) return;
    for (const frame of document.querySelectorAll('iframe.workflow-frame'))
      try {
        (frame as HTMLIFrameElement).contentWindow &&
          (frame as any).contentWindow.PHBEmbed?.setJobs(jobs);
      } catch {}
    if (!seenJobs.current) {
      seenJobs.current = new Map(jobs.map((j) => [j.id, j.status]));
      return;
    }
    for (const job of jobs) {
      const old = seenJobs.current.get(job.id);
      if (old && old !== job.status && ['Fertig', 'Fehler', 'Unterbrochen'].includes(job.status)) {
        void cache.invalidateQueries({
          predicate: (query) =>
            ['documents', 'master', 'cost-dashboard', 'energy'].includes(String(query.queryKey[0])),
        });
        if (job.status === 'Fertig')
          success(job.filename + ' ist fertig und wartet auf deine Prüfung.');
        else error(new Error(job.filename + ': ' + (job.error || job.stage)));
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const note = new Notification('ProjectHouseBuilder: ' + job.filename, {
            body: job.status === 'Fertig' ? 'Bereit zur Prüfung' : job.error || job.stage,
          });
          note.onclick = () => {
            window.focus();
            if (job.review_url) navigate(job.review_url);
          };
        }
        for (const frame of document.querySelectorAll('iframe.workflow-frame'))
          try {
            (frame as any).contentDocument?.dispatchEvent(
              new CustomEvent('phb-import-updated', { detail: job }),
            );
          } catch {}
      }
      seenJobs.current.set(job.id, job.status);
    }
  }, [jobsQuery.data]);
  const jobs: Row[] = jobsQuery.data?.jobs || [],
    active = jobs.filter((j) => ['Wartend', 'Läuft'].includes(j.status)).length,
    completed = jobs.filter((j) => j.status === 'Fertig').length;
  async function retry(job: Row) {
    try {
      const payload: Row = { plan_only: true };
      if (job.analysis_mode === 'ai') payload.model = methods.current.ai.selection().model;
      await api(
        '/api/import-jobs/' + job.id + '/retry',
        'POST',
        payload,
        job.analysis_mode === 'ai',
      );
      await refreshJobs();
    } catch (e) {
      error(e);
    }
  }
  const overlays = (
    <>
      <Modal
        zIndex={400}
        trapFocus={!confirming && !wait}
        closeOnEscape={!confirming && !wait}
        opened={aiOpen}
        onClose={() => setAiOpen(false)}
        title="ChatGPT-Verbindung"
        closeOnClickOutside={false}
        size="lg"
      >
        <Stack>
          <Group>
            <Badge color={aiQuery.data?.sharing ? 'teal' : 'gray'}>
              {aiQuery.data?.connected
                ? aiQuery.data?.sharing
                  ? 'Verbunden'
                  : 'Berechtigung fehlt'
                : 'Nicht verbunden'}
            </Badge>
            <Text size="sm">{aiQuery.data?.email || 'Lokale Anmeldung über OpenAI'}</Text>
          </Group>
          <Group>
            <Button
              onClick={async () => {
                try {
                  const result = await api('/api/ai/connect', 'POST', {}, true);
                  location.assign(result.authorize_url);
                } catch (e) {
                  error(e);
                }
              }}
            >
              {aiQuery.data?.connected ? 'Erneut anmelden' : 'Mit ChatGPT anmelden'}
            </Button>
            {aiQuery.data?.connected && (
              <Button
                variant="default"
                onClick={async () => {
                  if (await ask('ChatGPT-Verbindung trennen?'))
                    try {
                      await api('/api/ai/disconnect', 'POST', {}, true);
                      await cache.invalidateQueries({ queryKey: ['ai'] });
                    } catch (e) {
                      error(e);
                    }
                }}
              >
                Verbindung trennen
              </Button>
            )}
          </Group>
          {aiQuery.data?.sharing && (
            <Select
              style={{ flex: 1, minWidth: 0 }}
              label="Modell"
              value={state.current.model}
              comboboxProps={{ zIndex: 600 }}
              renderOption={({ option }) => (
                <Group wrap="nowrap" gap="sm" style={{ width: '100%', minWidth: 0 }}>
                  <Text size="sm" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                    {option.label}
                  </Text>
                  <ModelInfo
                    slug={option.value}
                    label={option.label}
                    metadata={catalog.find((item) => item.slug === option.value)}
                    lastRequest={aiQuery.data?.usage?.last_request}
                  />
                </Group>
              )}
              onChange={(value) => {
                setModel(value);
                try {
                  if (value) localStorage.setItem('phb-chatgpt-model', value);
                  else localStorage.removeItem('phb-chatgpt-model');
                } catch {}
              }}
              data={(models.data?.models || []).map((m: Row) => ({
                value: m.slug,
                label: m.title || m.name || m.slug,
              }))}
            />
          )}
          {models.error && (
            <Alert color="red">
              Die Modellliste konnte nicht geladen werden.{' '}
              <Button variant="subtle" onClick={() => void models.refetch()}>
                Erneut laden
              </Button>
            </Alert>
          )}
          <Alert color="yellow" title="Plannutzung und Credits">
            ChatGPT kann zusätzliche Credits verwenden, falls dies in deinem Konto erlaubt ist.
            Diese Einstellung kann die Anwendung nicht auslesen.{' '}
            <a href="https://chatgpt.com/#settings/usage" target="_blank" rel="noreferrer">
              Nutzung und Limits prüfen
            </a>
            .
          </Alert>
          <Checkbox
            label="Ich habe kostenpflichtige Credits für Apps deaktiviert und erlaube KI-Anfragen ausdrücklich."
            checked={!!aiQuery.data?.credits_acknowledged}
            disabled={!aiQuery.data?.sharing || !!aiQuery.data?.credits_acknowledged}
            onChange={async (e) => {
              if (e.target.checked)
                try {
                  await api('/api/ai/acknowledge-credits', 'POST', { acknowledged: true }, true);
                  await cache.invalidateQueries({ queryKey: ['ai'] });
                } catch (err) {
                  error(err);
                }
            }}
          />
          {aiQuery.data?.connected && (
            <Paper withBorder p="md">
              <Text fw={600} size="sm">
                Nutzung und Limits
              </Text>
              <Text size="sm">
                Verbleibende Tokens des ChatGPT-Plans sind über die Schnittstelle nicht zuverlässig
                abrufbar.
              </Text>
              <Stack mt="sm" gap="xs">
                <Text size="sm">
                  {aiQuery.data?.usage?.last_request?.total_tokens != null
                    ? 'Letzte Anfrage: ' +
                      new Intl.NumberFormat('de-DE').format(
                        aiQuery.data.usage.last_request.total_tokens,
                      ) +
                      ' Tokens (' +
                      aiQuery.data.usage.last_request.input_tokens +
                      ' Eingabe, ' +
                      aiQuery.data.usage.last_request.output_tokens +
                      ' Ausgabe)'
                    : 'Noch keine abgeschlossene Anfrage erfasst.'}
                </Text>
                <Text size="sm">
                  Lokal erfasst:{' '}
                  {new Intl.NumberFormat('de-DE').format(
                    aiQuery.data?.usage?.cumulative_tokens || 0,
                  )}{' '}
                  Tokens
                </Text>
                {aiQuery.data?.usage?.rate_limits?.token_remaining != null && (
                  <Text size="sm">
                    Aktuelles Token-Limit: {aiQuery.data.usage.rate_limits.token_remaining}{' '}
                    verbleibend · Reset{' '}
                    {aiQuery.data.usage.rate_limits.token_reset || 'nicht gemeldet'}
                  </Text>
                )}
                {aiQuery.data?.usage?.rate_limits?.request_remaining != null && (
                  <Text size="sm">
                    Anfragen: {aiQuery.data.usage.rate_limits.request_remaining} verbleibend · Reset{' '}
                    {aiQuery.data.usage.rate_limits.request_reset || 'nicht gemeldet'}
                  </Text>
                )}
              </Stack>
            </Paper>
          )}
          {aiQuery.data?.error && <Alert color="red">{aiQuery.data.error}</Alert>}
          {diagnostics.data?.available && (
            <Alert color="red" title="Anmeldung fehlgeschlagen">
              <Text size="sm">{diagnostics.data.diagnostic.explanation}</Text>
              <Text size="xs">
                Referenz: {diagnostics.data.diagnostic.reference} ·{' '}
                {diagnostics.data.diagnostic.phase} · {diagnostics.data.diagnostic.code}
              </Text>
            </Alert>
          )}
        </Stack>
      </Modal>
      <Modal
        zIndex={350}
        trapFocus={!confirming && !wait && !aiOpen}
        closeOnEscape={!confirming && !wait && !aiOpen}
        opened={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="Verarbeitung & Prüfung"
        closeOnClickOutside={false}
        size="lg"
      >
        <ScrollArea.Autosize mah="70vh">
          <Stack>
            {!jobs.length && <Text c="dimmed">Keine Aufträge vorhanden.</Text>}
            {jobs.map((job) => (
              <Paper key={job.id} withBorder p="md">
                <Group justify="space-between">
                  <Text fw={600} size="sm">
                    {job.filename}
                  </Text>
                  <Badge
                    color={
                      job.status === 'Fertig' ? 'teal' : job.status === 'Fehler' ? 'red' : 'gray'
                    }
                  >
                    {job.status}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" mt="xs">
                  {job.error || job.stage}
                </Text>
                <Group mt="sm">
                  {job.review_url && (
                    <Button
                      size="xs"
                      onClick={() => {
                        setQueueOpen(false);
                        navigate(job.review_url);
                      }}
                    >
                      Prüfen und bearbeiten
                    </Button>
                  )}
                  {['Fehler', 'Unterbrochen'].includes(job.status) && (
                    <Button size="xs" variant="light" onClick={() => retry(job)}>
                      Erneut versuchen
                    </Button>
                  )}
                  {!['Wartend', 'Läuft'].includes(job.status) && (
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={async () => {
                        try {
                          await api('/api/import-jobs/' + job.id + '/dismiss', 'POST');
                          await refreshJobs();
                        } catch (e) {
                          error(e);
                        }
                      }}
                    >
                      Ausblenden
                    </Button>
                  )}
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Modal>
      <Modal
        zIndex={450}
        opened={!!wait}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
      >
        <Stack align="center" py="xl">
          <Loader />
          <Text fw={600}>Dokument wird verarbeitet</Text>
          <Text size="sm" c="dimmed" ta="center">
            {wait}
          </Text>
        </Stack>
      </Modal>
    </>
  );
  return {
    ai: aiQuery.data || {},
    modelLabel,
    openAI: () => {
      setAiOpen(true);
      void cache.invalidateQueries({ queryKey: ['ai'] });
    },
    openQueue: () => setQueueOpen(true),
    queueLabel: active ? String(active) : completed ? String(completed) : '',
    overlays,
    bridge: bridge.current,
  };
}

import { BrandLogo } from './brand';
import { projectID, workspaceURL } from './project-context';
import { useQuery } from '@tanstack/react-query';
import { api } from './core';
import { useMediaQuery } from '@mantine/hooks';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AppShell,
  Group,
  Text,
  ActionIcon,
  Anchor,
  NavLink,
  Stack,
  Burger,
  Tooltip,
  Button,
  Badge,
  Select,
  Progress,
  Divider,
  useMantineColorScheme,
  LoadingOverlay,
  Alert,
} from '@mantine/core';
import {
  IconBuildingCottage,
  IconCalendar,
  IconChartBar,
  IconFiles,
  IconReceipt,
  IconBuildingBank,
  IconLeaf,
  IconUsers,
  IconDatabase,
  IconChevronLeft,
  IconChevronRight,
  IconSparkles,
  IconListCheck,
  IconLogout,
} from '@tabler/icons-react';
import { useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { error, hasWrites, useConfirm, Row } from './core';
import { useServices } from './services';
import { MasterData, Costs, Energy, Documents } from './pages';
import { WorkPage } from './work';
const items = [
  ['/', 'Bauzeitenplan', IconCalendar],
  ['/aufgaben', 'To-dos & Notizen', IconListCheck],
  ['/kosten', 'Kosten & Budget', IconChartBar],
  ['/angebote', 'Angebote', IconFiles],
  ['/belege', 'Rechnungen & Belege', IconReceipt],
  ['/finanzierung', 'Kredite & Eigenkapital', IconBuildingBank],
  ['/energieplanung', 'Energetische Planung', IconLeaf],
  ['/dokumente', 'Dokumente', IconFiles],
  ['/stammdaten', 'Stammdaten', IconUsers],
  ['/daten', 'Daten & Sicherung', IconDatabase],
] as const;
const navigationGroups = [
  { label: 'Projekt', paths: ['/', '/aufgaben'] },
  {
    label: 'Finanzen',
    paths: ['/kosten', '/angebote', '/belege', '/finanzierung', '/energieplanung'],
  },
  { label: 'Verwaltung', paths: ['/dokumente', '/stammdaten', '/daten'] },
];
const native = new Set(['/aufgaben', '/kosten', '/stammdaten', '/energieplanung', '/dokumente']);
const GuardContext = createContext<(guard: () => boolean) => () => void>(() => () => {});
export function useDirtyGuard(dirty: boolean) {
  const register = useContext(GuardContext);
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => register(() => ref.current), [register]);
}
export function App() {
  const projectInfo = useQuery({
    queryKey: ['current-project', projectID],
    queryFn: () => api('/api/projects/' + projectID),
  });
  const location = useLocation(),
    navigate = useNavigate(),
    ask = useConfirm();
  const [collapsed, setCollapsed] = useState(() => {
      try {
        return localStorage.getItem('phb-sidebar-collapsed') === '1';
      } catch {
        return false;
      }
    }),
    [mobile, setMobile] = useState(false);
  const small = useMediaQuery('(max-width:47.99em)'),
    mini = collapsed && !small;
  const [frames, setFrames] = useState<
      Record<string, { src: string; route: string; ready: boolean; previousSrc?: string }>
    >({}),
    [display, setDisplay] = useState<string | null>(null),
    [refreshing, setRefreshing] = useState<string | null>(null),
    [failed, setFailed] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLIFrameElement | null>>({}),
    guards = useRef<Set<() => boolean>>(new Set());
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const route = items.find((i) => i[0] === location.pathname),
    url = location.pathname + location.search + location.hash;
  const syncing = useRef<string | null>(null);
  const currentPath = useRef(location.pathname);
  currentPath.current = location.pathname;
  const go = useCallback((url: string) => navigate(url), [navigate]);
  const services = useServices(go);
  const register = useCallback((guard: () => boolean) => {
    guards.current.add(guard);
    return () => {
      guards.current.delete(guard);
    };
  }, []);
  const frameWindow = () => refs.current[currentPath.current]?.contentWindow as any;
  const busy = () => hasWrites() || services.bridge.busy() || !!frameWindow()?.PHBEmbed?.busy();
  const dirty = () => [...guards.current].some((g) => g()) || !!frameWindow()?.PHBEmbed?.dirty();
  const blocker = useBlocker(({ nextLocation }) =>
      syncing.current ===
      nextLocation.pathname.replace(/^\/p\/[1-9]\d*(?=\/)/, '') +
        nextLocation.search +
        nextLocation.hash
        ? false
        : busy() || dirty(),
    ),
    asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    (async () => {
      if (frameWindow()?.PHBEmbed?.prompting()) {
        blocker.reset();
        asking.current = false;
        return;
      }
      if (busy()) {
        await ask({
          title: 'Vorgang läuft',
          cancel: false,
          message:
            'Bitte warte auf das Ergebnis der laufenden Verarbeitung, bevor du die Ansicht wechselst.',
        });
        blocker.reset();
      } else if (await ask('Ungespeicherte Änderungen verwerfen und die Ansicht wechseln?')) {
        frameWindow()?.PHBEmbed?.discard();
        blocker.proceed();
      } else blocker.reset();
      asking.current = false;
    })();
  }, [blocker.state]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (busy() || dirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });
  useEffect(() => {
    try {
      localStorage.setItem('phb-sidebar-collapsed', collapsed ? '1' : '0');
    } catch {}
  }, [collapsed]);
  function refreshFrame(path: string) {
    try {
      const embedded = (refs.current[path]?.contentWindow as any)?.PHBEmbed;
      const promise = embedded?.refresh();
      if (promise) {
        setRefreshing(path);
        Promise.resolve(promise)
          .then(() => (currentPath.current === path ? embedded.activate?.() : undefined))
          .catch(error)
          .finally(() => setRefreshing((current) => (current === path ? null : current)));
      }
    } catch (e) {
      error(e);
    }
  }
  useEffect(() => {
    setMobile(false);
    setFailed(null);
    document.title = (route?.[1] || 'Projekt') + ' · ProjectHouseBuilder';
    if (native.has(location.pathname)) {
      setDisplay(null);
      return;
    }
    if (!route) return;
    if (frames[location.pathname]?.previousSrc === url) {
      setFrames((previous) => ({
        ...previous,
        [location.pathname]: { src: url, route: url, ready: true },
      }));
      setDisplay(location.pathname);
      return;
    }
    if (frames[location.pathname]?.ready && frames[location.pathname]?.src === url) {
      setFrames((previous) => ({
        ...previous,
        [location.pathname]: { ...previous[location.pathname], route: url },
      }));
      setDisplay(location.pathname);
      refreshFrame(location.pathname);
      return;
    }
    setFrames((previous) => {
      const old = previous[location.pathname];
      if (old?.route === url) return previous;
      return {
        ...previous,
        [location.pathname]: {
          src: url,
          route: url,
          ready: false,
          previousSrc: old?.ready ? old.src : old?.previousSrc,
        },
      };
    });
    if (frames[location.pathname]?.route === url && frames[location.pathname]?.ready) {
      setDisplay(location.pathname);
      refreshFrame(location.pathname);
    }
  }, [url]);
  useEffect(() => {
    try {
      localStorage.setItem('phb-color-mode-v1', colorScheme);
    } catch {}
    Object.values(refs.current).forEach((f) =>
      (f?.contentWindow as any)?.PHBUI?.setTheme(colorScheme === 'auto' ? 'system' : colorScheme),
    );
  }, [colorScheme]);
  useEffect(() => {
    Object.values(refs.current).forEach((f) => {
      try {
        f?.contentDocument?.dispatchEvent(
          new CustomEvent('phb-ai-status', { detail: services.ai }),
        );
      } catch {}
    });
  }, [services.ai]);
  useEffect(() => {
    services.bridge.ready = (source: Window, path: string) => {
      if (refs.current[path]?.contentWindow !== source) return;
      setFrames((previous) => ({
        ...previous,
        [path]: { ...previous[path], ready: true, previousSrc: undefined },
      }));
      setFailed((current) => (current === path ? null : current));
      if (currentPath.current === path) setDisplay(path);
    };
    services.bridge.theme = () => colorScheme;
    services.bridge.sync = (value: string) => {
      const path = new URL(value, window.location.origin).pathname;
      setFrames((previous) =>
        previous[path] ? { ...previous, [path]: { ...previous[path], route: value } } : previous,
      );
      if (currentPath.current === path) {
        syncing.current = value;
        Promise.resolve(navigate(value, { replace: true })).finally(() => {
          syncing.current = null;
        });
      }
    };
  }, [services.bridge, colorScheme]);
  const pending =
    !native.has(location.pathname) &&
    !!route &&
    (!frames[location.pathname]?.ready ||
      display !== location.pathname ||
      refreshing === location.pathname);
  return (
    <GuardContext.Provider value={register}>
      <AppShell
        header={{ height: { base: 64, sm: 70 } }}
        navbar={{
          width: { base: 254, sm: mini ? 78 : 254 },
          breakpoint: 'sm',
          collapsed: { mobile: !mobile },
        }}
        padding={0}
      >
        <AppShell.Navbar className="app-sidebar" p={mini ? 'xs' : 'md'}>
          <Group justify={mini ? 'center' : 'space-between'} wrap="nowrap" h={52}>
            <Anchor
              href="/"
              aria-label="Alle Projekte"
              title="Zur Projektübersicht"
              c="inherit"
              underline="never"
              style={{ minWidth: 0 }}
            >
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <IconBuildingCottage size={29} />
                {!mini && (
                  <Text
                    fw={700}
                    size="sm"
                    className="app-brand"
                    lineClamp={2}
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {projectInfo.data?.project?.title ||
                      (projectInfo.isError ? 'Projekt nicht verfügbar' : 'Projekt wird geladen …')}
                  </Text>
                )}
              </Group>
            </Anchor>
          </Group>
          <Divider color="var(--brand-line)" my="md" />
          <Stack gap="xs" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {navigationGroups.map((group, index) => (
              <section key={group.label} aria-label={group.label}>
                {mini ? (
                  index > 0 && <Divider color="var(--brand-line)" mb="sm" />
                ) : (
                  <Text className="sidebar-group-label" size="xs" fw={700} mb={4} px="sm">
                    {group.label}
                  </Text>
                )}
                {items
                  .filter(([path]) => group.paths.includes(path))
                  .map(([path, label, Icon]) => (
                    <Tooltip key={path} label={label} disabled={!mini} position="right">
                      <NavLink
                        component="a"
                        href={workspaceURL(path)}
                        onClick={(e) => {
                          if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                            e.preventDefault();
                            navigate(path);
                          }
                        }}
                        label={mini ? undefined : label}
                        leftSection={<Icon size={20} />}
                        active={location.pathname === path}
                        aria-label={label}
                        styles={{
                          root: {
                            justifyContent: mini ? 'center' : undefined,
                            padding: mini ? '8px' : '6px 12px',
                          },
                          section: { marginRight: mini ? 0 : undefined },
                        }}
                      />
                    </Tooltip>
                  ))}
              </section>
            ))}
          </Stack>
          <Group justify={mini ? 'center' : 'space-between'} mt="md">
            <Tooltip label={mini ? 'Sidebar ausklappen' : 'Sidebar einklappen'}>
              <ActionIcon
                aria-label={mini ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
                variant="subtle"
                color="gray"
                visibleFrom="sm"
                onClick={() => setCollapsed(!collapsed)}
              >
                {mini ? <IconChevronRight size={19} /> : <IconChevronLeft size={19} />}
              </ActionIcon>
            </Tooltip>
            <form action="/logout" method="post">
              <Tooltip label="Abmelden">
                <ActionIcon type="submit" variant="subtle" color="gray" aria-label="Abmelden">
                  <IconLogout size={19} />
                </ActionIcon>
              </Tooltip>
            </form>
          </Group>
        </AppShell.Navbar>
        <AppShell.Header px={{ base: 15, sm: 26 }}>
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <Burger
                aria-label={mobile ? 'Navigation schließen' : 'Navigation öffnen'}
                opened={mobile}
                onClick={() => setMobile(!mobile)}
                hiddenFrom="sm"
                size="sm"
              />
              <div>
                <BrandLogo />
                <Text size="sm" fw={650}>
                  {route?.[1] || 'Projekt'}
                </Text>
              </div>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Select
                aria-label="Darstellung"
                value={colorScheme}
                onChange={(v) => setColorScheme((v || 'auto') as any)}
                size="xs"
                w={96}
                visibleFrom="md"
                data={[
                  { value: 'auto', label: 'System' },
                  { value: 'light', label: 'Hell' },
                  { value: 'dark', label: 'Dunkel' },
                ]}
              />
              <Tooltip label="ChatGPT-Verbindung">
                <Button
                  aria-label="ChatGPT-Verbindung"
                  size="xs"
                  variant={services.ai.sharing ? 'light' : 'default'}
                  leftSection={<IconSparkles size={16} />}
                  onClick={services.openAI}
                >
                  <Text size="xs" visibleFrom="sm">
                    ChatGPT
                  </Text>
                  {services.ai.sharing && (
                    <Badge size="xs" ml={5}>
                      ✓
                    </Badge>
                  )}
                </Button>
              </Tooltip>
              <Tooltip label="Verarbeitung & Prüfung">
                <Button
                  size="xs"
                  variant="default"
                  aria-label="Warteschlange"
                  leftSection={<IconListCheck size={16} />}
                  onClick={services.openQueue}
                >
                  {services.queueLabel || (
                    <Text size="xs" visibleFrom="md">
                      Warteschlange
                    </Text>
                  )}
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Main className="app-main">
          {projectInfo.error && (
            <Alert color="red" m="lg" title="Projekt nicht verfügbar">
              <Text size="sm">
                Das Projekt wurde nicht gefunden oder konnte nicht geladen werden.
              </Text>
              <Button component="a" href="/" mt="sm" variant="light">
                Zur Projektübersicht
              </Button>
            </Alert>
          )}
          <div
            style={{
              display: native.has(location.pathname) ? 'block' : 'none',
            }}
          >
            {location.pathname === '/aufgaben' ? (
              <WorkPage />
            ) : location.pathname === '/stammdaten' ? (
              <MasterData />
            ) : location.pathname === '/kosten' ? (
              <Costs />
            ) : location.pathname === '/energieplanung' ? (
              <Energy />
            ) : location.pathname === '/dokumente' ? (
              <Documents />
            ) : null}
          </div>
          {!native.has(location.pathname) && !route && (
            <div className="page">
              <Text>Diese Ansicht wurde nicht gefunden.</Text>
              <Button mt="md" onClick={() => navigate('/')}>
                Zum Bauzeitenplan
              </Button>
            </div>
          )}
          {failed === location.pathname && (
            <Alert color="red" m="lg" title="Ansicht konnte nicht geladen werden">
              <Text size="sm">
                Die Verbindung oder ein benötigter Bestandteil der Ansicht war nicht verfügbar. Du
                kannst erneut laden oder über die Sidebar einen anderen Bereich öffnen.
              </Text>
              <Button
                mt="sm"
                variant="light"
                color="red"
                onClick={() => {
                  setFailed(null);
                  const target = new URL(url, window.location.origin);
                  target.searchParams.set('_react_retry', String(Date.now()));
                  setFrames((previous) => ({
                    ...previous,
                    [location.pathname]: {
                      ...previous[location.pathname],
                      src: target.pathname + target.search + target.hash,
                      ready: false,
                    },
                  }));
                }}
              >
                Erneut laden
              </Button>
            </Alert>
          )}
          <div
            className="frame-zone"
            inert={pending}
            style={{
              display: native.has(location.pathname) ? 'none' : undefined,
            }}
          >
            {pending && failed !== location.pathname && (
              <Progress className="frame-progress" value={100} animated size={3} />
            )}
            {Object.entries(frames).map(([path, frame]) => (
              <div key={path} className="frame-slot" hidden={display !== path}>
                {[
                  ...(frame.previousSrc && !frame.ready && frame.previousSrc !== frame.src
                    ? [frame.previousSrc]
                    : []),
                  frame.src,
                ].map((src) => (
                  <iframe
                    key={src}
                    ref={
                      src === frame.src
                        ? (node) => {
                            refs.current[path] = node;
                          }
                        : undefined
                    }
                    hidden={src === frame.src && !frame.ready}
                    className="workflow-frame"
                    title={items.find((i) => i[0] === path)?.[1] || path}
                    src={classicURL(src)}
                    onLoad={(event) => {
                      const node = event.currentTarget;
                      if (refs.current[path] !== node) return;
                      try {
                        if (node.contentWindow?.location.href === 'about:blank') return;
                        if (node.contentWindow?.location.pathname === '/login')
                          window.location.assign('/login');
                        else if (!(node.contentWindow as any)?.PHBEmbed) setFailed(path);
                      } catch {
                        setFailed(path);
                      }
                    }}
                  />
                ))}
              </div>
            ))}
            {pending && !display && failed !== location.pathname && (
              <LoadingOverlay visible overlayProps={{ blur: 0, backgroundOpacity: 0.8 }} />
            )}
          </div>
        </AppShell.Main>
        {services.overlays}
      </AppShell>
    </GuardContext.Provider>
  );
}
function classicURL(value: string) {
  const url = new URL(value, location.origin);
  url.searchParams.set('_classic', '1');
  url.searchParams.set('_embedded', '1');
  url.searchParams.set('project_id', String(projectID));
  return url.pathname + url.search + url.hash;
}

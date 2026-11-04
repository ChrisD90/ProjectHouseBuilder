import { createTheme, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import '../../static/components.css';
import '../../static/palette.css';
import '../../static/request.js';
import { DialogProvider } from './core';
import { workspaceBase } from './project-context';
import { ProjectDashboard } from './projects';
import { App } from './shell';
import './style.css';
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20000, refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: false },
  },
});
const theme = createTheme({
  primaryColor: 'teal',
  // Green accents and cool forest surfaces match the shared workflow palette.
  colors: {
    teal: [
      '#f2f7e9',
      '#e5efcf',
      '#d0e2ac',
      '#b5cf81',
      '#99b957',
      '#7c9f32',
      '#527c1c',
      '#416317',
      '#34501a',
      '#263e17',
    ],
    dark: [
      '#eef4ef',
      '#cfddd4',
      '#94a79c',
      '#43595a',
      '#304346',
      '#1d3032',
      '#192c2d',
      '#152426',
      '#0c181a',
      '#081214',
    ],
  },
  defaultRadius: 'md',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: { fontWeight: '650' },
  components: {
    Accordion: { defaultProps: { chevronPosition: 'left' } },
    Modal: {
      defaultProps: {
        closeOnClickOutside: false,
        closeButtonProps: { 'aria-label': 'Schließen' },
      },
    },
    Button: { defaultProps: { fw: 600 } },
  },
});
createRoot(document.getElementById('root')!).render(
  <MantineProvider
    theme={theme}
    defaultColorScheme="auto"
    cssVariablesResolver={() => ({
      variables: {},
      light: {
        '--mantine-color-body': 'var(--brand-surface)',
        '--mantine-color-text': 'var(--brand-ink)',
        '--mantine-color-dimmed': 'var(--brand-muted)',
        '--mantine-color-placeholder': 'var(--brand-muted-light)',
        '--mantine-color-default': 'var(--brand-surface)',
        '--mantine-color-default-hover': 'var(--brand-soft)',
        '--mantine-color-default-border': 'var(--brand-line)',
        '--mantine-primary-color-filled': 'var(--brand-button)',
        '--mantine-primary-color-filled-hover': 'var(--brand-button-hover)',
      },
      dark: {
        '--mantine-color-body': 'var(--brand-surface)',
        '--mantine-color-text': 'var(--brand-ink)',
        '--mantine-color-dimmed': 'var(--brand-muted)',
        '--mantine-color-placeholder': 'var(--brand-muted-light)',
        '--mantine-color-default': 'var(--brand-raised)',
        '--mantine-color-default-hover': 'var(--brand-soft)',
        '--mantine-color-default-border': 'var(--brand-line)',
        '--mantine-primary-color-filled': 'var(--brand-button)',
        '--mantine-primary-color-filled-hover': 'var(--brand-button-hover)',
        '--mantine-primary-color-light-color': 'var(--brand-accent)',
      },
    })}
  >
    <Notifications position="bottom-right" />
    <QueryClientProvider client={client}>
      <DialogProvider>
        <RouterProvider
          router={createBrowserRouter(
            [
              {
                path: '*',
                element:
                  !workspaceBase && ['/', '/projekte'].includes(window.location.pathname) ? (
                    <ProjectDashboard />
                  ) : (
                    <App />
                  ),
              },
            ],
            { basename: workspaceBase || '/' },
          )}
        />
      </DialogProvider>
    </QueryClientProvider>
  </MantineProvider>,
);

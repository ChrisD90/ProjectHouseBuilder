import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { DialogProvider } from './core';
import { App } from './shell';
import { ProjectDashboard } from './projects';
import { workspaceBase } from './project-context';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import './style.css';
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20000, refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: false },
  },
});
const theme = createTheme({
  primaryColor: 'teal',
  // Match the blue-gray surfaces of the retained workflow documents.
  colors: {
    dark: [
      '#eef6f8',
      '#d0dfe5',
      '#9db2bd',
      '#425667',
      '#334353',
      '#233242',
      '#1c2835',
      '#101822',
      '#0d151e',
      '#09121b',
    ],
  },
  defaultRadius: 'md',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: { fontWeight: '650' },
  components: {
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
      light: {},
      dark: {
        '--mantine-color-body': '#1c2835',
        '--mantine-color-text': '#eef6f8',
        '--mantine-color-dimmed': '#aec0ca',
        '--mantine-color-placeholder': '#9db2bd',
        '--mantine-color-default': '#233242',
        '--mantine-color-default-hover': '#2b3b4b',
        '--mantine-color-default-border': '#334353',
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

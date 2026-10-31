import React from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { DialogProvider } from './core';
import { App } from './shell';
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
  <MantineProvider theme={theme} defaultColorScheme="auto">
    <Notifications position="bottom-right" />
    <QueryClientProvider client={client}>
      <DialogProvider>
        <RouterProvider router={createBrowserRouter([{ path: '*', element: <App /> }])} />
      </DialogProvider>
    </QueryClientProvider>
  </MantineProvider>,
);

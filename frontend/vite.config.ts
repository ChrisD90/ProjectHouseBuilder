import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/static/react/',
  build: { outDir: '../static/react', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5055',
      '/auth': 'http://127.0.0.1:5055',
      '/logout': 'http://127.0.0.1:5055',
      '/static': 'http://127.0.0.1:5055',
      '^/(?:$|\\?|kosten(?:\\?|$)|angebote(?:\\?|$)|belege(?:\\?|$)|finanzierung(?:\\?|$)|energieplanung(?:\\?|$)|stammdaten(?:\\?|$)|dokumente(?:\\?|$)|daten(?:\\?|$))':
        {
          target: 'http://127.0.0.1:5055',
          // Only retained workflow documents go to Flask. React navigation stays in Vite.
          bypass(request) {
            return new URL(request.url || '/', 'http://127.0.0.1').searchParams.get('_classic') ===
              '1'
              ? undefined
              : '/index.html';
          },
        },
    },
  },
}));

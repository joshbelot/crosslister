import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
        // src/web/api/*.ts are source modules that Vite itself must serve, not API calls.
        bypass: (req) => (/^\/api\/[A-Za-z]+\.ts(\?|$)/.test(req.url ?? '') ? req.url : undefined),
      },
    },
  },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});

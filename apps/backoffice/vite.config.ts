import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/v1': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

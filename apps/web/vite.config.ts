import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    tsconfigRaw: {
      compilerOptions: { jsx: 'react-jsx', useDefineForClassFields: true },
    },
  },
  server: {
    port: 3012,
    proxy: {
      '/api': 'http://localhost:3011',
      '/flows': 'http://localhost:3011',
      '/tasks': 'http://localhost:3011',
      '/notifications': 'http://localhost:3011',
      '/runtime': 'http://localhost:3011',
    },
  },
  build: {
    outDir: '../../dist/apps/web',
    emptyOutDir: true,
  },
});

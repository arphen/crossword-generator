import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { labApi } from './server';

export default defineConfig({
  plugins: [react(), labApi()],
  worker: { format: 'es' },
  build: { sourcemap: true },
});

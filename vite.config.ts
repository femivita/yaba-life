import { defineConfig } from 'vite';

// `base` is relative so the build works on GitHub Pages or any sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  worker: { format: 'es' },
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two outputs:
 *   npm run build         static site (dist/)
 *   npm run build:single  one index.html (dist-single/) with the worker inlined as a blob
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
  ],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    // Single-file mode: no code splitting, no separate assets
    ...(mode === 'single' ? { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 100_000 } : {}),
  },
  worker: {
    // The worker is imported with ?worker&inline; iife is required for blob URLs
    format: 'iife',
  },
}));

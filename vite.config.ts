import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two outputs:
 *   npm run build         static site (dist/), code-split: the legal texts, the QR
 *                         encoder and the panels are fetched on demand
 *   npm run build:single  one index.html (dist-single/) with the worker inlined as a blob.
 *                         `inlineDynamicImports` folds every dynamic chunk back into the single
 *                         script vite-plugin-singlefile needs; the `import()` calls stay in the
 *                         source, so the web build keeps splitting.
 */
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'single' ? [viteSingleFile({ removeViteModuleLoader: true })] : []),
  ],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    // Both builds target browsers that already have dynamic import and modern class syntax;
    // a lower target only buys downlevelling helpers nobody here needs.
    target: 'es2022',
    // Single-file mode: no code splitting, no separate assets
    ...(mode === 'single'
      ? {
          assetsInlineLimit: 100_000_000,
          chunkSizeWarningLimit: 100_000,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {}),
  },
  worker: {
    // The worker is imported with ?worker&inline; iife is required for blob URLs
    format: 'iife',
  },
}));

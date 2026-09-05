import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two outputs:
 *   npm run build         static site (dist/), code-split: the legal texts, the QR
 *                         encoder and the panels are fetched on demand
 *   npm run build:single  one index.html (dist-single/), no worker thread.
 *                         `inlineDynamicImports` folds every dynamic chunk back into the single
 *                         script vite-plugin-singlefile needs; the `import()` calls stay in the
 *                         source, so the web build keeps splitting.
 */

const sameThreadWorker = fileURLToPath(new URL('./src/worker/sameThread.ts', import.meta.url));

/**
 * Single-file only: resolve `analyze.worker?worker&inline` to the same-thread stand-in.
 *
 * `?worker&inline` compiles the worker as its own rollup chunk and embeds it as an escaped
 * string literal — a second, separately minified copy of core that gzip cannot fold into the
 * first (~54 KB gzip, measured). The stand-in runs the identical handler on the UI thread, so
 * there is still one `job`, one progress stream and one stop button; `handler.ts` takes a
 * `yieldFn` for exactly this case. The web build is untouched and keeps its worker thread.
 */
function singleFileWorkerOnMainThread(): Plugin {
  return {
    name: 'wc:worker-same-thread',
    enforce: 'pre',
    resolveId(source) {
      return source.endsWith('/analyze.worker?worker&inline') ? sameThreadWorker : null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === 'single'
      ? [singleFileWorkerOnMainThread(), viteSingleFile({ removeViteModuleLoader: true })]
      : []),
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
          // Not `cssMinify: 'lightningcss'`: measured against the esbuild output it saves
          // 67 B gzip, which does not pay for a second CSS engine in the release path.
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {}),
  },
  worker: {
    // The worker is imported with ?worker&inline; iife is required for blob URLs
    format: 'iife',
  },
}));

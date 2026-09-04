import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

// .env.local holds machine-local paths (WC_LOCAL_CORPUS, sample files). Tests read them from
// process.env and skip themselves when unset, so nothing personal has to live in the repository.
Object.assign(process.env, loadEnv('', process.cwd(), 'WC_'));

export default defineConfig({
  test: {
    // server/test exists only in the private repository; the public mirror simply has none
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'server/test/**/*.test.ts'],
    environment: 'node',
    // Server / progress tests start real HTTP servers; allow for a busy machine
    testTimeout: 20_000,
    // No file-level parallelism: the server tests spawn vite-node processes and time out under CPU contention
    fileParallelism: false,
  },
});

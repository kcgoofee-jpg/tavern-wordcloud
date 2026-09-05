/// <reference lib="webworker" />
/**
 * Worker wiring. All of the logic is in `handler.ts` so the single-file build can run the
 * same handler on the UI thread (`sameThread.ts`) instead of shipping a second, separately
 * minified copy of core inside an inlined worker blob.
 */
import { createHandler, type WorkerRequest } from './handler';

export type {
  WorkerProgress,
  WorkerRequest,
  WorkerRequestBody,
  WorkerResponse,
  WorkerResult,
} from './handler';

// No `yieldFn`: on a worker thread there is nothing to yield to.
const handle = createHandler((msg) => self.postMessage(msg));

self.onmessage = (e: MessageEvent<WorkerRequest>) => { void handle(e.data); };

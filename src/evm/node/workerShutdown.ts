import { Worker } from "node:worker_threads";

// Workers exit by draining naturally: after replying to dispose the worker
// closes every handle it still holds (see closeWorkerBootstrapPort) and the
// thread ends once the last close callback has run. Nothing may force-stop a
// worker loop — parent-side terminate(), worker-side process.exit(), or
// exiting the process while a worker thread is still alive all abort the
// whole process with "uv_loop_close() while having open handles" when close
// callbacks are pending (observed on Node 22.12 and 22.17 under
// parallel-test load). That is also why this wait has no timeout: abandoning
// a live worker only converts a slow drain into that abort at process exit,
// while a genuinely stuck drain surfaces here as a visible hang that names
// the leaking teardown.
export function createWorkerShutdown(worker: Worker): () => Promise<void> {
    return () =>
        new Promise<void>((resolve) => {
            if (worker.threadId === -1) return resolve();
            worker.once("exit", () => resolve());
        });
}

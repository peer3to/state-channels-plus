import { Worker } from "node:worker_threads";

// Workers exit by draining naturally: after replying to dispose the worker
// closes every handle it still holds (see closeRootWorker) and the
// thread ends once the last close callback has run. Nothing may force-stop a
// worker loop from outside - parent-side terminate(), or exiting the process
// while a worker thread is still alive - or the whole process aborts with
// "uv_loop_close() while having open handles" when the worker still holds
// native handles (udx/hyperswarm sockets; observed on Node 22.12 and 22.17
// under parallel-test load). A worker's own process.exit() is different: node
// closes that thread's handles and ends only that thread. That is why this
// wait has no timeout of its own: the bound lives in the worker. A disposed
// root worker whose loop has not drained after ROOT_WORKER_DRAIN_TIMEOUT_MS
// reports what still holds it and exits itself with
// ROOT_WORKER_DRAIN_TIMEOUT_EXIT_CODE, and the parent logs that as a warning.
export function createWorkerShutdown(worker: Worker): () => Promise<void> {
    return () =>
        new Promise<void>((resolve) => {
            if (worker.threadId === -1) return resolve();
            worker.once("exit", () => resolve());
        });
}

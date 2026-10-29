// @spec-test-coverage-ignore: real worker shutdown staging
import { Worker } from "node:worker_threads";

/** Worker that closes its port on request, draining its loop naturally. */
export function createDrainingWorker(): Worker {
    return new Worker(
        `
            const { parentPort } = require("node:worker_threads");
            parentPort.once("message", () => parentPort.close());
        `,
        { eval: true }
    );
}

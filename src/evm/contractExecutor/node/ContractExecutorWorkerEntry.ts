import { parentPort } from "node:worker_threads";
import { realmLogFlushBus } from "@/utils/logging/LogFlushBus";
import { startContractExecutorWorkerHost } from "../worker/ContractExecutorWorkerHostCore";
import type {
    WorkerHostMessage,
    WorkerRequestMessage
} from "../worker/protocol";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

const port = parentPort;

// This worker's logger installs crash hooks so a VM failure uploads its logs.
// Any uncaughtException listener also suppresses node's fatal default, which
// would leave the thread alive and the parent's pending calls hanging forever.
// Collect first, then end the thread so the parent sees a non-zero exit.
const endThreadAfterCollecting = (reason: string) => () => {
    // deferred past this listener chain: the logger's own hook records the
    // failure in a later listener, and collecting before it ran would ship an
    // empty round and then kill the thread mid-upload
    setImmediate(() => {
        // ask every realm to upload, but wait only for this one's POST. the
        // realms across the port are still running and finish on their own,
        // so their acks would only delay the exit
        void realmLogFlushBus.flushAll(reason).catch(() => undefined);
        void realmLogFlushBus
            .flushOwnRealm()
            .catch(() => undefined)
            .finally(() => process.exit(1));
    });
};
process.on(
    "uncaughtException",
    endThreadAfterCollecting("vm uncaughtException")
);
process.on(
    "unhandledRejection",
    endThreadAfterCollecting("vm unhandledRejection")
);

startContractExecutorWorkerHost(
    (response: WorkerHostMessage) => port.postMessage(response),
    (handler: (message: WorkerRequestMessage) => void) => {
        port.on("message", handler);
    },
    // Close the port so the drained loop can exit naturally (see
    // workerShutdown.ts for why the loop must never be force-stopped).
    () => port.close()
);

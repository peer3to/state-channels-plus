import { parentPort } from "node:worker_threads";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import { realmLogFlushBus } from "@/utils/logging/LogFlushBus";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { ContractExecutorRoot } from "../rpc/ContractExecutorRoot";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

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

// the whole protocol: this root, over the parent port
const router = new PortRpcRouter<ContractExecutorRoot>(
    (self) => new ContractExecutorRoot(self),
    // the worker's logger exists once init brought the config
    undefined
);
router.attach(adaptWorkerScope());

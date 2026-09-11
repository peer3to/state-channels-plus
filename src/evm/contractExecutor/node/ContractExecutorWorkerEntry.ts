import { onUnhandledWorkerError } from "../../p2pRuntime/node/P2pRuntimeWorkerRuntime";
import type { ContractExecutorClientRoot } from "../rpc/ContractExecutorClientRoot";
import { ContractExecutorRoot } from "../rpc/ContractExecutorRoot";
import { RpcRouter } from "@/rpc/RpcRouter";
import { serializeError } from "@/rpc/serializeError";
import MessagePortTransport from "@/transport/MessagePortTransport";
import { realmLogFlushBus } from "@/utils/logging/LogFlushBus";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { parentPort } from "node:worker_threads";

if (!parentPort) {
    throw new Error("Contract executor worker host requires a parent port");
}

// the whole protocol: this root, over the parent port
const router = new RpcRouter<ContractExecutorRoot, ContractExecutorClientRoot>(
    (self) => new ContractExecutorRoot(self),
    // the worker's logger exists once init brought the config
    undefined
);
// the thread that spawned this worker is its parent realm
new MessagePortTransport(adaptWorkerScope(), router, "parent");
const owner = router.remoteRpc;

// Same policy as the sdk worker: an error outside a request is reported to
// the owner and the worker keeps serving. The funnel is registered here, with
// the line already up, so a load-time failure is reportable too.
onUnhandledWorkerError((error) => {
    owner.workerErrors.detachedError(serializeError(error)).sendOne();
    // deferred past this listener chain: the logger's own hook records the
    // failure in a later listener, and collecting before it ran would ship an
    // empty round. every realm uploads; nothing waits on the acks, because the
    // thread stays alive and keeps answering calls
    setImmediate(() => {
        void realmLogFlushBus
            .flushAll("vm detached error")
            .catch(() => undefined);
    });
});

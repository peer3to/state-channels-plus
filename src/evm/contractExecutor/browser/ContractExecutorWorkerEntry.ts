// the evm stack reads node globals; in place before anything boots it
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";
import { onUnhandledWorkerError } from "../../p2pRuntime/browser/P2pRuntimeWorkerRuntime";
import type { ContractExecutorClientRoot } from "../rpc/ContractExecutorClientRoot";
import { ContractExecutorRoot } from "../rpc/ContractExecutorRoot";
import { RpcRouter } from "@/rpc/RpcRouter";
import { serializeError } from "@/rpc/serializeError";
import MessagePortTransport from "@/transport/MessagePortTransport";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { Buffer } from "buffer";

(globalThis as { Buffer?: typeof Buffer }).Buffer ||= Buffer;

// the whole protocol: this root, over the worker's own scope
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
});

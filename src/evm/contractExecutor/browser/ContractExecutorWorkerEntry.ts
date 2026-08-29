// the evm stack reads node globals; in place before anything boots it
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";
import { onUnhandledWorkerError } from "../../p2pRuntime/browser/P2pRuntimeWorkerRuntime";
import {
    CONTRACT_EXECUTOR_CLIENT_MANIFEST,
    type ContractExecutorClientRoot
} from "../rpc/ContractExecutorClientRoot";
import { ContractExecutorRoot } from "../rpc/ContractExecutorRoot";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import { serializeError } from "@/rpc/serializeError";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { Buffer } from "buffer";

(globalThis as { Buffer?: typeof Buffer }).Buffer ||= Buffer;

// the whole protocol: this root, over the worker's own scope
const router = new PortRpcRouter<ContractExecutorRoot>(
    (self) => new ContractExecutorRoot(self),
    // the worker's logger exists once init brought the config
    undefined
);
const transport = router.attach(adaptWorkerScope());
const owner = router.endpoint<ContractExecutorClientRoot>(
    transport,
    CONTRACT_EXECUTOR_CLIENT_MANIFEST
);

// Same policy as the sdk worker: an error outside a request is reported to
// the owner and the worker keeps serving. The funnel is registered here, with
// the line already up, so a load-time failure is reportable too.
onUnhandledWorkerError((error) => {
    owner.workerErrors.detachedError(serializeError(error)).sendOne();
});

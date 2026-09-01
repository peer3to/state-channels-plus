// the evm stack reads node globals; in place before anything boots it
import "@/evm/p2pRuntime/worker/nodeGlobalsShim";
import { Buffer } from "buffer";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { ContractExecutorRoot } from "../rpc/ContractExecutorRoot";

(globalThis as { Buffer?: typeof Buffer }).Buffer ||= Buffer;

// the whole protocol: this root, over the worker's own scope
const router = new PortRpcRouter<ContractExecutorRoot>(
    (self) => new ContractExecutorRoot(self),
    // the worker's logger exists once init brought the config
    undefined
);
router.attach(adaptWorkerScope());

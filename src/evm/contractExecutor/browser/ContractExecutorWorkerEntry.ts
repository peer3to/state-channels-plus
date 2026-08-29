import PortRpcRouter from "@/rpc/PortRpcRouter";
import { adaptWorkerScope } from "@platform/p2pRuntimeChannel";
import { ContractExecutorRoot } from "../rpc/ContractExecutorRoot";

// the whole protocol: this root, over the worker's own scope
const router = new PortRpcRouter<ContractExecutorRoot>(
    (self) => new ContractExecutorRoot(self),
    // the worker's logger exists once init brought the config
    undefined
);
router.attach(adaptWorkerScope());

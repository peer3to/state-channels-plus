import ARpcService from "@/rpc/ARpcService";
import type PortRpcRouter from "@/rpc/PortRpcRouter";
import type ATransport from "@/transport/ATransport";
import type { Logger } from "@/utils/logging/Logger";
import type ContractExecutor from "../../ContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import { ContractExecutorRpcMethods } from "./ContractExecutorRpcMethods";

/** the worker's executor and what it holds around it, from init to dispose */
export class ContractExecutorService extends ARpcService<
    ContractExecutorRpcMethods,
    PortRpcRouter<ContractExecutorRoot>
> {
    executor?: ContractExecutor;
    workerLogger?: Logger;
    removeLink?: () => void;

    constructor(router: PortRpcRouter<ContractExecutorRoot>) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): ContractExecutorRpcMethods {
        return new ContractExecutorRpcMethods(transport, this);
    }
}

export default ContractExecutorService;

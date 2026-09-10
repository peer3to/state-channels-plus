import type { ContractExecutorClientRoot } from "../ContractExecutorClientRoot";
import { WorkerErrorsRpcMethods } from "./WorkerErrorsRpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type ATransport from "@/transport/ATransport";

/** where a report from the worker goes once it is back on the owning thread */
export type WorkerErrorSink = {
    onDetachedError(error: Error): void;
};

/** the vm worker's one-way traffic to its owner: nothing here is answered */
export class WorkerErrorsService extends ARpcService<
    WorkerErrorsRpcMethods,
    RpcRouter<ContractExecutorClientRoot, any>
> {
    constructor(
        router: RpcRouter<ContractExecutorClientRoot, any>,
        readonly sink: WorkerErrorSink
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): WorkerErrorsRpcMethods {
        return new WorkerErrorsRpcMethods(transport, this);
    }
}

export default WorkerErrorsService;

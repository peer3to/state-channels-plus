import type { ContractExecutorClientRoot } from "../ContractExecutorClientRoot";
import type { WorkerErrorsService } from "./WorkerErrorsService";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import { deserializeError, type SerializedError } from "@/rpc/serializeError";
import type ATransport from "@/transport/ATransport";

export class WorkerErrorsRpcMethods extends ARpcMethods<
    RpcRouter<ContractExecutorClientRoot, any>
> {
    constructor(
        transport: ATransport,
        private readonly service: WorkerErrorsService
    ) {
        super(transport, service.router);
    }

    /**
     * an error the worker caught outside a request (its funnel's uncaught
     * exception or unhandled rejection, or the watchdog's throw). the worker
     * keeps its canonical state and keeps serving; only the report crosses.
     */
    detachedError(error: SerializedError): void {
        this.service.sink.onDetachedError(deserializeError(error));
    }
}

export default WorkerErrorsRpcMethods;

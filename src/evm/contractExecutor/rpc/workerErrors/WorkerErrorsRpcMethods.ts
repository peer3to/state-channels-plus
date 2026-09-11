import type { ContractExecutorClientRoot } from "../ContractExecutorClientRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import { deserializeError, type SerializedError } from "@/rpc/serializeError";

export class WorkerErrorsRpcMethods extends ARpcMethods<
    RpcRouter<ContractExecutorClientRoot, any>
> {
    /**
     * an error the worker caught outside a request (its funnel's uncaught
     * exception or unhandled rejection, or the watchdog's throw). the worker
     * keeps its canonical state and keeps serving; only the report crosses.
     */
    detachedError(error: SerializedError): void {
        this.localRpc.errorSink.onDetachedError(deserializeError(error));
    }
}

export default WorkerErrorsRpcMethods;

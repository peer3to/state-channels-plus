import type { ContractExecutorService } from "./ContractExecutorService";
import type { ContractExecutionResult } from "../../AContractExecutor";
import type { ContractExecutorRoot } from "../ContractExecutorRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import type { RpcRouter } from "@/rpc/RpcRouter";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { Config } from "@/utils/config";
import type { SharedLoggerContext } from "@/utils/logging/Logger";

/** a custom precompile as it crosses to the worker: loaded there by path */
export type WorkerCustomPrecompile = {
    address: string;
    module: string;
    exportName?: string;
    options?: unknown;
};

export class ContractExecutorRpcMethods extends ARpcMethods<
    RpcRouter<ContractExecutorRoot, any>
> {
    /** the vm worker only ever serves the thread above it */
    declare senderTransport: MessagePortTransport;

    constructor(
        transport: MessagePortTransport,
        private readonly service: ContractExecutorService
    ) {
        super(transport, service.router);
    }

    /** the reply is the worker's readiness */
    init(
        customPrecompiles: WorkerCustomPrecompile[],
        workerConfig: Partial<Config>,
        ownerContext: SharedLoggerContext,
        /**
         * The host Clock's adjustment from wall time to estimated chain time;
         * the worker keeps the same perception as ambient block time. Absent
         * for a host without a Clock (time zero, as before).
         */
        clockAdjustmentSeconds?: number
    ): Promise<void> {
        return this.service.init(
            this.senderTransport,
            customPrecompiles,
            workerConfig,
            ownerContext,
            clockAdjustmentSeconds
        );
    }

    /** end the executor; the link closes once this reply is out */
    async dispose(): Promise<void> {
        this.service.disposeExecutor(this.senderTransport);
    }

    deploy(data: string): Promise<ContractExecutionResult> {
        return this.service.requireExecutor().deploy(data);
    }

    executeCall(
        data: string,
        contractAddress: string
    ): Promise<ContractExecutionResult> {
        return this.service
            .requireExecutor()
            .executeCall(data, contractAddress);
    }

    simulateCall(
        data: string,
        contractAddress: string
    ): Promise<ContractExecutionResult> {
        return this.service
            .requireExecutor()
            .simulateCall(data, contractAddress);
    }
}

export default ContractExecutorRpcMethods;

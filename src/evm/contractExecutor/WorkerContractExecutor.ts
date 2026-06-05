import { ethers } from "ethers";
import type { Address, Bytes } from "@/types/types";
import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import type {
    WorkerCallMethod,
    WorkerCustomPrecompile,
    WorkerRequestPayload
} from "./types";
import type { SerializableLoggerConfig, Logger } from "@/utils/logging/Logger";
import { WorkerClient } from "@/utils/worker/WorkerClient";
import { createContractExecutorTransport } from "@platform/contractExecutorWorkerRuntime";

function serializePrecompileManifest(
    precompile: EvmCustomPrecompileManifest
): WorkerCustomPrecompile {
    return {
        address: precompile.address.toString(),
        module: precompile.module,
        exportName: precompile.exportName,
        options: precompile.options
    };
}

export default class WorkerContractExecutor extends AContractExecutor {
    private readonly client: WorkerClient<
        WorkerRequestPayload,
        ContractExecutionResult | null
    >;

    static async create(
        customPrecompiles: readonly EvmCustomPrecompileManifest[] = [],
        loggerConfig?: SerializableLoggerConfig
    ): Promise<WorkerContractExecutor> {
        const executor = new WorkerContractExecutor();
        await executor.client.request({
            type: "init",
            customPrecompiles: customPrecompiles.map(
                serializePrecompileManifest
            ),
            loggerConfig
        });
        return executor;
    }

    private constructor() {
        super();
        this.client = new WorkerClient(createContractExecutorTransport());
    }

    // Wire the SDK logger's gossip into the worker client (composition root).
    attachLogger(logger: Logger): void {
        this.client.attachLogger(logger);
    }

    async deploy(data: Bytes): Promise<ContractExecutionResult> {
        return (await this.client.request({
            type: "call",
            method: "deploy",
            data: ethers.hexlify(data)
        })) as ContractExecutionResult;
    }

    async executeCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return this.callWorker("executeCall", data, contractAddress);
    }

    async simulateCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return this.callWorker("simulateCall", data, contractAddress);
    }

    async dispose(): Promise<void> {
        await this.client.dispose();
    }

    private async callWorker(
        method: WorkerCallMethod,
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return (await this.client.request({
            type: "call",
            method,
            data: ethers.hexlify(data),
            contractAddress: contractAddress.toString()
        })) as ContractExecutionResult;
    }
}

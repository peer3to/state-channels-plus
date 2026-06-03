import { ethers } from "ethers";
import type { Address, Bytes } from "@/types/types";
import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import type {
    WorkerCallMethod,
    WorkerCustomPrecompile,
    WorkerRequestPayload,
    WorkerResponse
} from "./types";
import type {
    SerializableLoggerConfig,
    SharedLoggerContext
} from "@/utils/logging/Logger";
import {
    createContractExecutorWorker,
    type WorkerLike
} from "@platform/contractExecutorWorkerRuntime";

type PendingRequest = {
    resolve: (result: null | ContractExecutionResult) => void;
    reject: (error: Error) => void;
};

function isWorkerReadyResponse(
    response: WorkerResponse
): response is Extract<WorkerResponse, { type: "ready" }> {
    return "type" in response && response.type === "ready";
}

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
    private nextRequestId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly worker: WorkerLike;
    private readonly workerReady: Promise<void>;
    private rejectWorkerReady!: (error: Error) => void;
    private resolveWorkerReady!: () => void;

    static async create(
        customPrecompiles: readonly EvmCustomPrecompileManifest[] = [],
        loggerConfig?: SerializableLoggerConfig
    ): Promise<WorkerContractExecutor> {
        const executor = new WorkerContractExecutor();
        await executor.workerReady;
        await executor.request({
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
        this.workerReady = new Promise((resolve, reject) => {
            this.resolveWorkerReady = resolve;
            this.rejectWorkerReady = reject;
        });
        this.worker = createContractExecutorWorker(
            (message) => this.handleResponse(message),
            (error) => {
                this.rejectWorkerReady(error);
                this.rejectAll(error);
            }
        );
    }

    async deploy(data: Bytes): Promise<ContractExecutionResult> {
        return (await this.request({
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

    // Best-effort diagnostics: the worker may be gone (disposed/crashed). These
    // mirror RemoteLoggerSibling's fire-and-forget contract, so they never throw.
    async updateSharedContext(context: SharedLoggerContext): Promise<void> {
        try {
            await this.request({
                type: "diagnostics",
                op: "updateContext",
                context
            });
        } catch {
            /* swallow */
        }
    }

    async uploadLogs(message?: string): Promise<void> {
        try {
            await this.request({ type: "diagnostics", op: "upload", message });
        } catch {
            /* swallow */
        }
    }

    async dispose(): Promise<void> {
        this.rejectAll(new Error("Contract executor worker disposed"));
        await this.worker.terminate?.();
    }

    private async callWorker(
        method: WorkerCallMethod,
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return (await this.request({
            type: "call",
            method,
            data: ethers.hexlify(data),
            contractAddress: contractAddress.toString()
        })) as ContractExecutionResult;
    }

    private request(message: WorkerRequestPayload) {
        const request = {
            requestId: this.nextRequestId++,
            workerRequestPayload: message
        };

        return new Promise<null | ContractExecutionResult>(
            (resolve, reject) => {
                this.pending.set(request.requestId, { resolve, reject });
                try {
                    this.worker.postMessage(request);
                } catch (error) {
                    this.pending.delete(request.requestId);
                    reject(
                        error instanceof Error
                            ? error
                            : new Error(String(error))
                    );
                }
            }
        );
    }

    private handleResponse(response: WorkerResponse): void {
        if (isWorkerReadyResponse(response)) {
            this.resolveWorkerReady();
            return;
        }

        const pending = this.pending.get(response.requestId);
        if (!pending) return;
        this.pending.delete(response.requestId);

        if (response.ok) {
            pending.resolve(response.result);
            return;
        }

        const error = new Error(response.error.message);
        error.name = response.error.name || error.name;
        error.stack = response.error.stack || error.stack;
        (error as any).data = response.error.data;
        pending.reject(error);
    }

    private rejectAll(error: Error): void {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

import { ethers } from "ethers";
import type { Address, Bytes } from "@/types/types";
import type { Logger } from "@/utils";
import { config } from "@/utils/config";
import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import type {
    ContractExecutorRequestPayload,
    WorkerCallMethod,
    WorkerCustomPrecompile,
    WorkerResponseMessage
} from "./worker/protocol";
import { createContractExecutorWorker } from "@platform/contractExecutorWorkerRuntime";
import type { WorkerLike } from "./types";
import { LoggerUtils } from "@/utils/LoggerUtils";

type ContractExecutorOperation =
    | "init"
    | "dispose"
    | "deploy"
    | WorkerCallMethod;

type PendingRequest = {
    resolve: (result: null | ContractExecutionResult) => void;
    reject: (error: Error) => void;
    startedAtMs: number;
    operation: ContractExecutorOperation;
    contractAddress?: string;
    functionSelector?: string;
};

function isWorkerReadyResponse(
    response: WorkerResponseMessage
): response is Extract<WorkerResponseMessage, { type: "ready" }> {
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
    private readonly logger?: Logger;
    private readonly worker: WorkerLike;
    private readonly workerReady: Promise<void>;
    private rejectWorkerReady!: (error: Error) => void;
    private resolveWorkerReady!: () => void;
    private workerFailure?: Error;
    private disposed = false;

    static async create(
        customPrecompiles: readonly EvmCustomPrecompileManifest[] = [],
        logger?: Logger
    ): Promise<WorkerContractExecutor> {
        const executor = new WorkerContractExecutor(logger);
        await executor.workerReady;
        await executor.request({
            type: "init",
            customPrecompiles: customPrecompiles.map(
                serializePrecompileManifest
            ),
            config
        });
        return executor;
    }

    private constructor(logger?: Logger) {
        super();
        this.logger = logger?.child({ component: "WorkerContractExecutor" });
        this.workerReady = new Promise((resolve, reject) => {
            this.resolveWorkerReady = resolve;
            this.rejectWorkerReady = reject;
        });
        this.worker = createContractExecutorWorker(
            (message: WorkerResponseMessage) => this.handleResponse(message),
            (error: Error) => {
                this.workerFailure = error;
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

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;

        try {
            if (!this.workerFailure) {
                await this.request({ type: "dispose" });
            }
        } finally {
            this.rejectAll(
                new Error("Contract executor worker disposed"),
                false
            );
            await this.worker.shutdown?.();
        }
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

    private request(message: ContractExecutorRequestPayload) {
        if (this.disposed && message.type !== "dispose") {
            return Promise.reject(
                new Error("Contract executor worker disposed")
            );
        }
        const request = {
            type: "request" as const,
            requestId: this.nextRequestId++,
            payload: message
        };

        return new Promise<null | ContractExecutionResult>(
            (resolve, reject) => {
                this.trackRequest(request.requestId, message, resolve, reject);
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

    private handleResponse(response: WorkerResponseMessage): void {
        if (isWorkerReadyResponse(response)) {
            this.resolveWorkerReady();
            return;
        }

        if (response.type !== "response") {
            return;
        }

        const pending = this.completeRequest(response.requestId, response.ok);
        if (!pending) return;

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

    private trackRequest(
        requestId: number,
        message: ContractExecutorRequestPayload,
        resolve: PendingRequest["resolve"],
        reject: PendingRequest["reject"]
    ): void {
        const operation =
            message.type === "call" ? message.method : message.type;
        const contractAddress =
            message.type === "call" && "contractAddress" in message
                ? message.contractAddress
                : undefined;
        const callMetadata =
            message.type === "call"
                ? LoggerUtils.getContractCallMetadata(
                      message.data,
                      contractAddress
                  )
                : undefined;

        this.pending.set(requestId, {
            resolve,
            reject,
            startedAtMs: Date.now(),
            operation,
            contractAddress,
            functionSelector: callMetadata?.functionSelector
        });
    }

    private completeRequest(
        requestId: number,
        ok: boolean
    ): PendingRequest | undefined {
        const pending = this.pending.get(requestId);
        if (!pending) return undefined;
        this.pending.delete(requestId);

        const durationMs = Date.now() - pending.startedAtMs;
        if (durationMs >= 1000) {
            this.logger?.warn("Slow worker request completed", {
                requestId,
                operation: pending.operation,
                contractAddress: pending.contractAddress,
                functionSelector: pending.functionSelector,
                durationMs,
                ok,
                pendingRequests: this.pending.size
            });
        }
        return pending;
    }

    private rejectAll(error: Error, logFailure = true): void {
        if (logFailure && this.pending.size > 0) {
            this.logger?.error("Worker failed with pending requests", {
                error,
                pendingRequests: [...this.pending.values()].map((pending) => ({
                    operation: pending.operation,
                    contractAddress: pending.contractAddress,
                    functionSelector: pending.functionSelector,
                    durationMs: Date.now() - pending.startedAtMs
                }))
            });
        }
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

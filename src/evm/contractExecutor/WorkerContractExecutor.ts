import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import type {
    ContractExecutorWorkerErrorHandler,
    ContractExecutorWorkerMessageHandler,
    WorkerLike
} from "./types";
import type {
    ContractExecutorRequestPayload,
    WorkerCallMethod,
    WorkerCustomPrecompile,
    WorkerHostMessage,
    WorkerResponseMessage
} from "./worker/protocol";
import { deserializeError } from "@/evm/p2pRuntime/errorWire";
import type { Address, Bytes } from "@/types/types";
import type { Logger } from "@/utils";
import { config } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { LogControlPort, LogPortHandle } from "@/utils/logging/logControl";
import { createContractExecutorWorker } from "@platform/contractExecutorWorkerRuntime";
import { ethers } from "ethers";

/**
 * Internal construction dependencies, not part of the package API. Tests
 * supply a worker runtime that loads a scripted worker entry and observe
 * detached reports; production passes neither and gets the platform worker.
 */
export type WorkerContractExecutorDependencies = {
    createWorkerRuntime?: (
        onMessage: ContractExecutorWorkerMessageHandler,
        onError: ContractExecutorWorkerErrorHandler
    ) => WorkerLike;
    /**
     * Receives every error the worker caught outside a request. The worker
     * and this executor keep serving; the host forwards the report as a
     * `hostError`. Without a handler the error is re-thrown on the owning
     * thread as an uncaught error, so a worker never hides what an inline
     * executor would have surfaced.
     */
    onDetachedError?: (error: Error) => void;
};

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
    private readonly onDetachedError?: (error: Error) => void;
    private readonly logPort?: LogControlPort;
    private logPortHandle?: LogPortHandle;

    static async create(
        customPrecompiles: readonly EvmCustomPrecompileManifest[] = [],
        logger?: Logger,
        dependencies: WorkerContractExecutorDependencies = {},
        clockAdjustmentSeconds?: number
    ): Promise<WorkerContractExecutor> {
        const executor = new WorkerContractExecutor(logger, dependencies);
        await executor.workerReady;
        await executor.request({
            type: "init",
            customPrecompiles: customPrecompiles.map(
                serializePrecompileManifest
            ),
            config,
            clockAdjustmentSeconds
        });
        executor.attachLogPort();
        return executor;
    }

    private constructor(
        logger?: Logger,
        dependencies: WorkerContractExecutorDependencies = {}
    ) {
        super();
        this.logger = logger?.child({ component: "WorkerContractExecutor" });
        this.onDetachedError = dependencies.onDetachedError;
        this.workerReady = new Promise((resolve, reject) => {
            this.resolveWorkerReady = resolve;
            this.rejectWorkerReady = reject;
        });
        this.worker = (
            dependencies.createWorkerRuntime ?? createContractExecutorWorker
        )(
            (message: WorkerHostMessage) => this.handleResponse(message),
            (error: Error) => this.handleWorkerFailure(error)
        );

        if (this.logger) {
            this.logPort = {
                post: (message) =>
                    this.worker.postMessage({ type: "logControl", message }),
                remoteRealm: "child"
            };
        }
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
        this.dropLogPort();

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
        // Fast-fail after a fatal worker failure: a post to a dead worker is
        // silently dropped, so the request would never settle.
        if (this.workerFailure) {
            return Promise.reject(this.workerFailure);
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

    /**
     * Fatal worker failure: a load-time error, a runtime error event, or an
     * unexpected exit. The first one wins; the exit that follows an error
     * event must not overwrite the original cause. Nothing after disposal
     * counts, because the worker's own exit is expected then.
     */
    private handleWorkerFailure(error: Error): void {
        if (this.disposed) {
            this.logger?.debug(
                "Ignoring worker failure after executor disposal",
                { error: errorMessage(error) }
            );
            return;
        }
        if (this.workerFailure) {
            this.logger?.debug(
                "Ignoring later worker failure after first failure",
                { error: errorMessage(error) }
            );
            return;
        }
        this.logger?.warn("Contract executor worker failed", {
            error: errorMessage(error)
        });
        this.workerFailure = error;
        this.dropLogPort();
        this.rejectWorkerReady(error);
        this.rejectAll(error);
    }

    private handleResponse(response: WorkerHostMessage): void {
        if (response.type === "logControl") {
            this.logPortHandle?.receive(response.message);
            return;
        }

        if (isWorkerReadyResponse(response)) {
            this.resolveWorkerReady();
            return;
        }

        if (response.type === "detachedError") {
            // Report-and-continue: the worker kept its canonical EVM state and
            // still serves; only the report leaves this executor.
            const error = deserializeError(response.error);
            this.logger?.error(
                "Contract executor worker reported a detached error",
                { error }
            );
            if (this.onDetachedError) {
                this.onDetachedError(error);
                return;
            }
            // No application route: surface it on this thread the way an
            // inline executor's autonomous error would, never swallow it.
            globalThis.queueMicrotask(() => {
                throw error;
            });
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

        pending.reject(deserializeError(response.error));
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

    private attachLogPort(): void {
        if (!this.logPort || !this.logger || this.disposed) return;
        this.logPortHandle = this.logger.addLogPort(this.logPort);
    }

    private dropLogPort(): void {
        this.logPortHandle?.remove();
        this.logPortHandle = undefined;
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

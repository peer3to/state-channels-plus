import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import type { WorkerCustomPrecompile } from "./rpc/contractExecutor/ContractExecutorRpcMethods";
import { ContractExecutorClientRoot } from "./rpc/ContractExecutorClientRoot";
import {
    CONTRACT_EXECUTOR_MANIFEST,
    type ContractExecutorRoot
} from "./rpc/ContractExecutorRoot";
import type { ContractExecutorWorkerErrorHandler, WorkerLike } from "./types";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { Address, Bytes } from "@/types/types";
import type { Logger } from "@/utils";
import { config } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import { createContractExecutorWorker } from "@platform/contractExecutorWorkerRuntime";
import { ethers } from "ethers";

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

/**
 * Internal construction dependencies, not part of the package API. Tests
 * supply a worker runtime that loads a scripted worker entry and observe
 * detached reports; production passes neither and gets the platform worker.
 */
export type WorkerContractExecutorDependencies = {
    createWorkerRuntime?: (
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

/** every request to the worker; a slow one is logged */
const SLOW_REQUEST_MS = 1000;

/**
 * the executor behind a worker port: a router on this side serving the log
 * tree, a typed endpoint for the worker's services, and the link that makes
 * the worker a child of this realm's log tree.
 */
export default class WorkerContractExecutor extends AContractExecutor {
    private readonly logger?: Logger;
    private readonly worker: WorkerLike;
    private readonly router: PortRpcRouter<ContractExecutorClientRoot>;
    private readonly transport: MessagePortTransport;
    private readonly vm: RemoteRpcServices<ContractExecutorRoot>;
    private workerFailure?: Error;
    private disposed = false;
    private removeLink?: () => void;
    private readonly onDetachedError?: (error: Error) => void;

    static async create(
        customPrecompiles: readonly EvmCustomPrecompileManifest[] = [],
        logger?: Logger,
        dependencies: WorkerContractExecutorDependencies = {},
        clockAdjustmentSeconds?: number
    ): Promise<WorkerContractExecutor> {
        const executor = new WorkerContractExecutor(logger, dependencies);
        try {
            executor.link();
            // the owner's log identity rides in init, so the order of the link
            // and the init does not matter; a later change is cast over the link
            await executor.vm.contractExecutor
                .init(
                    customPrecompiles.map(serializePrecompileManifest),
                    config,
                    executor.logger?.getSharedContext() ?? {},
                    clockAdjustmentSeconds
                )
                .request({ timeoutMs: null });
        } catch (error) {
            // a worker that failed to init has no owner to dispose it, and a
            // live worker at process exit aborts the process
            await executor.dispose().catch(() => undefined);
            throw error;
        }
        return executor;
    }

    private constructor(
        logger?: Logger,
        dependencies: WorkerContractExecutorDependencies = {}
    ) {
        super();
        this.logger = logger?.child({ component: "WorkerContractExecutor" });
        this.onDetachedError = dependencies.onDetachedError;
        this.router = new PortRpcRouter<ContractExecutorClientRoot>(
            (self) =>
                new ContractExecutorClientRoot(self, logger, {
                    onDetachedError: (error) => this.reportDetachedError(error)
                }),
            this.logger,
            {
                slowRequestMs: SLOW_REQUEST_MS,
                // the runtime reports a worker's exit with its code before the
                // line closes, so that is the cause a pending call gets
                closeReason: () => this.workerFailure,
                onClosed: (_transport, isExpected) => {
                    // the runtime reports the exit with its code first, so
                    // this only names a close that arrived on its own
                    if (!isExpected) {
                        this.handleWorkerFailure(
                            new Error(
                                "Contract executor worker closed the connection"
                            )
                        );
                    }
                    this.unlink();
                }
            }
        );
        this.worker = (
            dependencies.createWorkerRuntime ?? createContractExecutorWorker
        )((error) => this.handleWorkerFailure(error));
        this.transport = this.router.attach(this.worker.port);
        this.vm = this.router.endpoint<ContractExecutorRoot>(
            this.transport,
            CONTRACT_EXECUTOR_MANIFEST
        );
    }

    async deploy(data: Bytes): Promise<ContractExecutionResult> {
        this.assertOpen();
        return this.vm.contractExecutor
            .deploy(ethers.hexlify(data))
            .request({ timeoutMs: null });
    }

    async executeCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        this.assertOpen();
        return this.vm.contractExecutor
            .executeCall(ethers.hexlify(data), contractAddress.toString())
            .request({ timeoutMs: null });
    }

    async simulateCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        this.assertOpen();
        return this.vm.contractExecutor
            .simulateCall(ethers.hexlify(data), contractAddress.toString())
            .request({ timeoutMs: null });
    }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.unlink();

        try {
            if (!this.workerFailure) {
                await this.vm.contractExecutor
                    .dispose()
                    .request({ timeoutMs: null });
            }
        } finally {
            this.transport.close(true);
            await this.worker.shutdown?.();
        }
    }

    private assertOpen(): void {
        if (this.disposed) {
            throw new Error("Contract executor worker disposed");
        }
        // Fast-fail after a fatal worker failure: a request posted to a dead
        // worker is silently dropped, so it would never settle.
        if (this.workerFailure) throw this.workerFailure;
    }

    /**
     * Fatal worker failure: a load-time error, a runtime error event, or an
     * exit this executor did not ask for. The first one wins; the exit that
     * follows an error event must not overwrite the original cause. Nothing
     * after disposal counts, because the worker's own exit is expected then.
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
    }

    /**
     * Report-and-continue: the worker kept its canonical EVM state and still
     * serves; only the report leaves this executor.
     */
    private reportDetachedError(error: Error): void {
        this.logger?.error(
            "Contract executor worker reported a detached error",
            { error }
        );
        if (this.onDetachedError) {
            this.onDetachedError(error);
            return;
        }
        // No application route: surface it on this thread the way an inline
        // executor's autonomous error would, never swallow it.
        globalThis.queueMicrotask(() => {
            throw error;
        });
    }

    /** a child of this realm's log tree, filed under the host's identity */
    private link(): void {
        if (!this.logger) return;
        // nothing to collect from the vm realm when this realm uploads
        // nothing: the link would only carry context nobody ships
        if (!this.logger.isUploadEnabled()) return;
        const peerAddress = this.logger.getSharedContext().peerAddress;
        this.removeLink = this.logger.addLogLink({
            id: `vm:${peerAddress ?? "unknown"}`,
            transport: this.transport,
            router: this.router,
            remoteRealm: "child",
            ownerLogger: this.logger
        });
    }

    private unlink(): void {
        this.removeLink?.();
        this.removeLink = undefined;
    }
}

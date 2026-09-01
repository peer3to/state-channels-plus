import { ethers } from "ethers";
import type { Address, Bytes } from "@/types/types";
import type { Logger } from "@/utils";
import { config } from "@/utils/config";
import PortRpcRouter from "@/rpc/PortRpcRouter";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { EvmCustomPrecompileManifest } from "../EvmFactory";
import AContractExecutor, {
    type ContractExecutionResult
} from "./AContractExecutor";
import { createContractExecutorWorker } from "@platform/contractExecutorWorkerRuntime";
import type { WorkerLike } from "./types";
import { ContractExecutorClientRoot } from "./rpc/ContractExecutorClientRoot";
import {
    CONTRACT_EXECUTOR_MANIFEST,
    type ContractExecutorRoot
} from "./rpc/ContractExecutorRoot";
import type { WorkerCustomPrecompile } from "./rpc/contractExecutor/ContractExecutorRpcMethods";

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

    static async create(
        customPrecompiles: readonly EvmCustomPrecompileManifest[] = [],
        logger?: Logger
    ): Promise<WorkerContractExecutor> {
        const executor = new WorkerContractExecutor(logger);
        try {
            executor.link();
            // the owner's log identity rides in init, so the order of the link
            // and the init does not matter; a later change is cast over the link
            await executor.vm.contractExecutor
                .init(
                    customPrecompiles.map(serializePrecompileManifest),
                    config,
                    executor.logger?.getSharedContext() ?? {}
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

    private constructor(logger?: Logger) {
        super();
        this.logger = logger?.child({ component: "WorkerContractExecutor" });
        this.router = new PortRpcRouter<ContractExecutorClientRoot>(
            (self) => new ContractExecutorClientRoot(self, logger),
            this.logger,
            {
                slowRequestMs: SLOW_REQUEST_MS,
                onClosed: (_transport, isExpected) => {
                    if (!isExpected) {
                        this.workerFailure ??= new Error(
                            "Contract executor worker closed the connection"
                        );
                    }
                    this.unlink();
                }
            }
        );
        this.worker = createContractExecutorWorker((error) => {
            this.workerFailure ??= error;
        });
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
    }

    /** a child of this realm's log tree, filed under the host's identity */
    private link(): void {
        if (!this.logger) return;
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

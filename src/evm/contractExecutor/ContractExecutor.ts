import { EVM } from "@ethereumjs/evm";
import { Address as EthjsAddress } from "@ethereumjs/util";
import { ethers } from "ethers";
import type { Address, Bytes } from "@/types/types";
import type { Logger } from "@/utils";
import { Mutex, toEthereumJsEvmAddress, tryDecodeCustomError } from "@/utils";
import AContractExecutor, {
    type ContractExecutionLog,
    type ContractExecutionResult
} from "./AContractExecutor";
import { LoggerUtils } from "@/utils/LoggerUtils";

// Jumpdest scan cost: profiling showed Interpreter._getValidJumpDests
// re-scanning the full contract bytecode on EVERY message call at ~25% of all
// EVM CPU for large viaIR facets behind a diamond. Verified that
// @ethereumjs/evm 10.x still re-scans per call (analysis is only skipped for
// jump-free code), so upgrading does not fix it — the code-keyed cache in
// @platform/evmJumpdestCache (installed by createEvm) does.
export default class ContractExecutor extends AContractExecutor {
    private readonly evm: EVM;
    private readonly logger?: Logger;
    // Canonical calls and simulations share one mutex so a simulation's
    // checkpoint/revert cannot overlap a canonical write.
    private readonly mutex: Mutex;

    /**
     * Seconds of estimated chain time for the next call, or undefined for
     * an executor with no clock (ambient block time stays zero).
     */
    private readonly clock?: () => number;

    constructor(evm: EVM, logger?: Logger, options?: { clock?: () => number }) {
        super();
        this.clock = options?.clock;
        this.evm = evm;
        this.logger = logger?.child({
            component: "ContractExecutor"
        });
        this.mutex = new Mutex();
    }

    async deploy(data: Bytes): Promise<ContractExecutionResult> {
        await this.mutex.lock({
            taskName: "deploy",
            logMeta: LoggerUtils.getContractCallMetadata(data)
        });

        try {
            return await this.deployOn(this.evm, data);
        } finally {
            this.mutex.unlock({ scheduleNextAsMacroTask: true });
        }
    }

    async executeCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        await this.mutex.lock({
            taskName: "executeCall",
            logMeta: LoggerUtils.getContractCallMetadata(data, contractAddress)
        });

        try {
            return await this.executeCallOn(this.evm, data, contractAddress);
        } finally {
            this.mutex.unlock({ scheduleNextAsMacroTask: true });
        }
    }

    async simulateCall(
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        await this.mutex.lock({
            taskName: "simulateCall",
            logMeta: LoggerUtils.getContractCallMetadata(data, contractAddress)
        });

        // The mutex makes the canonical EVM the single owner of local state.
        // Checkpointing here lets a simulation use that exact committed state
        // while the outer revert keeps all of its mutations ephemeral.
        const evm = this.evm;
        try {
            await evm.journal.checkpoint();
            try {
                return await this.executeCallOn(evm, data, contractAddress);
            } finally {
                await evm.journal.revert();
            }
        } finally {
            // A burst of serialized simulations must yield to timers and I/O
            // instead of draining the whole queue through microtasks.
            this.mutex.unlock({ scheduleNextAsMacroTask: true });
        }
    }

    private deployOn(evm: EVM, data: Bytes): Promise<ContractExecutionResult> {
        return this.runCall(evm, data, {});
    }

    private executeCallOn(
        evm: EVM,
        data: Bytes,
        contractAddress: Address
    ): Promise<ContractExecutionResult> {
        return this.runCall(evm, data, {
            to: toEthereumJsEvmAddress(contractAddress)
        });
    }

    private async runCall(
        evm: EVM,
        data: Bytes,
        options: Parameters<EVM["runCall"]>[0]
    ): Promise<ContractExecutionResult> {
        const result = await evm.runCall({
            data: ethers.getBytes(data),
            ...(this.clock ? { block: this.ambientBlock() } : {}),
            ...options
        });

        if (result.execResult.exceptionError) {
            const exceptionError = result.execResult.exceptionError;
            const errorData = result.execResult.returnValue
                ? ethers.hexlify(result.execResult.returnValue)
                : null;
            const custom = tryDecodeCustomError({ data: errorData });
            const errorMessage = `EVM execution failed: ${custom?.name || exceptionError.error || exceptionError}`;

            // Create error with structured data for the proxy to handle
            const error = new Error(errorMessage);
            (error as any).data = errorData;

            this.logger?.warn("Contract call execution failed", {
                errors: error,
                custom: custom
            });
            throw error;
        }

        return {
            returnValue: ethers.hexlify(result.execResult.returnValue),
            logs: this.toRpcLogs(result.execResult.logs),
            createdAddress: result.createdAddress?.toString().toLowerCase()
        };
    }

    /**
     * The EVM's default block with the runtime's current estimated chain time
     * as `block.timestamp`: manager and protocol views defined against
     * current time see it; state transitions read `_tx.header.timestamp`.
     */
    private ambientBlock(): NonNullable<
        Parameters<EVM["runCall"]>[0]["block"]
    > {
        // The EVM's own default block, with the timestamp set.
        return {
            header: {
                number: 0n,
                cliqueSigner: () => EthjsAddress.zero(),
                coinbase: EthjsAddress.zero(),
                timestamp: BigInt(this.clock!()),
                difficulty: 0n,
                prevRandao: new Uint8Array(32),
                gasLimit: 0n,
                baseFeePerGas: undefined,
                getBlobGasPrice: () => undefined
            }
        };
    }

    private toRpcLogs(logs?: any[]): ContractExecutionLog[] | undefined {
        return logs?.map((log) => ({
            address: this.toRpcAddress(log[0]),
            topics: log[1].map((topic: Uint8Array) => ethers.hexlify(topic)),
            data: ethers.hexlify(log[2])
        }));
    }

    private toRpcAddress(address: any): Address {
        const stringValue = address?.toString?.();
        const hexAddress =
            typeof address === "string"
                ? address
                : address?.bytes
                  ? ethers.hexlify(address.bytes)
                  : typeof stringValue === "string" &&
                      stringValue.startsWith("0x")
                    ? stringValue
                    : ethers.hexlify(address);

        return EthjsAddress.fromString(hexAddress.toLowerCase())
            .toString()
            .toLowerCase();
    }
}

import {
    MirrorChain,
    type MirrorBlock,
    type MirrorHead,
    type MirrorUpstream
} from "./MirrorChain";
import { MirrorStateManager } from "./MirrorStateManager";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import { createEvm } from "@/evm/EvmFactory";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils/logging/Logger";
import type {
    BlockEnvironment,
    IncludedHeadRecord
} from "@/utils/storageDiff/storageDiffWire";
import type { EVM } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { getBytes, hexlify, toBeHex, zeroPadValue } from "ethers";

/** An `eth_call` the mirror can run: a call, not a creation. */
export type MirrorCall = {
    from?: string;
    to: string;
    data: string;
    value?: bigint;
    gas?: bigint;
    gasPrice?: bigint;
};

/** How a call ended, as an RPC node would report it. */
export type MirrorCallOutcome =
    | { kind: "return"; data: string }
    | { kind: "revert"; data: string }
    | { kind: "failure"; message: string };

export type MirrorOptions = {
    /** `ws://` URL of the storage diff service. */
    serviceUrl: string;
    upstream: MirrorUpstream;
    logger: Logger;
    customPrecompiles: EvmCustomPrecompileManifest[];
    /** The root that owns the precompiles' child roots, if the host has one. */
    owner?: AInternalRpcRoot;
    getChainId: () => Promise<bigint>;
};

/**
 * A local copy of the chain at the head the storage diff service reports,
 * and the EVM that answers reads from it. A read the mirror cannot answer
 * throws, and the caller asks the RPC node instead.
 */
export class Mirror {
    private readonly options: MirrorOptions;
    private readonly state: MirrorStateManager;
    private readonly chain: MirrorChain;
    /** Precompile addresses of the local EVM; they have no account on chain. */
    private readonly precompileAddresses = new Set<string>();
    private evm?: Promise<EVM>;

    constructor(options: MirrorOptions) {
        this.options = options;
        this.state = new MirrorStateManager({
            isLocalOnly: (address) => this.precompileAddresses.has(address)
        });
        this.chain = new MirrorChain({
            serviceUrl: options.serviceUrl,
            state: this.state,
            upstream: options.upstream,
            logger: options.logger
        });
    }

    /** The newest block the service reported as included, if any. */
    get includedHead(): IncludedHeadRecord | undefined {
        return this.chain.includedHead;
    }

    /** Calls issued from now on see the chain at least up to block `number`. */
    requireNumber(number: bigint): void {
        this.chain.requireNumber(number);
    }

    /** Calls issued from now on see the chain with `block` applied. */
    requireBlock(block: MirrorBlock): void {
        this.chain.requireBlock(block);
    }

    async call(request: MirrorCall): Promise<MirrorCallOutcome> {
        const evm = await this.getEvm();
        return await this.chain.run(async (head) => {
            const header = this.chain.headEnvironment();
            try {
                const result = await evm.runCall({
                    caller: request.from
                        ? Address.fromString(request.from)
                        : undefined,
                    to: Address.fromString(request.to),
                    data: getBytes(request.data),
                    value: request.value,
                    gasPrice: request.gasPrice,
                    gasLimit: request.gas ?? BigInt(header.gasLimit),
                    block: this.blockOf(head, header)
                });
                const data = hexlify(result.execResult.returnValue);
                const error = result.execResult.exceptionError;
                if (!error) return { kind: "return", data };
                if (error.error === "revert") return { kind: "revert", data };
                return { kind: "failure", message: error.error };
            } finally {
                this.state.resetCallWrites();
                evm.journal.cleanJournal();
                evm.transientStorage.clear();
            }
        });
    }

    /** The 32-byte word of `slot`. */
    async getStorageAt(address: string, slot: string): Promise<string> {
        const key = getBytes(zeroPadValue(toBeHex(BigInt(slot)), 32));
        return await this.chain.run(async () =>
            hexlify(
                await this.state.getContractStorage(
                    Address.fromString(address),
                    key
                )
            )
        );
    }

    async getBalance(address: string): Promise<bigint> {
        return await this.chain.run(
            async () =>
                (await this.state.getAccount(Address.fromString(address)))
                    ?.balance ?? 0n
        );
    }

    async getTransactionCount(address: string): Promise<bigint> {
        return await this.chain.run(
            async () =>
                (await this.state.getAccount(Address.fromString(address)))
                    ?.nonce ?? 0n
        );
    }

    async getCode(address: string): Promise<string> {
        return await this.chain.run(async () =>
            hexlify(
                await this.state.getContractCode(Address.fromString(address))
            )
        );
    }

    async close(): Promise<void> {
        await this.chain.close();
    }

    private getEvm(): Promise<EVM> {
        this.evm ??= this.createLocalEvm();
        return this.evm;
    }

    // The configured precompiles run locally, so a call to one needs no node.
    private async createLocalEvm(): Promise<EVM> {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                stateManager: this.state,
                customPrecompiles: this.options.customPrecompiles
            },
            this.options.logger,
            this.options.owner
        );
        const chainId = await this.options.getChainId();
        // the EVM's own Common is a nested package this module cannot
        // construct a copy of; its chain id is the one CHAINID reads
        evm.common.chainId = () => chainId;
        for (const address of evm.precompiles.keys())
            this.precompileAddresses.add(`0x${address}`);
        return evm;
    }

    private blockOf(head: MirrorHead, environment: BlockEnvironment) {
        return {
            header: {
                number: head.number,
                cliqueSigner: () => Address.zero(),
                coinbase: Address.fromString(environment.miner),
                timestamp: BigInt(environment.timestamp),
                difficulty: 0n,
                prevRandao: getBytes(environment.mixHash),
                gasLimit: BigInt(environment.gasLimit),
                baseFeePerGas:
                    environment.baseFeePerGas === undefined
                        ? undefined
                        : BigInt(environment.baseFeePerGas),
                getBlobGasPrice: () => undefined
            }
        };
    }
}

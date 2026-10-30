import { isNodeOnlyAddress } from "./LocalExecutionPolicy";
import {
    MirrorChain,
    MirrorUnavailableError,
    type MirrorBlock,
    type MirrorHead,
    type MirrorUpstream
} from "./MirrorChain";
import { MirrorStateManager } from "./MirrorStateManager";
import { NotLocalError } from "./MirrorUnavailableError";
import { StorageDiffSocket } from "./StorageDiffSocket";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import { createEvm } from "@/evm/EvmFactory";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils/logging/Logger";
import type {
    BlockEnvironment,
    BlockSelector,
    IncludedHeadRecord,
    RpcBlock
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
            openFeed: (handlers) =>
                new StorageDiffSocket(options.serviceUrl, handlers),
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

    async call(
        request: MirrorCall,
        observe?: (head: MirrorBlock) => void
    ): Promise<MirrorCallOutcome> {
        const evm = await this.getEvm();
        return await this.chain.run(async (head) => {
            observe?.(head);
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
    async getStorageAt(
        address: string,
        slot: string,
        observe?: (head: MirrorBlock) => void
    ): Promise<string> {
        const key = getBytes(zeroPadValue(toBeHex(BigInt(slot)), 32));
        return await this.chain.run(async (head) => {
            observe?.(head);
            return hexlify(
                await this.state.getContractStorage(
                    Address.fromString(address),
                    key
                )
            );
        });
    }

    async getBalance(
        address: string,
        observe?: (head: MirrorBlock) => void
    ): Promise<bigint> {
        return await this.chain.run(async (head) => {
            observe?.(head);
            return (
                (await this.state.getAccount(Address.fromString(address)))
                    ?.balance ?? 0n
            );
        });
    }

    async getTransactionCount(
        address: string,
        observe?: (head: MirrorBlock) => void
    ): Promise<bigint> {
        return await this.chain.run(async (head) => {
            observe?.(head);
            return (
                (await this.state.getAccount(Address.fromString(address)))
                    ?.nonce ?? 0n
            );
        });
    }

    async getCode(
        address: string,
        observe?: (head: MirrorBlock) => void
    ): Promise<string> {
        return await this.chain.run(async (head) => {
            observe?.(head);
            return hexlify(this.state.readCodeOf(Address.fromString(address)));
        });
    }

    /** Counts a sampled answer; see {@link MirrorChain.noteSample}. */
    noteSample(outcome: "match" | "mismatch" | "skipped"): void {
        this.chain.noteSample(outcome);
    }

    /** Drops `address` to lazy reads after its cached state was found wrong. */
    async dropToLazy(address: string): Promise<void> {
        await this.chain.dropToLazy(address.toLowerCase(), true);
    }

    /** What the mirror's own state reads cost so far. */
    get statistics() {
        return this.chain.statistics;
    }

    /** The number of the newest block the service follows. */
    async blockNumber(): Promise<bigint> {
        const head = await this.chain.queryService((socket) =>
            socket.fetchHead(this.chain.seenBlock)
        );
        return this.fresh(BigInt(head.number));
    }

    /**
     * A block as the node returns it. A block the service does not retain,
     * or a latest older than one the node announced, is declined.
     */
    async getBlock(selector: BlockSelector, full: boolean): Promise<RpcBlock> {
        const block = await this.chain.queryService((socket) =>
            socket.fetchBlock(selector, full, this.chain.seenBlock)
        );
        if (!block) throw new MirrorUnavailableError("Block not retained");
        if (selector === "latest") this.fresh(BigInt(block.number));
        return block;
    }

    /** A transaction of a block the service retains; declined if it holds none. */
    async getTransaction(hash: string): Promise<unknown> {
        return this.known(
            await this.chain.queryService((socket) =>
                socket.fetchTransaction(hash, this.chain.seenBlock)
            )
        );
    }

    /** A receipt of a block the service retains; declined if it holds none. */
    async getTransactionReceipt(hash: string): Promise<unknown> {
        return this.known(
            await this.chain.queryService((socket) =>
                socket.fetchReceipt(hash, this.chain.seenBlock)
            )
        );
    }

    async close(): Promise<void> {
        await this.chain.close();
    }

    /** `number`, unless a node announced a newer block than the service has. */
    private fresh(number: bigint): bigint {
        if (number < this.chain.announcedNumber)
            throw new MirrorUnavailableError("Service is behind the node");
        return number;
    }

    private known<T>(answer: T | null): T {
        if (answer === null)
            throw new MirrorUnavailableError("Not held by the service");
        return answer;
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

import type { BlockNumber, MirrorBlock } from "./FollowedChain";
import type { AnnouncingNode } from "./HeadFreshness";
import { MirrorChain, type NodeRequest } from "./MirrorChain";
import { MirrorStateManager } from "./MirrorStateManager";
import {
    MirrorUnavailableError,
    NotLocalError
} from "./MirrorUnavailableError";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import { createEvm } from "@/evm/EvmFactory";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils/logging/Logger";
import type { RecentSlowest } from "@/utils/storageDiff/LearnedBackstop";
import type {
    AccountAddress,
    BlockEnvironment,
    BlockSelector,
    RpcBlock
} from "@/utils/storageDiff/storageDiffWire";
import type { EVM, EVMOpts } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { getBytes, hexlify, toBeHex, zeroPadValue } from "ethers";

/** An `eth_call` the mirror can run: a call, not a creation. */
export type MirrorCall = {
    from?: string;
    to: string;
    data: string;
    value?: bigint;
    gasPrice?: bigint;
};

/** What a local answer was read from: the head, and the accounts the read used. */
export type MirrorRead = { head: MirrorBlock; accounts: AccountAddress[] };

/** How a call ended, as an RPC node would report it. */
export type MirrorCallOutcome =
    | { kind: "return"; data: string }
    | { kind: "revert"; data: string }
    | { kind: "failure"; message: string };

export type MirrorOptions = {
    /** `ws://` URL of the storage diff service. */
    serviceUrl: string;
    /** One request to the RPC node, for state the service cannot read at the head. */
    requestNode: NodeRequest;
    logger: Logger;
    customPrecompiles: EvmCustomPrecompileManifest[];
    /** The root that owns the precompiles' child roots, if the host has one. */
    owner?: AInternalRpcRoot;
    /** How long the nodes took lately to answer; the waits leave room for it. */
    nodeRoundTrips?: RecentSlowest;
    /** Contracts followed at once, at most the service's limit of addresses per request. */
    maxFollowedAccounts?: number;
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
            requestNode: options.requestNode,
            nodeRoundTrips: options.nodeRoundTrips,
            maxFollowedAccounts: options.maxFollowedAccounts,
            logger: options.logger
        });
    }

    /**
     * Calls issued from now on see the chain at least up to the newest block
     * the nodes announced: a node's new head (`isHead`), or a later block one
     * of its logs named; see {@link HeadFreshness.requireNumber}.
     */
    requireNumber(
        node: AnnouncingNode,
        number: BlockNumber,
        isHead: boolean
    ): void {
        this.chain.requireNumber(node, number, isHead);
    }

    /** Calls issued from now on see the chain with `block` applied. */
    requireBlock(block: MirrorBlock): void {
        this.chain.requireBlock(block);
    }

    async call(
        request: MirrorCall,
        observe?: (seen: MirrorRead) => void
    ): Promise<MirrorCallOutcome> {
        const evm = await this.getEvm();
        return await this.observed(observe, async (head) => {
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
                    gasLimit: BigInt(header.gasLimit),
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
        observe?: (seen: MirrorRead) => void
    ): Promise<string> {
        const key = getBytes(zeroPadValue(toBeHex(BigInt(slot)), 32));
        return await this.observed(observe, async () => {
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
        observe?: (seen: MirrorRead) => void
    ): Promise<bigint> {
        return await this.observed(observe, async () => {
            return (
                (await this.state.getAccount(Address.fromString(address)))
                    ?.balance ?? 0n
            );
        });
    }

    async getTransactionCount(
        address: string,
        observe?: (seen: MirrorRead) => void
    ): Promise<bigint> {
        return await this.observed(observe, async () => {
            return (
                (await this.state.getAccount(Address.fromString(address)))
                    ?.nonce ?? 0n
            );
        });
    }

    async getCode(
        address: string,
        observe?: (seen: MirrorRead) => void
    ): Promise<string> {
        return await this.observed(observe, async () => {
            return hexlify(this.state.readCodeOf(Address.fromString(address)));
        });
    }

    /** Drops `address` to lazy reads after its cached state was found wrong. */
    async dropToLazy(address: string): Promise<void> {
        await this.chain.dropToLazy(address.toLowerCase(), true);
    }

    /** The number of the newest block the service follows. */
    async blockNumber(): Promise<bigint> {
        const head = await this.chain.queryService((socket, timeoutMs) =>
            socket.fetchHead(this.chain.seenBlock, timeoutMs)
        );
        return this.fresh(BigInt(head.number));
    }

    /**
     * A block as the node returns it. A block the service does not retain,
     * or a latest older than one the node announced, is declined.
     */
    async getBlock(selector: BlockSelector, full: boolean): Promise<RpcBlock> {
        const block = await this.chain.queryService((socket, timeoutMs) =>
            socket.fetchBlock(selector, full, this.chain.seenBlock, timeoutMs)
        );
        if (!block) throw new MirrorUnavailableError("Block not retained");
        if (selector === "latest") this.fresh(BigInt(block.number));
        return block;
    }

    /** A transaction of a block the service retains; declined if it holds none. */
    async getTransaction(hash: string): Promise<unknown> {
        return this.known(
            await this.chain.queryService((socket, timeoutMs) =>
                socket.fetchTransaction(hash, this.chain.seenBlock, timeoutMs)
            )
        );
    }

    /** A receipt of a block the service retains; declined if it holds none. */
    async getTransactionReceipt(hash: string): Promise<unknown> {
        return this.known(
            await this.chain.queryService((socket, timeoutMs) =>
                socket.fetchReceipt(hash, this.chain.seenBlock, timeoutMs)
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

    /** Runs `read` at the head, then tells `observe` the head and the accounts it used. */
    private async observed<T>(
        observe: ((seen: MirrorRead) => void) | undefined,
        read: (head: MirrorBlock) => Promise<T>
    ): Promise<T> {
        let at: MirrorBlock | undefined;
        return await this.chain.run(
            async (head) => {
                at = head;
                return await read(head);
            },
            (accounts) => observe?.({ head: at!, accounts })
        );
    }

    private getEvm(): Promise<EVM> {
        // a failed start is not kept: the next call starts the EVM again
        this.evm ??= this.createLocalEvm().catch((error) => {
            this.evm = undefined;
            throw error;
        });
        return this.evm;
    }

    // The configured precompiles run locally, so a call to one needs no node.
    private async createLocalEvm(): Promise<EVM> {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                stateManager: this.state,
                blockchain: this.blockHashes(),
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

    /**
     * BLOCKHASH from the blocks the copy applied, whose hashes are the
     * service's; a block older than the copy keeps sends the call to the node.
     */
    // the package does not export its Blockchain type, only the option that takes one
    private blockHashes(): NonNullable<EVMOpts["blockchain"]> {
        const blockchain: NonNullable<EVMOpts["blockchain"]> = {
            getBlock: async (number: number) => {
                const hash = this.chain.hashAt(BigInt(number));
                if (!hash)
                    throw new NotLocalError(
                        `Block ${number} is older than the mirror keeps`
                    );
                return { hash: () => getBytes(hash) };
            },
            shallowCopy: () => blockchain
        };
        return blockchain;
    }

    private blockOf(head: MirrorBlock, environment: BlockEnvironment) {
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

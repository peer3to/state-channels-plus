import { LightClientState } from "./LightClientState";
import {
    LightClientUnavailableError,
    NotLocalError
} from "./LightClientUnavailableError";
import type AProvenStateReader from "./proof/AProvenStateReader";
import type {
    AccountStateRead,
    BlockEnvironment,
    ProvenBlock,
    ProvenPushedBlock
} from "./proof/AProvenStateReader";
import type { PushedStateCounters } from "./PushedStateCounters";
import { createEvm } from "@/evm/EvmFactory";
import type { Logger } from "@/utils/logging/Logger";
import { Mutex } from "@/utils/Mutex";
import type { EVM, EVMOpts } from "@ethereumjs/evm";
import { Address } from "@ethereumjs/util";
import { getBytes, hexlify, toBeHex, zeroPadValue } from "ethers";

/**
 * Most passes one read makes: each pass runs on what was proven so far and
 * names the state it still lacks.
 */
const MAX_DISCOVERY_PASSES = 256;

/**
 * Most pushed blocks kept per followed contract while no read uses them;
 * past it the oldest goes, and the next read proves the held storage again.
 */
const MAX_WAITING_PUSHED_BLOCKS = 256;

/** A lowercase 0x-prefixed contract address. */
type ContractAddress = string;
/** A block hash, lowercase 0x-prefixed. */
type BlockHash = string;

/** A contract whose storage is kept across blocks. */
type FollowedContract = {
    /** Checked pushed blocks no read has used yet, by their hash. */
    waiting: Map<BlockHash, ProvenPushedBlock>;
    /** The number of the block at which all its held storage was last proven in one read. */
    provenAt?: number;
};

/** An `eth_call` the light client can run: a call, not a creation. */
export type LocalCall = {
    from?: string;
    to: string;
    data: string;
    value?: bigint;
    gasPrice?: bigint;
};

/** How a call ended, as an RPC node would report it. */
export type LocalCallOutcome =
    | { kind: "return"; data: string }
    | { kind: "revert"; data: string }
    | { kind: "failure"; message: string };

export type LightClientOptions = {
    /** Proves the state this light client reads. */
    reader: AProvenStateReader;
    /**
     * Addresses the chain answers with a precompile of its own that the
     * local EVM does not reproduce, lowercase.
     */
    chainPrecompiles: readonly string[];
    getChainId: () => Promise<bigint>;
    /**
     * Blocks after which the held storage of a followed contract is proven
     * again instead of carried by the pushed blocks. 1 proves it at every
     * block.
     */
    reproofIntervalBlocks: number;
    counters: PushedStateCounters;
    logger: Logger;
};

/**
 * Answers chain reads from state a node proved: every value a read uses was
 * checked against the state root of the node's best block. A call runs in a
 * local EVM over that state. A read the light client cannot answer throws,
 * and the caller asks the RPC node instead.
 *
 * The storage of a followed contract is kept across blocks: the blocks the
 * node pushes for it carry its proven writes, and while they link the block
 * the storage was held at to the read's block, the storage is brought there
 * without a request. Otherwise, and every `reproofIntervalBlocks` blocks,
 * all of it is proven again in one request. Everything else is proven at
 * each block that reads it.
 */
export class LightClient {
    private readonly options: LightClientOptions;
    private readonly state: LightClientState;
    /** Precompile addresses of the local EVM; they have no account on chain. */
    private readonly precompileAddresses = new Set<string>();
    private readonly chainPrecompiles: ReadonlySet<string>;
    /** One read at a time: the state and the EVM are one read's while it runs. */
    private readonly lock = new Mutex();
    private readonly followed = new Map<ContractAddress, FollowedContract>();
    /** The block the held state was proven at. */
    private block?: ProvenBlock;
    /** The environment of {@link block}, once a call needed it. */
    private environment?: BlockEnvironment;
    private evm?: Promise<EVM>;

    constructor(options: LightClientOptions) {
        this.options = options;
        this.chainPrecompiles = new Set(options.chainPrecompiles);
        this.state = new LightClientState({
            isLocalOnly: (address) => this.precompileAddresses.has(address),
            isNodeOnly: (address) => this.chainPrecompiles.has(address)
        });
    }

    /** Keeps the storage of the contract at `address` across blocks from now on. */
    follow(address: ContractAddress): void {
        if (!this.followed.has(address))
            this.followed.set(address, { waiting: new Map() });
    }

    /** The storage of the contract at `address` is proven at each block again. */
    unfollow(address: ContractAddress): void {
        this.followed.delete(address);
    }

    /**
     * Takes a block a node pushed for the followed contract at `address`.
     * The block is checked now and used by the first read at it or after
     * it. A refused block is not used: the read that would have needed it
     * proves the held storage again.
     */
    pushed(address: ContractAddress, pushed: unknown): void {
        const followed = this.followed.get(address);
        if (!followed) return;
        let proven: ProvenPushedBlock;
        try {
            proven = this.options.reader.pushedBlock(address, pushed);
        } catch (error) {
            this.options.counters.refusedBlocks++;
            this.options.logger.error("Light client refused a pushed block", {
                contract: address,
                error
            });
            return;
        }
        this.options.counters.acceptedBlocks++;
        // the held state is at or past it
        if (this.block && proven.block.number <= this.block.number) return;
        followed.waiting.set(proven.block.hash, proven);
        if (followed.waiting.size > MAX_WAITING_PUSHED_BLOCKS)
            for (const oldest of followed.waiting.keys()) {
                followed.waiting.delete(oldest);
                break;
            }
    }

    async call(request: LocalCall): Promise<LocalCallOutcome> {
        const evm = await this.getEvm();
        return await this.run(async (block) => {
            const environment = await this.environmentOf(block);
            try {
                const result = await evm.runCall({
                    caller: request.from
                        ? Address.fromString(request.from)
                        : undefined,
                    to: Address.fromString(request.to),
                    data: getBytes(request.data),
                    value: request.value,
                    gasPrice: request.gasPrice,
                    gasLimit: environment.gasLimit,
                    block: this.blockOf(environment)
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
        return await this.run(async () =>
            hexlify(
                await this.state.getContractStorage(
                    Address.fromString(address),
                    key
                )
            )
        );
    }

    async getBalance(address: string): Promise<bigint> {
        return await this.run(
            async () =>
                this.state.readAccountOf(Address.fromString(address)).balance
        );
    }

    async getTransactionCount(address: string): Promise<bigint> {
        return await this.run(
            async () =>
                this.state.readAccountOf(Address.fromString(address)).nonce
        );
    }

    async getCode(address: string): Promise<string> {
        return await this.run(async () =>
            hexlify(this.state.readCodeOf(Address.fromString(address)))
        );
    }

    /**
     * Runs `read` with the state proven at the node's best block. State the
     * read finds missing is proven in one request at that block and the read
     * runs again from the start, so one read sees one block.
     */
    private async run<T>(read: (block: ProvenBlock) => Promise<T>): Promise<T> {
        await this.lock.lock();
        try {
            const block = await this.options.reader.head();
            if (block.hash !== this.block?.hash) await this.moveTo(block);
            for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass++) {
                let outcome: { value: T } | { error: unknown };
                try {
                    outcome = { value: await read(block) };
                } catch (error) {
                    outcome = { error };
                }
                const misses = this.state.takeMisses();
                if (misses.length === 0) {
                    if ("error" in outcome) throw outcome.error;
                    return outcome.value;
                }
                // the pass ran on placeholders: its outcome is discarded
                this.state.fill(
                    misses,
                    await this.options.reader.read(block, misses)
                );
            }
            throw new LightClientUnavailableError(
                "The read keeps finding state missing"
            );
        } finally {
            this.lock.unlock();
        }
    }

    /**
     * Moves the held state to `block`. What is held was proven at another
     * block: it is forgotten, except the storage of the followed contracts,
     * which the pushed blocks bring to `block` or one request proves again.
     */
    private async moveTo(block: ProvenBlock): Promise<void> {
        const heldAt = this.block;
        const carried = new Set<ContractAddress>();
        const reproofs: {
            read: AccountStateRead;
            /**
             * Each held slot index and the 32-byte word the pushed blocks
             * say it holds, both as hex, if they reach `block`.
             */
            expected?: Map<string, string>;
        }[] = [];
        for (const [address, followed] of this.followed) {
            const link = heldAt && this.linkOf(followed, heldAt, block);
            for (const [hash, waiting] of followed.waiting)
                if (waiting.block.number <= block.number)
                    followed.waiting.delete(hash);
            for (const { writes } of link ?? [])
                this.state.applyWrites(address, writes);
            const isDue =
                followed.provenAt === undefined ||
                block.number - followed.provenAt >=
                    this.options.reproofIntervalBlocks;
            if (link && !isDue) {
                carried.add(address);
                continue;
            }
            // what is held of it from here on is proven at `block` or later
            followed.provenAt = block.number;
            const held = this.state.heldStorage(address);
            if (held.size > 0)
                reproofs.push({
                    read: {
                        address,
                        slots: [...held.keys()],
                        account: false,
                        code: false
                    },
                    expected: link && held
                });
        }
        this.state.forgetProvenState(carried);
        this.environment = undefined;
        this.block = block;
        if (reproofs.length === 0) return;
        const reads = reproofs.map(({ read }) => read);
        const proven = await this.options.reader.read(block, reads);
        this.state.fill(reads, proven);
        reproofs.forEach(({ read, expected }, index) => {
            this.options.counters.reproofs++;
            const changed = read.slots.filter(
                (slot, slotIndex) =>
                    expected !== undefined &&
                    expected.get(String(slot)) !==
                        proven[index].storage[slotIndex]
            );
            if (changed.length === 0) return;
            this.options.counters.changedUnpushed += changed.length;
            this.options.logger.warn(
                "Light client held storage that changed in blocks pushed without the write",
                { contract: read.address, slots: changed.length }
            );
        });
    }

    /**
     * The pushed blocks after `from` up to `to`, oldest first, when every
     * block between the two was pushed; undefined otherwise.
     */
    private linkOf(
        followed: FollowedContract,
        from: ProvenBlock,
        to: ProvenBlock
    ): ProvenPushedBlock[] | undefined {
        const link: ProvenPushedBlock[] = [];
        let hash = to.hash;
        while (hash !== from.hash) {
            const pushed = followed.waiting.get(hash);
            if (!pushed) return undefined;
            link.unshift(pushed);
            hash = pushed.parentHash;
        }
        return link;
    }

    private async environmentOf(block: ProvenBlock): Promise<BlockEnvironment> {
        this.environment ??= await this.options.reader.environment(block);
        return this.environment;
    }

    private getEvm(): Promise<EVM> {
        // a failed start is not kept: the next call starts the EVM again
        this.evm ??= this.createLocalEvm().catch((error) => {
            this.evm = undefined;
            throw error;
        });
        return this.evm;
    }

    private async createLocalEvm(): Promise<EVM> {
        const evm = await createEvm(
            {
                allowUnlimitedContractSize: true,
                stateManager: this.state,
                blockchain: this.blockHashes()
            },
            this.options.logger
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
     * BLOCKHASH is not answered here: an earlier block's hash is not in the
     * state a read proves, so the call goes to the node.
     */
    // the package does not export its Blockchain type, only the option that takes one
    private blockHashes(): NonNullable<EVMOpts["blockchain"]> {
        const blockchain: NonNullable<EVMOpts["blockchain"]> = {
            getBlock: async (number: number) => {
                throw new NotLocalError(
                    `The hash of block ${number} is not proven here`
                );
            },
            shallowCopy: () => blockchain
        };
        return blockchain;
    }

    private blockOf(environment: BlockEnvironment) {
        return {
            header: {
                number: environment.number,
                cliqueSigner: () => Address.zero(),
                coinbase: Address.fromString(environment.coinbase),
                timestamp: environment.timestamp,
                difficulty: environment.difficulty,
                prevRandao: getBytes(environment.prevRandao),
                gasLimit: environment.gasLimit,
                baseFeePerGas: environment.baseFeePerGas,
                getBlobGasPrice: () => undefined
            }
        };
    }
}

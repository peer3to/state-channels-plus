import type {
    LightClientCounters,
    PushedBlockTiming,
    PushedStateCounters
} from "./LightClientCounters";
import { LightClientState } from "./LightClientState";
import type {
    ContractAddress,
    SubscriptionKey
} from "./LightClientSubscriptions";
import {
    LightClientUnavailableError,
    NotLocalError
} from "./LightClientUnavailableError";
import type RpcNodeProvider from "../RpcNodeProvider";
import type AProvenStateReader from "./proof/AProvenStateReader";
import type {
    AccountStateRead,
    BlockEnvironment,
    ProvenAccountState,
    ProvenBlock
} from "./proof/AProvenStateReader";
import type APushedPartition from "./proof/APushedPartition";
import { createEvm } from "@/evm/EvmFactory";
import { LoggerUtils } from "@/utils/LoggerUtils";
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

/** Most accepted pushed blocks whose timings are kept; past it the oldest goes. */
const MAX_PUSHED_BLOCK_TIMINGS = 1024;

/** Whether a call's outcome answers it: a call that failed locally goes to the node. */
function isCallAnswer(outcome: LocalCallOutcome): boolean {
    return outcome.kind !== "failure";
}

/** A storage, balance, nonce or code read is answered by any value. */
function isAnswer(): boolean {
    return true;
}

/** The state one subscription on a socket of `node` pushed, for the contract it follows. */
type Subscription = {
    contract: ContractAddress;
    node: RpcNodeProvider;
    partition: APushedPartition;
};

/** A block a subscription pushed, with the block values a call reads at it. */
type PushedBlock = { block: ProvenBlock; environment: BlockEnvironment };

/** What a node proved for one read, kept so that each pass can fill it again. */
type Fetched = { read: AccountStateRead; proven: ProvenAccountState };

/** An `eth_call` the light client can run: a call, not a creation. */
export type LocalCall = {
    from?: string;
    to: string;
    data: string;
    value?: bigint;
};

/** How a call ended, as an RPC node would report it. */
export type LocalCallOutcome =
    | { kind: "return"; data: string }
    | { kind: "revert"; data: string }
    | { kind: "failure"; message: string };

export type LightClientOptions = {
    /** Proves the state this light client reads. */
    reader: AProvenStateReader;
    /** A partition of the chain's proof representation, for one subscription. */
    createPartition: () => APushedPartition;
    /**
     * The node the chain access sends its requests to now. Only what its
     * subscriptions pushed is read: another endpoint's pushes cannot move
     * the block a read is made at.
     */
    servingNode: () => RpcNodeProvider | undefined;
    /**
     * Addresses the chain answers with a precompile of its own that the
     * local EVM does not reproduce, lowercase.
     */
    chainPrecompiles: readonly string[];
    /** The Ethereum hardfork whose rules the chain's EVM runs. */
    hardfork: string;
    /** The addresses of Ethereum's precompiles the chain serves, lowercase; the local EVM runs no other. */
    ethereumPrecompiles: readonly string[];
    getChainId: () => Promise<bigint>;
    /**
     * The highest block the chain access has seen, from the nodes' new heads
     * and the receipts it returned: no read is made at an earlier block.
     */
    blockFloor: () => number | undefined;
    /** The longest a read waits for the serving node to push the block at {@link blockFloor}. */
    pushWaitMs: number;
    /** Counted on: the reads this light client answers. */
    counters: LightClientCounters;
    /** Counted on: the pushed blocks it takes. */
    pushedState: PushedStateCounters;
    /** Appended to: the stages of each accepted pushed block, at most the last 1024. */
    pushedBlockTimings: PushedBlockTiming[];
    logger: Logger;
};

/**
 * Answers chain reads from state a node proved: every value a read uses was
 * checked against the state root of one block. A call runs in a local EVM over
 * that state. A read the light client cannot answer throws, and the caller
 * asks the RPC node instead.
 *
 * The block is the newest one a subscription on the serving node pushed and
 * the light client verified, and a read takes from that node's pushed
 * partitions everything they prove at that block, without a request. What they do not reach, it has the node
 * prove at that block. With nothing pushed yet it reads at the node's best
 * block and has the node prove everything.
 */
export class LightClient {
    private readonly options: LightClientOptions;
    private readonly state: LightClientState;
    /** Precompile addresses of the local EVM; they have no account on chain. */
    private readonly precompileAddresses = new Set<string>();
    /** Lowercase addresses the chain serves with a precompile of its own. */
    private readonly chainPrecompiles: ReadonlySet<string>;
    /**
     * One pass at a time: the state and the EVM are one pass's while it runs.
     * A read waiting for a node's proof does not hold it.
     */
    private readonly lock = new Mutex();
    private readonly subscriptions = new Map<SubscriptionKey, Subscription>();
    /** Reads waiting for a push of the block floor; each is called after every accepted push. */
    private readonly pushWaiters = new Set<() => void>();
    /** Whether a wait for a push timed out and no push was accepted since: reads then do not wait. */
    private isPushStalled = false;
    /** The block the held state was proven at. */
    private block?: ProvenBlock;
    private evm?: Promise<EVM>;

    constructor(options: LightClientOptions) {
        this.options = options;
        this.chainPrecompiles = new Set(options.chainPrecompiles);
        this.state = new LightClientState({
            isLocalOnly: (address) => this.precompileAddresses.has(address),
            isNodeOnly: (address) => this.chainPrecompiles.has(address)
        });
    }

    /** Subscription `key` on a socket of `node` follows the contract at `contract`: its pushes go to a partition of its own. */
    subscribed(
        key: SubscriptionKey,
        contract: ContractAddress,
        node: RpcNodeProvider
    ): void {
        this.subscriptions.set(key, {
            contract,
            node,
            partition: this.options.createPartition()
        });
    }

    /** Subscription `key` ended: what it pushed is not used any more. */
    unsubscribed(key: SubscriptionKey): void {
        this.subscriptions.delete(key);
    }

    /**
     * Takes a message pushed to subscription `key`, received at `receivedAt`.
     * False when it is refused: the subscription holds nothing, and it must
     * sync again.
     */
    pushed(
        key: SubscriptionKey,
        message: unknown,
        receivedAt: number
    ): boolean {
        const subscription = this.subscriptions.get(key);
        if (!subscription) return true;
        try {
            const accepted = subscription.partition.accept(message);
            // the block it already holds, pushed again
            if (!accepted) return true;
            this.options.pushedState.acceptedBlocks++;
            const { stages } = accepted;
            const timings = this.options.pushedBlockTimings;
            timings.push({
                number: accepted.block.number,
                executedAt: stages.executedAt,
                builtAt: stages.builtAt,
                sentAt: stages.sentAt,
                receivedAt,
                verifiedAt: Date.now(),
                newNodes: accepted.newNodes,
                heldNodes: accepted.heldNodes
            });
            if (timings.length > MAX_PUSHED_BLOCK_TIMINGS) timings.shift();
            this.isPushStalled = false;
            for (const waiter of [...this.pushWaiters]) waiter();
            return true;
        } catch (error) {
            this.options.pushedState.refusedBlocks++;
            this.options.logger.error("Light client refused a pushed block", {
                contract: subscription.contract,
                ...LoggerUtils.getRpcNodeMetadata(subscription.node.url),
                error
            });
            return false;
        }
    }

    async call(request: LocalCall): Promise<LocalCallOutcome> {
        // the chain keeps its existential deposit back from the balance it
        // reports for an account the value makes; the local EVM does not
        if (request.value)
            throw new NotLocalError(
                "A call that carries value runs on the node"
            );
        const evm = await this.getEvm();
        return await this.run(true, isCallAnswer, async (environment) => {
            try {
                const result = await evm.runCall({
                    caller: request.from
                        ? Address.fromString(request.from)
                        : undefined,
                    to: Address.fromString(request.to),
                    data: getBytes(request.data),
                    value: request.value,
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
        return await this.run(false, isAnswer, async () =>
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
            false,
            isAnswer,
            async () =>
                this.state.readAccountOf(Address.fromString(address)).balance
        );
    }

    async getTransactionCount(address: string): Promise<bigint> {
        return await this.run(
            false,
            isAnswer,
            async () =>
                this.state.readAccountOf(Address.fromString(address)).nonce
        );
    }

    async getCode(address: string): Promise<string> {
        return await this.run(false, isAnswer, async () =>
            hexlify(this.state.readCodeOf(Address.fromString(address)))
        );
    }

    /**
     * Runs `read` on state proven at one block, and with that block's
     * environment when `needsEnvironment`. State a pass finds missing is
     * taken from the partitions pushed at that block, or proven by the node
     * at that block, and the read runs again from the start, so one read sees
     * one block.
     */
    private async run<T>(
        needsEnvironment: boolean,
        isAnswer: (value: T) => boolean,
        read: (environment: BlockEnvironment) => Promise<T>
    ): Promise<T> {
        const pushed = await this.pushedBlockAtFloor();
        let askedNode = pushed === undefined;
        const block = pushed?.block ?? (await this.options.reader.head());
        let environment = pushed?.environment;
        if (needsEnvironment && !environment) {
            askedNode = true;
            environment = await this.options.reader.environment(block);
        }
        const fetched: Fetched[] = [];
        for (let pass = 0; pass < MAX_DISCOVERY_PASSES; pass++) {
            let undecided: AccountStateRead[];
            await this.lock.lock();
            try {
                this.moveTo(block, fetched);
                let outcome: { value: T } | { error: unknown };
                try {
                    // a read that needs no environment never reads it
                    outcome = { value: await read(environment!) };
                } catch (error) {
                    outcome = { error };
                }
                const misses = this.state.takeMisses();
                if (misses.length === 0) {
                    if ("error" in outcome) throw outcome.error;
                    if (isAnswer(outcome.value)) {
                        if (askedNode) this.options.counters.withFallbackRead++;
                        else this.options.counters.fromPushedState++;
                    }
                    return outcome.value;
                }
                // the pass ran on placeholders: its outcome is discarded
                undecided = this.fillFromPartitions(block, misses);
            } finally {
                this.lock.unlock();
            }
            if (undecided.length === 0) continue;
            askedNode = true;
            const proven = await this.options.reader.read(block, undecided);
            undecided.forEach((missing, index) =>
                fetched.push({ read: missing, proven: proven[index] })
            );
        }
        throw new LightClientUnavailableError(
            "The read keeps finding state missing"
        );
    }

    /**
     * The newest block the serving node pushed, once it is not below the
     * block floor: a push that has not reached the floor yet is waited for,
     * at most {@link LightClientOptions.pushWaitMs}, and not again until a
     * push is accepted. Undefined when none reaches it, and the read is then
     * made at the node's best block.
     */
    private async pushedBlockAtFloor(): Promise<PushedBlock | undefined> {
        const floor = this.options.blockFloor();
        const isAtFloor = (pushed: PushedBlock | undefined) =>
            pushed !== undefined &&
            (floor === undefined || pushed.block.number >= floor);
        const pushed = this.newestPushedBlock();
        if (pushed === undefined || isAtFloor(pushed)) return pushed;
        // the pushes stopped: waiting again only delays the read
        if (this.isPushStalled) return undefined;
        return await new Promise<PushedBlock | undefined>((resolve) => {
            const finish = (value: PushedBlock | undefined) => {
                clearTimeout(timer);
                this.pushWaiters.delete(check);
                resolve(value);
            };
            const check = () => {
                const newest = this.newestPushedBlock();
                if (isAtFloor(newest)) finish(newest);
            };
            const timer = setTimeout(() => {
                this.isPushStalled = true;
                finish(undefined);
            }, this.options.pushWaitMs);
            this.pushWaiters.add(check);
        });
    }

    /** The newest block a subscription on the serving node pushed and the light client holds, with its environment. */
    private newestPushedBlock(): PushedBlock | undefined {
        let newest: PushedBlock | undefined;
        for (const partition of this.servingPartitions()) {
            const { block, environment } = partition;
            if (
                block &&
                environment &&
                block.number > (newest?.block.number ?? -1)
            )
                newest = { block, environment };
        }
        return newest;
    }

    /**
     * Holds the state proven at `block`: what is held of another block is
     * forgotten. What the node proved for this read is filled again, since
     * another read may have moved the state in between.
     */
    private moveTo(block: ProvenBlock, fetched: Fetched[]): void {
        if (block.hash !== this.block?.hash) {
            this.state.forgetProvenState();
            this.block = block;
        }
        if (fetched.length > 0)
            this.state.fill(
                fetched.map(({ read }) => read),
                fetched.map(({ proven }) => proven)
            );
    }

    /** Fills what the serving node's partitions pushed at `block` decide of `misses`; the rest, for the node. */
    private fillFromPartitions(
        block: ProvenBlock,
        misses: AccountStateRead[]
    ): AccountStateRead[] {
        let undecided = misses;
        for (const partition of this.servingPartitions()) {
            if (undecided.length === 0) break;
            if (partition.block?.hash !== block.hash) continue;
            const decision = partition.decide(undecided);
            this.state.fill(
                decision.decided.map(({ read }) => read),
                decision.decided.map(({ proven }) => proven)
            );
            undecided = decision.undecided;
        }
        return undecided;
    }

    /** The partitions of the subscriptions on the node the chain access sends its requests to now. */
    private servingPartitions(): APushedPartition[] {
        const serving = this.options.servingNode();
        return [...this.subscriptions.values()]
            .filter(({ node }) => node === serving)
            .map(({ partition }) => partition);
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
            { stateManager: this.state, blockchain: this.blockHashes() },
            this.options.logger
        );
        const chainId = await this.options.getChainId();
        // the EVM's own Common is a nested package this module cannot
        // construct a copy of; its chain id is the one CHAINID reads
        evm.common.chainId = () => chainId;
        // the chain's rules; the change makes the EVM list its precompiles again
        evm.common.setHardfork(this.options.hardfork);
        const served = new Set(this.options.ethereumPrecompiles);
        for (const address of [...evm.precompiles.keys()]) {
            // the hardfork's later precompiles and the console's are plain accounts on the chain
            if (served.has(`0x${address}`))
                this.precompileAddresses.add(`0x${address}`);
            else evm.precompiles.delete(address);
        }
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
                // the chain has no blobs, and its blob base fee is not in the state a read proves
                getBlobGasPrice: () => {
                    throw new NotLocalError(
                        "The blob base fee is not proven here"
                    );
                }
            }
        };
    }
}

// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import MirrorRpcMethods from "./MirrorRpcMethods";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import type RpcContractExecutor from "@/evm/contractExecutor/RpcContractExecutor";
import type EvmDiamondStateMachine from "@/evm/EvmDiamondStateMachine";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { LocalDiamondContract } from "@/utils/localDiamond";
import { RuntimeRpcControl } from "@test/fixtures/runtimeRpc/RuntimeRpcControl";
import type { StateChannelManagerInterface } from "@typechain-types";
import {
    type BaseContract,
    type BaseContractMethod,
    type ContractRunner,
    ethers
} from "ethers";

/**
 * The local-first reads: each runs on the local diamond first and may be
 * confirmed by the same read on the chain (see `preferLocal`), plus the
 * state-proof walk that the tiers run on the local diamond, then on the chain
 * (`AgreementManager.walkStateProofTiers`).
 */
export const MIRROR_READS = [
    "isAuditingDataOmissionAllowed",
    "isCorrectLatestState",
    "verifyBalanceInvariantCheckSnapshot",
    "validateTimeoutCalldataPostedProof",
    "isDisputeInboundHashValid",
    "hasStateProofHeaderMismatch",
    "verifyMilestones"
] as const satisfies readonly (keyof LocalDiamondContract &
    keyof StateChannelManagerInterface)[];
export type MirrorRead = (typeof MIRROR_READS)[number];

/**
 * Reads that must stay on the local diamond (pure checks). Observing them
 * shows that no chain read happens.
 */
export const LOCAL_ONLY_READS = [
    "isInvalidBlockStructureInStateProof"
] as const satisfies readonly (keyof LocalDiamondContract &
    keyof StateChannelManagerInterface)[];
export type LocalOnlyRead = (typeof LOCAL_ONLY_READS)[number];

/** The local tiers' walk from a supplied start: the chain has no such read. */
export const LOCAL_WALK =
    "verifyMilestonesFromTrustedStart" satisfies keyof LocalDiamondContract;

/** Every read the service can observe. */
export type ObservableRead = MirrorRead | LocalOnlyRead | typeof LOCAL_WALK;
const OBSERVABLE_READS: readonly ObservableRead[] = [
    ...MIRROR_READS,
    ...LOCAL_ONLY_READS,
    LOCAL_WALK
];

/**
 * How the next read fails. `revert`: the real contract runs the same function
 * with its ABI arguments cut off, so the EVM reverts in the ABI decoder.
 * `transport`: the call never gets a verdict - on the local side the executor
 * connection delivers it with corrupted params (the executor answers
 * "Malformed RPC request"), on the chain side it goes to an RPC endpoint that
 * refuses the connection.
 */
export type MirrorReadFault = "revert" | "transport";

/** Chain events a chain read can be served just before. */
export type MirrorChainEvent =
    | "InboundMessagesProcessed"
    | "BlockCalldataPosted"
    | "StateSnapshotUpdated";

/**
 * The local diamond's event-application entry points a mirror hold can
 * suspend: InboundMessagesProcessed, ChainSlashed (also applied on
 * DisputeKilled), StateSnapshotUpdated and ChannelStorageCleared (a snapshot
 * update's pruning of consumed inbound blocks) logs.
 */
export const MIRROR_UPDATES = [
    "onInboundMessagesProcessed",
    "onOnChainSlashAdded",
    "onStateSnapshotUpdated",
    "onChannelStorageCleared"
] as const satisfies readonly (keyof LocalDiamondContract)[];
export type MirrorUpdate = (typeof MIRROR_UPDATES)[number];

/** What one side answered for one read, in call order. */
export type MirrorReadSide = {
    reads: number;
    /** The boolean answer (a walk's `valid`), or null for another struct answer. */
    answers: (boolean | null)[];
    /** Messages of failed reads. */
    failures: string[];
    /** ethers error codes of failed reads ("" when the error has none). */
    failureCodes: string[];
};

export type MirrorReadObservation = {
    local: MirrorReadSide;
    chain: MirrorReadSide;
};

type StaticCallArgs = unknown[];

type ObservedRead = {
    observation: MirrorReadObservation;
    localFault?: MirrorReadFault;
    chainFault?: MirrorReadFault;
    chainBlockTag?: number;
    restore: () => void;
};

// A chain RPC endpoint that refuses connections (port 1 is never served).
const REFUSING_RPC_URL = "http://127.0.0.1:1";

const emptySide = (): MirrorReadSide => ({
    reads: 0,
    answers: [],
    failures: [],
    failureCodes: []
});

/** A peer's real connection to the executor runtime of its local diamond. */
export function localExecutorConnection(sm: { diamondStateMachine: unknown }) {
    // Structural checks: importing these classes as values here closes an
    // import cycle through @/evm in some test entry orders.
    const machine = sm.diamondStateMachine as Partial<EvmDiamondStateMachine>;
    if (!machine.contractExecutor)
        throw new Error("The local diamond does not run on an executor");
    const executor = machine.contractExecutor as RpcContractExecutor;
    if (!("contractExecutorRemoteRoot" in executor))
        throw new Error("The executor is not behind a runtime connection");
    // private: the executor client's connection to its runtime root
    return executor["contractExecutorRemoteRoot"];
}

/**
 * Host-side control of the local mirror versus the chain for the local-first
 * reads. Observation is record-only: every read is forwarded to the real
 * contract. Divergence is staged with real state: the mirror can miss
 * InboundMessagesProcessed or ChainSlashed logs the chain has, and chain reads
 * can be served from the chain state just before a chosen event (a chain view
 * that lags the mirror). One-shot faults make a read fail through the real contract
 * and connection.
 */
export class MirrorService extends ANetworkRpcService<
    MirrorRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    private readonly observed = new Map<ObservableRead, ObservedRead>();
    // the held calls' arguments and the restore of each suspended update
    private readonly heldUpdates = new Map<
        MirrorUpdate,
        { calls: unknown[][]; restore: () => void }
    >();

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "HarnessMirrorService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    public createRPCMethods(transport: NetworkTransport) {
        return new MirrorRpcMethods(transport, this);
    }

    /** Start record-only observation of `read` on both contracts. */
    public observe(read: ObservableRead): void {
        if (!OBSERVABLE_READS.includes(read))
            throw new Error("Invalid mirror read selection");
        if (this.observed.has(read)) return;
        const local: BaseContract =
            this.sm.diamondStateMachine.localDiamondContract;
        const chain: BaseContract = this.sm.stateChannelManagerContract;
        const entry: ObservedRead = {
            observation: { local: emptySide(), chain: emptySide() },
            restore: () => {}
        };
        const restoreLocal = this.wrapStaticCall(
            local,
            read,
            (original, args) =>
                this.localRead(entry, local, read, original, args)
        );
        const restoreChain =
            read === LOCAL_WALK
                ? () => {}
                : this.wrapStaticCall(chain, read, (original, args) =>
                      this.chainRead(entry, chain, read, original, args)
                  );
        entry.restore = () => {
            restoreLocal();
            restoreChain();
        };
        this.observed.set(read, entry);
    }

    public observation(read: ObservableRead): MirrorReadObservation {
        const { local, chain } = this.require(read).observation;
        const copy = (side: MirrorReadSide): MirrorReadSide => ({
            reads: side.reads,
            answers: [...side.answers],
            failures: [...side.failures],
            failureCodes: [...side.failureCodes]
        });
        return { local: copy(local), chain: copy(chain) };
    }

    /** Stop observing `read`; clears any pending fault or chain view. */
    public restore(read: ObservableRead): void {
        this.observed.get(read)?.restore();
        this.observed.delete(read);
    }

    public failNextLocalRead(
        read: ObservableRead,
        fault: MirrorReadFault
    ): void {
        this.require(read).localFault = fault;
    }

    public failNextChainRead(
        read: ObservableRead,
        fault: MirrorReadFault
    ): void {
        this.require(read).chainFault = fault;
    }

    /**
     * Serve every later chain read of `read` from the chain state one block
     * before this channel's latest `event` log: the chain view lags the
     * mirror. Returns the block the reads are served at.
     */
    public async serveChainReadsBefore(
        read: ObservableRead,
        event: MirrorChainEvent
    ): Promise<number> {
        const entry = this.require(read);
        const contract: BaseContract = this.sm.stateChannelManagerContract;
        const logs = await contract.queryFilter(event, 0, "latest");
        const channelLogs = logs.filter(
            (log) => log.topics[1] === this.sm.channelId
        );
        const latest = channelLogs.at(-1);
        if (!latest) throw new Error(`serveChainReadsBefore: no ${event} log`);
        entry.chainBlockTag = latest.blockNumber - 1;
        return entry.chainBlockTag;
    }

    /**
     * Stop applying `update` to the local diamond: the event handler, storage
     * and ingest keep running, only the mirror misses the logs.
     */
    public holdUpdates(update: MirrorUpdate): void {
        if (!MIRROR_UPDATES.includes(update))
            throw new Error("Invalid mirror update selection");
        if (this.heldUpdates.has(update)) return;
        const localDiamond: BaseContract =
            this.sm.diamondStateMachine.localDiamondContract;
        const calls: unknown[][] = [];
        const restore = this.replaceMethod(
            localDiamond,
            update,
            (original) =>
                new Proxy(original, {
                    apply: (_target, _thisArg, args: unknown[]) => {
                        calls.push(args);
                        return Promise.resolve(undefined);
                    }
                })
        );
        this.heldUpdates.set(update, { calls, restore });
    }

    public heldUpdateCount(update: MirrorUpdate): number {
        return this.heldUpdates.get(update)?.calls.length ?? 0;
    }

    /** Resume `update` and apply the held logs to the mirror, in order. */
    public async releaseUpdates(update: MirrorUpdate): Promise<number> {
        const held = this.heldUpdates.get(update);
        if (!held) return 0;
        held.restore();
        this.heldUpdates.delete(update);
        const localDiamond: BaseContract =
            this.sm.diamondStateMachine.localDiamondContract;
        for (const args of held.calls) {
            await localDiamond.getFunction(update)(...args);
        }
        return held.calls.length;
    }

    private require(read: ObservableRead): ObservedRead {
        const entry = this.observed.get(read);
        if (!entry) throw new Error(`Mirror read ${read} is not observed`);
        return entry;
    }

    /**
     * Replace `contract[read]` with the real method whose `staticCall` goes
     * through `staticCall`. Returns the restore.
     */
    private wrapStaticCall(
        contract: BaseContract,
        read: ObservableRead,
        staticCall: (
            original: BaseContractMethod,
            args: StaticCallArgs
        ) => Promise<unknown>
    ): () => void {
        return this.replaceMethod(contract, read, (original) => {
            // the real method's helpers (`populateTransaction`, `fragment`,
            // ...) stay; only its `staticCall` is observed
            const method = (...args: StaticCallArgs) => original(...args);
            const descriptors = Object.getOwnPropertyDescriptors(original);
            Reflect.deleteProperty(descriptors, "staticCall");
            Object.defineProperties(method, descriptors);
            Object.defineProperty(method, "staticCall", {
                value: (...args: StaticCallArgs) => staticCall(original, args),
                configurable: true,
                writable: true
            });
            return method;
        });
    }

    /**
     * Install `replacement(original)` as `contract[name]`; the contract's
     * callers reach it through their usual property access. Returns the
     * restore.
     */
    private replaceMethod(
        contract: BaseContract,
        name: ObservableRead | MirrorUpdate,
        replacement: (original: BaseContractMethod) => unknown
    ): () => void {
        const previous = Object.getOwnPropertyDescriptor(contract, name);
        const original = contract.getFunction(name);
        Object.defineProperty(contract, name, {
            value: replacement(original),
            configurable: true,
            writable: true
        });
        return () => {
            if (previous) Object.defineProperty(contract, name, previous);
            else Reflect.deleteProperty(contract, name);
        };
    }

    private async localRead(
        entry: ObservedRead,
        contract: BaseContract,
        read: ObservableRead,
        original: BaseContractMethod,
        args: StaticCallArgs
    ): Promise<unknown> {
        const side = entry.observation.local;
        side.reads++;
        const fault = entry.localFault;
        entry.localFault = undefined;
        return this.record(side, async () => {
            if (fault === "revert")
                return this.revertingCall(contract, read, args);
            if (fault === "transport")
                return this.corruptedExecutorCall(contract, read, args);
            return original.staticCall(...args);
        });
    }

    private async chainRead(
        entry: ObservedRead,
        contract: BaseContract,
        read: ObservableRead,
        original: BaseContractMethod,
        args: StaticCallArgs
    ): Promise<unknown> {
        const side = entry.observation.chain;
        side.reads++;
        const fault = entry.chainFault;
        entry.chainFault = undefined;
        return this.record(side, async () => {
            if (fault === "revert")
                return this.revertingCall(contract, read, args);
            if (fault === "transport")
                return this.refusedChainCall(contract, read, args);
            if (entry.chainBlockTag === undefined)
                return original.staticCall(...args);
            return original.staticCall(...args, {
                blockTag: entry.chainBlockTag
            });
        });
    }

    private async record(
        side: MirrorReadSide,
        run: () => Promise<unknown>
    ): Promise<unknown> {
        try {
            const answer = await run();
            const value =
                (answer as { valid?: unknown } | null)?.valid ?? answer;
            side.answers.push(typeof value === "boolean" ? value : null);
            return answer;
        } catch (error) {
            side.failures.push(
                error instanceof Error ? error.message : String(error)
            );
            const code = ethers.isError(error, "CALL_EXCEPTION")
                ? error.code
                : ((error as { code?: unknown } | null)?.code ?? "");
            side.failureCodes.push(String(code));
            throw error;
        }
    }

    private runnerOf(contract: BaseContract): ContractRunner {
        const runner = contract.runner;
        if (!runner?.call) throw new Error("Contract runner cannot call");
        return runner;
    }

    /** The same function with its ABI arguments cut off: a real EVM revert. */
    private async revertingCall(
        contract: BaseContract,
        read: ObservableRead,
        args: StaticCallArgs
    ): Promise<string> {
        const selector = ethers.dataSlice(
            contract.interface.encodeFunctionData(read, args),
            0,
            4
        );
        return this.runnerOf(contract).call!({
            to: await contract.getAddress(),
            data: selector
        });
    }

    /**
     * Post the read to the executor with corrupted params. The post happens
     * synchronously after arming, so no other read can take the fault.
     */
    private async corruptedExecutorCall(
        contract: BaseContract,
        read: ObservableRead,
        args: StaticCallArgs
    ): Promise<string> {
        const data = contract.interface.encodeFunctionData(read, args);
        const to = await contract.getAddress();
        const runner = this.runnerOf(contract);
        const connection = this.executorConnection();
        const existing = RuntimeRpcControl.get(connection["transport"]);
        const control = existing ?? RuntimeRpcControl.attachTo(connection);
        let call: Promise<string>;
        try {
            control.corruptNextParams("simulateCall");
            call = runner.call!({ to, data });
            const posted = control.sent.at(-1);
            if (posted?.method !== "simulateCall" || posted.params !== null)
                throw new Error(
                    "The corrupted executor post was not this read"
                );
        } finally {
            // the response still settles through the restored transport
            if (!existing) control.dispose();
        }
        return call;
    }

    /** This peer's real connection to its contract executor runtime. */
    private executorConnection() {
        return localExecutorConnection(this.sm);
    }

    /** Send the read to an RPC endpoint that refuses the connection. */
    private async refusedChainCall(
        contract: BaseContract,
        read: ObservableRead,
        args: StaticCallArgs
    ): Promise<string> {
        const provider = this.runnerOf(contract).provider;
        if (!provider) throw new Error("Chain runner has no provider");
        const network = await provider.getNetwork();
        const refusing = new ethers.JsonRpcProvider(REFUSING_RPC_URL, network, {
            staticNetwork: network
        });
        try {
            return await refusing.call({
                to: await contract.getAddress(),
                data: contract.interface.encodeFunctionData(read, args)
            });
        } finally {
            refusing.destroy();
        }
    }
}

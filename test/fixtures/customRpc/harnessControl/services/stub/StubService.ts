import ARpcService from "@/rpc/ARpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";
import type { Address, ForkId, Hash, Timestamp } from "@/types/types";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import StubRpcMethods from "./StubRpcMethods";
import { ethers, id, Log } from "ethers";
import { Codec, DetachedPromises, Mutex, Type } from "@/utils";
import * as factory from "@test/factory";
import DisputeValidationStrategy from "@/stateManager/validationStrategy/DisputeValidationStrategy";
import { BlockValidationResult } from "@/types";
import { Block, StateSnapshot } from "@/models";
import Clock from "@/Clock";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { recordValidationBoundary } from "./RecordingValidationStrategy";

// `ATransport` is used both for `createRPCMethods` and the captured transport.

type DisputeCommittedEventKey = string;
type CalldataPostedEventKey = string;

/** Fixed identifiers for the stub-original registry (never caller-supplied). */
export type StubKey =
    | "broadcast"
    | "calldataPosting"
    | "pendingInboundInclusion"
    | "selectiveDisconnect"
    | "spectateCreateRpcMethods"
    | "disputeAckCreateRpcMethods"
    | "postStateSnapshot"
    | "unsafeSetLatestState"
    | "blockedInitHandshake"
    | "captureInitHandshake"
    | "initHandshakeCreateRpcMethods"
    | "maybePostBlockOnChain"
    | "spectateAbort"
    | "reductionTasks"
    | "snapshotUpdatedEvents"
    | "disputeCommittedEvents"
    | "calldataPostedEvents"
    | "disputeInitiation"
    | "reducedCommitEvents"
    | "reduce"
    | "reductionSimulation"
    | "finalDisputePreparation"
    | "spectateSync"
    | "pausedReduction"
    | "pausedReductionKillPeriod";

export type ReductionSimulationErrorName =
    | "RaceConditionDisputeAlreadyReduced"
    | "RaceConditionBlockHeightTooOld"
    | "RaceConditionReductionExpectationDoesntMatch";

export type PausedReductionStatus = {
    entered: boolean;
    released: boolean;
    settled: boolean;
    error?: string;
};

export type PausedReductionState = PausedReductionStatus & {
    targetForkId: ForkId;
    inside: boolean;
    release?: () => void;
    promise?: Promise<unknown>;
};

export type EventSyncFailureProbe = {
    samePromise: boolean;
    handlerCallCount: number;
    firstError: string | null;
    secondError: string | null;
    rescheduledError: string | null;
    cursorBefore: number | null;
    cursorAfter: number | null;
    detachedError: string | null;
};

export type ConcurrentCalldataRecoveryProbe = {
    queryCount: number;
    firstFound: boolean;
    secondFound: boolean;
    retryFound: boolean;
};

export type DisputeStrategyResultMatrix = Record<string, string>;

export type CleanCommittedDivergenceProbe = {
    result: string;
    proofStored: boolean;
};

export type MissingParticipantSnapshotsProbe = {
    earlyAuthorResult: string;
    signatureUnionResult: string;
    proofStored: boolean;
};

export type IsDisputedForkProbe = {
    disputed: boolean;
    onChainQueries: number;
};

export type BlockValidationProbeOptions = {
    strategy?: "active" | "dispute";
    encodedDispute?: string;
    /** Supplier of this copy - drives `sourcePeers`/`signatureSources`. */
    senderAddress?: Address;
};

export type BlockValidationProbe = {
    result: number;
    resultName: string;
    disputedForkIds: string[];
    disconnectedAddresses: string[];
    firedHooks: string[];
    restoreQueuedEntryCalled: boolean;
    signerAddress: string;
    fraudProofType: string | null;
    /** Source attribution the entry carried into validation. */
    sourcePeers: string[];
    /** How many times validation asked EventSyncService to recover calldata. */
    calldataRecoveryQueries: number;
};

/**
 * Method stub/restore for Byzantine and fault-injection scenarios. Each stub is
 * a concrete method (not a free-form path) so an SDK rename breaks compilation
 * here rather than failing silently at runtime. Originals are held per service
 * instance so they survive across RPC method invocations.
 *
 * `p2pManager` is typed as `P2PManager<HarnessControlRpc>`, so `localRpc` (the
 * SDK's own services included) is fully typed. Prefer targeting real members
 * directly; private internals use explicit local structural host types at the
 * stub site.
 */
export class StubService extends ARpcService<
    StubRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    readonly stubOriginals = new Map<StubKey, unknown>();
    /** Set by the record-dispute-ack stub when its method fires. */
    disputeAckRequestCalled = false;
    /** Set by the record-unsafe-set-latest-state stub when it fires. */
    unsafeSetLatestStateCalled = false;
    /** Set by the recording spectate guard when it blocks an RPC. */
    spectateGuardBlocked = false;
    /** Transport captured by the init-handshake capture stub (pre-handshake). */
    capturedInitHandshakeTransport?: ATransport;
    /** Set by the record-spectate-abort stub when `abort` fires. */
    spectateAbortCalled = false;
    /** Incremented by the count-spectate-requests stub per onSpectateRequest. */
    spectateRequestCount = 0;
    /** `reduction-*` timer tasks captured by the hold-reduction-tasks stub. */
    readonly heldReductionTasks: {
        taskName: string;
        task: () => void | Promise<void>;
    }[] = [];
    /** Event arg-tuples captured by the hold-event stubs. */
    readonly heldSnapshotUpdatedArgs: unknown[][] = [];
    readonly heldDisputeCommittedArgs: unknown[][] = [];
    readonly passedDisputeCommittedEventKeys =
        new Set<DisputeCommittedEventKey>();
    /** Subscribed calldata logs the hold stub has already lost once. */
    readonly heldCalldataPostedEventKeys = new Set<CalldataPostedEventKey>();
    /** Resolvers waiting for the first held calldata log. */
    private readonly heldCalldataPostedWaiters: (() => void)[] = [];
    /** Whether the dispute-event hold stub should pass its first new log. */
    passFirstDisputeCommittedEvent = true;
    readonly heldReducedCommitArgs: unknown[][] = [];
    /** Incremented per `ReductionManager.tryReduce` call by the noop/record stubs. */
    reduceCallCount = 0;
    /** Incremented per `spectateService.sync` by the record stub. */
    spectateSyncCallCount = 0;
    /** State for the already-entered old-fork reduction race stub. */
    pausedReduction?: PausedReductionState;
    /**
     * Serializes `runBlockValidation`'s record-only patch/restore region. The
     * patch replaces shared live methods (dispute, disconnect, restore), so two
     * overlapping probes would restore each other's replacements.
     */
    private readonly blockValidationProbeMutex = new Mutex();

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessStubService"
            })
        );
    }

    get sm() {
        return this.p2pManager.stateManager;
    }

    /**
     * Single owner of dispute-strategy construction for the stub probes, so
     * constructor inputs can't drift between them. `blockIndexInUnfinalized
     * PartOfStateProof` is 0 - the probes replay the first unfinalized block.
     */
    public createDisputeValidationStrategy(
        dispute: DisputeStruct
    ): DisputeValidationStrategy {
        return new DisputeValidationStrategy(
            this.sm.storage,
            dispute,
            0,
            this.sm.diamondStateMachine.localDiamondContract,
            this.sm.logger
        );
    }

    public notifyCalldataPostedEventHeld(): void {
        this.heldCalldataPostedWaiters
            .splice(0)
            .forEach((resolve) => resolve());
    }

    public waitForHeldCalldataPostedEvent(): Promise<boolean> {
        if (this.heldCalldataPostedEventKeys.size > 0) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) =>
            this.heldCalldataPostedWaiters.push(() => resolve(true))
        );
    }

    /**
     * Run `isDisputedFork` while counting the local-diamond queries, so a test
     * can prove which of the two sources decided. `markLocallyDisputed`
     * records the local marker first, as disputing the fork would.
     */
    public async probeIsDisputedFork(
        forkId: ForkId,
        markLocallyDisputed: boolean
    ): Promise<IsDisputedForkProbe> {
        if (markLocallyDisputed) {
            this.sm.storage.disputes.storeDisputedFork(forkId, true);
        }
        const localDiamond = this.sm.diamondStateMachine.localDiamondContract;
        const original = localDiamond.isForkDisputed;
        let onChainQueries = 0;
        localDiamond.isForkDisputed = ((
            ...args: Parameters<typeof original>
        ) => {
            onChainQueries += 1;
            return original(...args);
        }) as typeof localDiamond.isForkDisputed;
        try {
            const disputed = await this.sm.validationService.isDisputedFork(
                forkId,
                this.sm.channelId
            );
            return { disputed, onChainQueries };
        } finally {
            localDiamond.isForkDisputed = original;
        }
    }

    /**
     * Store a block straight into block storage, bypassing validation. Used to
     * build a dispute-replay chain that is deliberately incomplete: a stored
     * parent whose snapshot (or whose snapshot's state) is absent.
     */
    public storeBlockFixture(encodedBlockConfirmation: string): {
        hash: string;
    } {
        const block = Block.fromBlockConfirmation(
            Codec.decode(encodedBlockConfirmation, Type.BlockConfirmation)
        );
        this.sm.storage.blocks.storeBlock(block);
        return { hash: String(block.hash) };
    }

    /**
     * Store a state snapshot straight into snapshot storage, so a fixture
     * parent can point at a snapshot whose state machine state is missing.
     */
    public storeStateSnapshotFixture(encodedSnapshot: string): {
        hash: string;
    } {
        const snapshot = StateSnapshot.from(
            Codec.decode(encodedSnapshot, Type.StateSnapshot)
        );
        this.sm.storage.stateSnapshots.storeStateSnapshot(snapshot);
        return { hash: String(snapshot.hash) };
    }

    /**
     * Store on-chain calldata for a block at a chosen timestamp - the state a
     * real `postBlockCalldata` + recovery leaves behind, without needing the
     * chain to mine at that exact second.
     */
    public stageBlockCalldata(
        encodedSignedBlock: string,
        onChainTimestamp: Timestamp
    ): void {
        this.sm.storage.blockCalldata.storeBlockCalldata({
            signedBlock: Codec.decode(encodedSignedBlock, Type.SignedBlock),
            onChainTimestamp
        });
    }

    /**
     * Post a block's calldata on-chain the way the chain-fallback path does.
     * Returns the chain block number the post landed in.
     */
    public async postBlockCalldataOnChain(
        encodedSignedBlock: string
    ): Promise<{ blockNumber: number; onChainTimestamp: Timestamp }> {
        const tx = await this.sm.stateChannelManagerContract.postBlockCalldata(
            Codec.decode(encodedSignedBlock, Type.SignedBlock),
            Clock.getTimeInSeconds() + 1000
        );
        const receipt = await tx.wait();
        if (!receipt) throw new Error("postBlockCalldata produced no receipt");
        const chainBlock = await receipt.getBlock();
        return {
            blockNumber: receipt.blockNumber,
            onChainTimestamp: chainBlock.timestamp
        };
    }

    /** Exercise rejected-log retention through the real EventSyncService. */
    public async probeRejectedEventSyncLog(): Promise<EventSyncFailureProbe> {
        const sm = this.sm;
        const contract = sm.stateChannelManagerContract;
        const provider = contract.runner?.provider;
        if (!provider) throw new Error("Expected a provider for event sync");
        const latestBlock = await provider.getBlock("latest");
        if (!latestBlock?.hash) throw new Error("Expected a latest block");
        const stateSnapshot = await contract.getStateSnapshot(sm.channelId);
        const event = contract.interface.getEvent("StateSnapshotUpdated");
        const encodedEvent = contract.interface.encodeEventLog(event, [
            sm.channelId,
            stateSnapshot
        ]);
        const log = new Log(
            {
                address: String(contract.target),
                blockHash: latestBlock.hash,
                blockNumber: latestBlock.number + 1,
                data: encodedEvent.data,
                index: 0,
                removed: false,
                topics: encodedEvent.topics,
                transactionHash: id(`event-sync-failure-${Date.now()}`),
                transactionIndex: 0
            },
            provider
        );
        const eventHandler = sm.eventHandler;
        const original = eventHandler.onStateSnapshotUpdated.bind(eventHandler);
        let handlerCallCount = 0;
        eventHandler.onStateSnapshotUpdated = async () => {
            handlerCallCount += 1;
            throw new Error("Expected event-sync rejection");
        };
        const cursorBefore =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;
        try {
            const first = sm.eventSyncService.scheduleLog(log, sm.channelId);
            const second = sm.eventSyncService.scheduleLog(log, sm.channelId);
            DetachedPromises.collect(first);
            const [firstError, secondError] = await Promise.all([
                first.then(
                    () => null,
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                ),
                second.then(
                    () => null,
                    (error: unknown) =>
                        error instanceof Error ? error.message : String(error)
                )
            ]);
            const detached = await DetachedPromises.collectSettledAndClear();
            const rejected = detached.find(
                (result): result is PromiseRejectedResult =>
                    result.status === "rejected"
            );
            const detachedError = rejected
                ? rejected.reason instanceof Error
                    ? rejected.reason.message
                    : String(rejected.reason)
                : null;

            // A failed log is fatal - rescheduling it returns the cached
            // rejection and never re-enters the handler, even once the handler
            // would succeed.
            eventHandler.onStateSnapshotUpdated = async () => {
                handlerCallCount += 1;
            };
            const rescheduled = sm.eventSyncService.scheduleLog(
                log,
                sm.channelId
            );
            const rescheduledError = await rescheduled.then(
                () => null,
                (error: unknown) =>
                    error instanceof Error ? error.message : String(error)
            );

            return {
                samePromise: first === second,
                handlerCallCount,
                firstError,
                secondError,
                rescheduledError,
                cursorBefore,
                cursorAfter:
                    sm.storage.eventSync.getLatestProcessedBlock(
                        sm.channelId
                    ) ?? null,
                detachedError
            };
        } finally {
            eventHandler.onStateSnapshotUpdated = original;
        }
    }

    public async probeConcurrentCalldataRecovery(): Promise<ConcurrentCalldataRecoveryProbe> {
        const contract = this.sm.stateChannelManagerContract;
        const original = contract.getBlockCallDataCommitment;
        let queryCount = 0;
        let release: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        contract.getBlockCallDataCommitment = (async (...parameters) => {
            queryCount += 1;
            await held;
            return original(...parameters);
        }) as typeof contract.getBlockCallDataCommitment;
        try {
            const first =
                this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            const second =
                this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            release?.();
            const [firstResult, secondResult] = await Promise.all([
                first,
                second
            ]);
            const retryResult =
                await this.sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    id("recovery-fork"),
                    1,
                    this.sm.signerAddress
                );
            return {
                queryCount,
                firstFound: firstResult.blockCalldata !== undefined,
                secondFound: secondResult.blockCalldata !== undefined,
                retryFound: retryResult.blockCalldata !== undefined
            };
        } finally {
            contract.getBlockCallDataCommitment = original;
        }
    }

    public async probeDisputeStrategyResultMatrix(): Promise<DisputeStrategyResultMatrix> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const strategy = this.createDisputeValidationStrategy(dispute);
        const matrix: DisputeStrategyResultMatrix = {};
        for (const result of [
            BlockValidationResult.SUCCESS,
            BlockValidationResult.NOT_READY,
            BlockValidationResult.DISCONNECT,
            BlockValidationResult.DISPUTE,
            BlockValidationResult.BROADCAST,
            BlockValidationResult.NOT_ENOUGH_TIME,
            BlockValidationResult.DUPLICATE
        ]) {
            const name = BlockValidationResult[result];
            try {
                matrix[name] = String(
                    await strategy.interpretFinalValidationResult(result)
                );
            } catch {
                matrix[name] = "throw";
            }
        }
        return matrix;
    }

    public async probeCleanCommittedDivergence(): Promise<CleanCommittedDivergenceProbe> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const latestBlock = this.sm.storage.blocks.getLatestBlock(
            this.sm.forkId
        );
        if (!latestBlock) throw new Error("Expected a latest block");
        const strategy = this.createDisputeValidationStrategy(dispute);
        const result = await strategy.blockIsNotLinkedAndIsNotFirstBlock(
            this.sm.storage.queues.createEntry(latestBlock)
        );
        return {
            result: BlockValidationResult[result],
            proofStored:
                this.sm.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                ) !== undefined
        };
    }

    public async probeMissingParticipantSnapshots(): Promise<MissingParticipantSnapshotsProbe> {
        const { dispute } = await this.sm.disputeManager.constructDispute(
            this.sm.forkId
        );
        const latestBlock = this.sm.storage.blocks.getLatestBlock(
            this.sm.forkId
        );
        if (!latestBlock) throw new Error("Expected a latest block");
        const block = await Block.fromBlockStruct(
            {
                ...latestBlock.blockStruct,
                stateSnapshotHash: id("missing-participant-snapshot")
            },
            this.sm.signer
        );
        const strategy = this.createDisputeValidationStrategy(dispute);
        const entry = this.sm.storage.queues.createEntry(block);
        const earlyAuthorResult =
            await strategy.blockAuthorIsNotParticipant(entry);
        const signatureUnionResult =
            await strategy.notAllSingersAreParticipants(
                entry,
                new Set([block.originalSignature])
            );
        return {
            earlyAuthorResult: BlockValidationResult[earlyAuthorResult],
            signatureUnionResult: BlockValidationResult[signatureUnionResult],
            proofStored:
                this.sm.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
                    dispute
                ) !== undefined
        };
    }

    public async runBlockValidation(
        encodedBlockConfirmation: string,
        options?: BlockValidationProbeOptions
    ): Promise<BlockValidationProbe> {
        await this.blockValidationProbeMutex.lock({
            taskName: "stub-run-block-validation"
        });
        try {
            return await this.runBlockValidationLocked(
                encodedBlockConfirmation,
                options
            );
        } finally {
            this.blockValidationProbeMutex.unlock();
        }
    }

    private async runBlockValidationLocked(
        encodedBlockConfirmation: string,
        options?: BlockValidationProbeOptions
    ): Promise<BlockValidationProbe> {
        const sm = this.sm;
        const blockConfirmation = Codec.decode(
            encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const block = Block.fromBlockConfirmation(blockConfirmation);
        // same entry the gossip pipeline builds: a supplied copy carries its
        // sender into sourcePeers/signatureSources, a sourceless one doesn't
        const entry = sm.storage.queues.createEntry(block, {
            senderAddress: options?.senderAddress
        });
        // default: the live block strategy (PARTICIPATING). "dispute" builds a
        // real DisputeValidationStrategy - as dispute auditing does - so the
        // dispute-only branches (skip future/disputed gates, setState, the
        // isLinked !prevBlock edge) are drivable here. the dispute struct is
        // only referenced when a deviation stores fraud-proof evidence; the
        // paths driven here don't, so a placeholder dispute is faithful.
        const strategy =
            options?.strategy === "dispute"
                ? this.createDisputeValidationStrategy(
                      options.encodedDispute
                          ? Codec.decode(options.encodedDispute, Type.Dispute)
                          : factory.dispute()
                  )
                : sm.getActiveValidationStrategy();

        const disputedForkIds: string[] = [];
        const disconnectedAddresses: string[] = [];
        let restoreQueuedEntryCalled = false;

        // record-only: a real dispute posts on-chain against the crafted block,
        // a real disconnect cuts a live transport, a real restore re-arms a
        // queue timeout -> all would derail the session. Fraud-proof creation
        // stays real so the hook is identifiable by the persisted proof type.
        const disputeManager = (
            strategy as unknown as {
                disputeManager?: {
                    dispute: (forkId: ForkId) => Promise<void>;
                };
            }
        ).disputeManager;
        const originalDispute = disputeManager?.dispute.bind(disputeManager);
        if (disputeManager) {
            disputeManager.dispute = async (forkId: ForkId) => {
                disputedForkIds.push(String(forkId));
            };
        }
        const p2pManager = this.p2pManager;
        const originalDisconnect =
            p2pManager.disconnectAndBlacklistPeerByEvmAddress.bind(p2pManager);
        p2pManager.disconnectAndBlacklistPeerByEvmAddress = ((
            address: Address
        ) => {
            disconnectedAddresses.push(String(address));
        }) as typeof p2pManager.disconnectAndBlacklistPeerByEvmAddress;
        const originalRestore = sm.blockQueueManager.restoreQueuedEntry.bind(
            sm.blockQueueManager
        );
        sm.blockQueueManager.restoreQueuedEntry = (() => {
            restoreQueuedEntryCalled = true;
        }) as typeof sm.blockQueueManager.restoreQueuedEntry;
        // count-and-forward: recovery must stay real, the count only proves
        // validation reached the on-chain lookup
        let calldataRecoveryQueries = 0;
        const eventSyncService = sm.eventSyncService;
        const originalRecover =
            eventSyncService.tryRecoverBlockCalldataAndScheduleValidation.bind(
                eventSyncService
            );
        eventSyncService.tryRecoverBlockCalldataAndScheduleValidation = ((
            ...args: Parameters<typeof originalRecover>
        ) => {
            calldataRecoveryQueries += 1;
            return originalRecover(...args);
        }) as typeof eventSyncService.tryRecoverBlockCalldataAndScheduleValidation;

        // record which deviation hook the strategy fired, so a test can pin its
        // named guard
        const firedHooks: string[] = [];
        const instrumentedStrategy = new Proxy(strategy, {
            get(target, prop) {
                const value = Reflect.get(target, prop);
                if (typeof value !== "function") return value;
                return (...args: unknown[]) =>
                    Promise.resolve(
                        (value as (...a: unknown[]) => unknown).apply(
                            target,
                            args
                        )
                    ).then((resolved) => {
                        if (
                            typeof prop === "string" &&
                            typeof resolved === "number" &&
                            BlockValidationResult[resolved] !== undefined
                        ) {
                            firedHooks.push(prop);
                        }
                        return resolved;
                    });
            }
        });

        try {
            const result = await sm.validationService.validateBlockConfirmation(
                entry,
                instrumentedStrategy
            );
            const fraudProof =
                sm.storage.fraudProofs.getFraudProofForParticipant(
                    block.signerAddress
                );
            return {
                result,
                resultName:
                    BlockValidationResult[result] ?? `UNKNOWN(${result})`,
                disputedForkIds,
                disconnectedAddresses,
                firedHooks,
                restoreQueuedEntryCalled,
                signerAddress: String(block.signerAddress),
                fraudProofType: fraudProof
                    ? String(fraudProof.proofType)
                    : null,
                sourcePeers: [...entry.sourcePeers].map(String),
                calldataRecoveryQueries
            };
        } finally {
            if (disputeManager && originalDispute) {
                disputeManager.dispute = originalDispute;
            }
            p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                originalDisconnect;
            sm.blockQueueManager.restoreQueuedEntry = originalRestore;
            eventSyncService.tryRecoverBlockCalldataAndScheduleValidation =
                originalRecover;
        }
    }

    private async runAuthorGate(
        author: Address,
        stateSnapshotHash: Hash,
        coordinates?: { forkId: ForkId; height: number }
    ): Promise<string> {
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId);
        if (!head) throw new Error("Expected a latest block");

        const blockStruct = {
            ...factory.blockStructWithTransactionHeader(head.blockStruct, {
                participant: author,
                transactionCnt: coordinates?.height ?? head.height + 1,
                forkId: coordinates?.forkId ?? this.sm.forkId
            }),
            previousBlockHash: head.hash,
            stateSnapshotHash
        };
        const block = await Block.fromBlockStruct(blockStruct, this.sm.signer);

        const { strategy, result } = recordValidationBoundary(
            this.sm.blockValidationStrategy
        );
        await this.sm.validationService.validateBlockConfirmation(
            this.sm.storage.queues.createEntry(block),
            strategy
        );
        // the staged blocks always target the live, open channel - stopping
        // this early means the staging broke, not that the gate decided
        if (["wrongChannel", "channelNotOpened"].includes(result.reached)) {
            throw new Error(
                `author-gate probe stopped at ${result.reached}, before the gate`
            );
        }
        return result.reached;
    }

    /** The head block's own resulting snapshot - the anchor the gate binds against. */
    private previousSnapshot(): StateSnapshot {
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId);
        if (!head) throw new Error("Expected a latest block");
        const snapshot = this.sm.storage.stateSnapshots.getStateSnapshotByHash(
            head.stateSnapshotHash
        );
        if (!snapshot) throw new Error("Expected the latest block's snapshot");
        return snapshot;
    }

    /** Store a snapshot listing `participants` at the given coordinates. */
    private storeSnapshotAt(
        participants: Address[],
        height: number,
        forkId: ForkId = this.sm.forkId
    ): Hash {
        const snapshot = factory.stateSnapshot({
            forkId,
            blockHeight: height,
            timestamp: 0,
            snapshotData: factory.snapshotData({ participants })
        });
        this.sm.storage.stateSnapshots.storeStateSnapshot(snapshot);
        return snapshot.hash;
    }

    private nextHeight(): number {
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId);
        if (!head) throw new Error("Expected a latest block");
        return head.height + 1;
    }

    private randomAddress(): Address {
        return ethers.Wallet.createRandom().address as Address;
    }

    /** Coordinates with no locally-anchored previous snapshot. */
    private unanchoredCoordinates() {
        return {
            forkId: id("probeAuthorGate-unknown-fork") as ForkId,
            height: 1
        };
    }

    /** Author already listed in the previous snapshot. */
    public async probeAuthorGatePreviousSnapshotMember(): Promise<string> {
        const previous = this.previousSnapshot();
        const member = previous.snapshotData.participants[0] as Address;
        const head = this.sm.storage.blocks.getLatestBlock(this.sm.forkId)!;
        return this.runAuthorGate(member, head.stateSnapshotHash);
    }

    /** Author only in a resulting snapshot bound to the block's own coordinates. */
    public async probeAuthorGateMatchingResultingSnapshot(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [outsider],
            this.nextHeight()
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Author only in a resulting snapshot from a different height. */
    public async probeAuthorGateStaleHeightSnapshot(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [outsider],
            this.nextHeight() + 100
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Author only in a resulting snapshot from a different fork, same height. */
    public async probeAuthorGateWrongForkSnapshot(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [outsider],
            this.nextHeight(),
            id("probeAuthorGate-wrong-fork") as ForkId
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Resulting snapshot matches the coordinates but omits the author. */
    public async probeAuthorGateMatchingSnapshotExcludingAuthor(): Promise<string> {
        const outsider = this.randomAddress();
        const snapshotHash = this.storeSnapshotAt(
            [this.randomAddress()],
            this.nextHeight()
        );
        return this.runAuthorGate(outsider, snapshotHash);
    }

    /** Declared resulting snapshot absent from storage; author is in the previous one. */
    public async probeAuthorGateMissingSnapshotPreviousMember(): Promise<string> {
        const member = this.previousSnapshot().snapshotData
            .participants[0] as Address;
        return this.runAuthorGate(
            member,
            id("probeAuthorGate-unstored-result") as Hash
        );
    }

    /** Declared resulting snapshot absent from storage; author is an outsider. */
    public async probeAuthorGateMissingSnapshotOutsider(): Promise<string> {
        return this.runAuthorGate(
            this.randomAddress(),
            id("probeAuthorGate-unstored-result") as Hash
        );
    }

    /** No local anchor; author is a current on-chain participant. */
    public async probeAuthorGateNoAnchorCurrentParticipant(): Promise<string> {
        const member = this.previousSnapshot().snapshotData
            .participants[0] as Address;
        return this.runAuthorGate(
            member,
            ethers.ZeroHash as Hash,
            this.unanchoredCoordinates()
        );
    }

    /** No local anchor; author is a pending (not-yet-current) on-chain participant. */
    public async probeAuthorGateNoAnchorPendingParticipant(
        pendingParticipant: Address
    ): Promise<string> {
        return this.runAuthorGate(
            pendingParticipant,
            ethers.ZeroHash as Hash,
            this.unanchoredCoordinates()
        );
    }

    /** No local anchor; author is unrelated to the channel. */
    public async probeAuthorGateNoAnchorUnknownAddress(): Promise<string> {
        return this.runAuthorGate(
            this.randomAddress(),
            ethers.ZeroHash as Hash,
            this.unanchoredCoordinates()
        );
    }

    public createRPCMethods(transport: ATransport): StubRpcMethods {
        return new StubRpcMethods(transport, this);
    }
}

export default StubService;

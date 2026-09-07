// @spec-test-coverage-ignore: host-side validation probes
import { recordValidationBoundary } from "./RecordingValidationStrategy";
import ValidationProbeRpcMethods from "./ValidationProbeRpcMethods";
import type { HarnessControlRpc } from "../../HarnessControlRpc";
import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import type P2PManager from "@/P2PManager";
import ARpcService from "@/rpc/ARpcService";
import type AValidationStrategy from "@/stateManager/validationStrategy/AValidationStrategy";
import CalldataCommittedStrategy from "@/stateManager/validationStrategy/CalldataCommittedStrategy";
import DisputeValidationStrategy from "@/stateManager/validationStrategy/DisputeValidationStrategy";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import type ATransport from "@/transport/ATransport";
import { BlockValidationResult } from "@/types";
import type { Address, ForkId, Hash, Timestamp } from "@/types/types";
import { Codec, Mutex, Type } from "@/utils";
import * as factory from "@test/factory";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { ethers, id } from "ethers";

export type ConcurrentCalldataRecoveryProbe = {
    queryCount: number;
    firstFound: boolean;
    secondFound: boolean;
    retryFound: boolean;
};

export type ReductionChallengeProbe = {
    /** Recorded challenge sends - a real one would derail the session. */
    challengeCalls: number;
    /** The verdict: true = do not challenge. Null when the call threw. */
    isValid: boolean | null;
    threw: string | null;
};

export type InboundRunRecoveryProbe = {
    /** Provider getLogs calls the recovery made (0 when storage sufficed). */
    queryCount: number;
    /** Each attempt's `fromBlock`, in attempt order. */
    queriedFromBlocks: (number | null)[];
    /** The event-sync watermark when the call started. */
    cursorAtCall: number | null;
    /** The `toBlock` every attempt queried up to. */
    toBlock: number | null;
    /** InboundMessagesProcessed logs the recovery dispatched. */
    scheduledLogCount: number;
    /** Blocks returned, or null when the gap survived recovery. */
    blockCount: number | null;
    /** Whether the peer held the requested head before the call. */
    heldBefore: boolean;
    heldAfter: boolean;
    /** Set only if the recovery threw - its contract says it never does. */
    threw: string | null;
};

export type BlockCalldataRecoveryProbe = {
    /** Whether the recovery ended with the calldata in local storage. */
    recoveredCalldata: boolean;
    /** Whether the recovery dispatched a calldata log for validation. */
    validationScheduled: boolean;
    /** Provider getLogs calls the recovery made. */
    queryCount: number;
    /** Set only if the recovery threw - its contract says it never does. */
    threw: string | null;
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

export type BlockProbeOptions = {
    strategy?: "active" | "dispute" | "spectating";
    encodedDispute?: string;
    /** Supplier of this copy - drives `sourcePeers`/`signatureSources`. */
    senderAddress?: Address;
};

export type BlockValidationProbeOptions = BlockProbeOptions & {
    /**
     * Drive this one deviation hook instead of validateBlockConfirmation -
     * for branches the pipeline can't reach: an unknown-fork entry is never
     * handed to `validateBlockConfirmation` because
     * `BlockQueueManager.scheduleQueueExecution` and `tryExecuteFromQueue`
     * both return early on a non-current fork, so the missing-genesis branch
     * is only reachable by calling the hook.
     */
    hook?: "blockAuthorIsNotParticipant" | "wrongGenesisDetected";
    /**
     * "validate" (default) runs validateBlockConfirmation only; "full" runs
     * the whole onBlockConfirmation pipeline (assembly, hash compare, VM
     * restore) under the same record-only side-effect wrappers.
     */
    pipeline?: "validate" | "full";
};

export type BlockValidationProbe = {
    result: number;
    resultName: string;
    /** Which strategy implementation ran (live, spectating, dispute, ...). */
    strategyName: string;
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
    subjectiveWarningCount: number;
};

export type BlockIngestProbe = BlockValidationProbe & {
    /** onBlockConfirmation's return value. */
    keepConnection: boolean;
};

/**
 * One in-flight runBlockValidation/runBlockIngest call: the decoded block and
 * entry, the chosen strategy (`instrumentedStrategy` is the same strategy
 * wrapped to log fired deviation hooks into `recorded`), the side effects the
 * record-only stubs captured, and `restore()` to put the patched live methods
 * back.
 */
type RecordedValidationRun = {
    block: Block;
    entry: QueuedBlockEntry;
    strategy: AValidationStrategy;
    instrumentedStrategy: AValidationStrategy;
    recorded: {
        disputedForkIds: string[];
        disconnectedAddresses: string[];
        firedHooks: string[];
        restoreQueuedEntryCalled: boolean;
        calldataRecoveryQueries: number;
        subjectiveWarningCount: number;
        lastHookResult: BlockValidationResult | undefined;
    };
    restore: () => void;
};
export class ValidationProbeService extends ARpcService<
    ValidationProbeRpcMethods,
    P2PManager<HarnessControlRpc>
> {
    /**
     * Serializes runBlockValidation/runBlockIngest's record-only
     * patch/restore region. The
     * patch replaces shared live methods (dispute, disconnect, restore), so two
     * overlapping probes would restore each other's replacements.
     */
    private readonly blockValidationProbeMutex = new Mutex();

    constructor(p2pManager: P2PManager<HarnessControlRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "HarnessValidationProbeService"
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

    /**
     * Run the real `loadSynchronizedInboundRun` for `upperBlockHash`, bounded
     * below by this peer's fork-genesis inbound head, recording the chain
     * queries it makes (count and each query's span) and how many logs it
     * dispatched.
     */
    public async probeInboundRunRecovery(
        upperBlockHash: Hash,
        options?: { failChainQueries?: boolean }
    ): Promise<InboundRunRecoveryProbe> {
        const sm = this.sm;
        const genesis = sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
            sm.forkId
        );
        if (!genesis) throw new Error("Expected a genesis snapshot");
        const held = () =>
            Boolean(sm.storage.inboundMessages.getMessageBlock(upperBlockHash));
        const heldBefore = held();
        const cursorAtCall =
            sm.storage.eventSync.getLatestProcessedBlock(sm.channelId) ?? null;

        if (options?.failChainQueries)
            this.p2pManager.localRpc.stub.failChainLogQueries();
        else this.p2pManager.localRpc.stub.countChainLogQueries();
        // count-and-forward: the driver's dispatch count is what proves an
        // already-applied log is not re-dispatched
        const eventSyncService = sm.eventSyncService;
        const originalScheduleLog =
            eventSyncService.scheduleLog.bind(eventSyncService);
        let scheduledLogCount = 0;
        eventSyncService.scheduleLog = ((log, scheduledChannelId) => {
            const parsed = sm.stateChannelManagerContract.interface.parseLog({
                topics: log.topics,
                data: log.data
            });
            if (parsed?.name === "InboundMessagesProcessed") {
                scheduledLogCount += 1;
            }
            return originalScheduleLog(log, scheduledChannelId);
        }) as typeof eventSyncService.scheduleLog;

        try {
            const run = await sm.eventSyncService.loadSynchronizedInboundRun(
                upperBlockHash,
                genesis.latestInboundMessageBlockHash,
                genesis.timestamp
            );
            return {
                ...this.p2pManager.localRpc.stub.describeChainLogQueries(),
                cursorAtCall,
                scheduledLogCount,
                blockCount: run ? run.length : null,
                heldBefore,
                heldAfter: held(),
                threw: null
            };
        } catch (error) {
            return {
                ...this.p2pManager.localRpc.stub.describeChainLogQueries(),
                cursorAtCall,
                scheduledLogCount,
                blockCount: null,
                heldBefore,
                heldAfter: held(),
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            eventSyncService.scheduleLog = originalScheduleLog;
            this.p2pManager.localRpc.stub.restoreChainLogQueries();
        }
    }

    /**
     * Lose a subscribed `BlockCalldataPosted` delivery for one of this peer's
     * own blocks, then run the real calldata recovery for that block. With
     * `failChainQueries` the recovery query is blinded, so the contained
     * failure path runs instead.
     */
    public async probeBlockCalldataRecovery(options?: {
        failChainQueries?: boolean;
    }): Promise<BlockCalldataRecoveryProbe> {
        const sm = this.sm;
        const forkId = sm.forkId;
        const block = await this.findOwnBlockWithoutPostedCalldata(forkId);

        this.p2pManager.localRpc.stub.holdCalldataPostedEvents();
        if (options?.failChainQueries)
            this.p2pManager.localRpc.stub.failChainLogQueries();
        else this.p2pManager.localRpc.stub.countChainLogQueries();

        try {
            await this.postBlockCalldataOnChain(
                Codec.encode(block.signedBlock, Type.SignedBlock) as string
            );
            // premise - the subscribed delivery really was lost
            await this.p2pManager.localRpc.stub.waitForHeldCalldataPostedEvent();
            const recovery =
                await sm.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    forkId,
                    block.height,
                    block.author
                );
            return {
                recoveredCalldata: recovery.blockCalldata !== undefined,
                validationScheduled: recovery.validationScheduled,
                queryCount:
                    this.p2pManager.localRpc.stub.chainLogQueries.length,
                threw: null
            };
        } catch (error) {
            return {
                recoveredCalldata: false,
                validationScheduled: false,
                queryCount:
                    this.p2pManager.localRpc.stub.chainLogQueries.length,
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            this.p2pManager.localRpc.stub.restoreChainLogQueries();
            this.p2pManager.localRpc.stub.restoreCalldataPostedEvents();
        }
    }

    /**
     * The newest block this peer authored whose on-chain calldata slot is
     * still free - only its author may post it, and only once.
     */
    private async findOwnBlockWithoutPostedCalldata(forkId: ForkId) {
        const latest = this.sm.storage.blocks.getLatestBlock(forkId);
        if (!latest) throw new Error("Expected a block on the current fork");
        for (let height = Number(latest.height); height >= 0; height--) {
            const block = this.sm.storage.blocks.getBlock(forkId, height);
            if (!block || block.author !== this.sm.signerAddress) continue;
            const commitment =
                await this.sm.stateChannelManagerContract.getBlockCallDataCommitment(
                    this.sm.channelId,
                    forkId,
                    height,
                    block.author
                );
            if (!commitment.found) return block;
        }
        throw new Error("Expected an own block with a free calldata slot");
    }

    /**
     * Run the real `validateDisputeReductionAndChallenge` against a claimed
     * `reducedForkId`, recording the challenge send instead of making it - a
     * real challenge transaction would derail the session.
     */
    public async probeDisputeReductionChallenge(
        reducedForkId: ForkId
    ): Promise<ReductionChallengeProbe> {
        const contract = this.sm.stateChannelManagerContract;
        const original = contract.challengeDisputeReduction;
        let challengeCalls = 0;
        contract.challengeDisputeReduction =
            this.p2pManager.localRpc.stub.asRecordingContractMethod(
                original,
                async () => {
                    challengeCalls += 1;
                    return { wait: async () => null };
                }
            );
        try {
            const isValid = await this.sm.eventHandler[
                "validateDisputeReductionAndChallenge"
            ](this.sm.forkId, reducedForkId);
            return { challengeCalls, isValid, threw: null };
        } catch (error) {
            return {
                challengeCalls,
                isValid: null,
                threw: error instanceof Error ? error.message : String(error)
            };
        } finally {
            contract.challengeDisputeReduction = original;
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

    /**
     * White-box: run `tryMergeStoredBlockConfirmation` against the entry built
     * from the confirmation, under the peer's live, spectating, calldata, or a
     * fabricated dispute strategy. Returns the merge result and the persisted
     * signature set for the block's hash.
     */
    public async runStoredBlockMerge(
        encodedBlockConfirmation: string,
        options?: {
            strategy?: "active" | "dispute" | "spectating" | "calldata";
        }
    ): Promise<{
        result: number | null;
        persistedSignatures: string[] | null;
    }> {
        const sm = this.sm;
        const blockConfirmation = Codec.decode(
            encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const block = Block.fromBlockConfirmation(blockConfirmation);
        const entry = sm.storage.queues.createEntry(block);
        let strategy: AValidationStrategy;
        switch (options?.strategy) {
            case "dispute":
                strategy = this.createDisputeValidationStrategy(
                    factory.dispute()
                );
                break;
            case "spectating":
                strategy = sm.spectatingValidationStrategy;
                break;
            case "calldata":
                // built as EventHandler builds it for a CalldataPosted event
                strategy = new CalldataCommittedStrategy(
                    sm.disputeManager,
                    sm.blockValidationStrategy
                );
                break;
            default:
                strategy = sm.blockValidationStrategy;
        }
        const result =
            await sm.storedBlockMergeService.tryMergeStoredBlockConfirmation(
                entry,
                strategy
            );
        const persisted = sm.storage.blocks.getBlock(block.hash);
        return {
            result: result === undefined ? null : Number(result),
            persistedSignatures: persisted
                ? Array.from(persisted.confirmationSignatures).map(String)
                : null
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
            const run = this.startRecordedValidation(
                encodedBlockConfirmation,
                options
            );
            try {
                const result = options?.hook
                    ? await run.instrumentedStrategy[options.hook](run.entry)
                    : await this.sm.validationService.validateBlockConfirmation(
                          run.entry,
                          run.instrumentedStrategy
                      );
                return this.buildValidationProbe(run, result);
            } finally {
                run.restore();
            }
        } finally {
            this.blockValidationProbeMutex.unlock();
        }
    }

    /**
     * White-box: run the whole onBlockConfirmation pipeline (assembly, hash
     * compare, VM restore) under the same record-only side-effect wrappers as
     * `runBlockValidation`. `result` is the last deviation-hook verdict, or
     * SUCCESS when none fired.
     */
    public async runBlockIngest(
        encodedBlockConfirmation: string,
        options?: BlockProbeOptions
    ): Promise<BlockIngestProbe> {
        await this.blockValidationProbeMutex.lock({
            taskName: "stub-run-block-ingest"
        });
        try {
            const run = this.startRecordedValidation(
                encodedBlockConfirmation,
                options
            );
            try {
                const keepConnection =
                    await this.sm.blockIngestService.onBlockConfirmation(
                        run.entry,
                        { validationStrategy: run.instrumentedStrategy }
                    );
                const result =
                    run.recorded.lastHookResult ??
                    BlockValidationResult.SUCCESS;
                return {
                    ...this.buildValidationProbe(run, result),
                    keepConnection
                };
            } finally {
                run.restore();
            }
        } finally {
            this.blockValidationProbeMutex.unlock();
        }
    }

    /**
     * Decode the confirmation, build the same entry the gossip pipeline
     * builds, pick the strategy, and swap the destructive side effects
     * (dispute, disconnect, queue restore) for recorders. The caller drives
     * validation against `entry`/`instrumentedStrategy`, reads what happened
     * off `recorded`, and MUST call `restore()` when done.
     */
    private startRecordedValidation(
        encodedBlockConfirmation: string,
        options: BlockProbeOptions | undefined
    ): RecordedValidationRun {
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
                : options?.strategy === "spectating"
                  ? sm.spectatingValidationStrategy
                  : sm.getActiveValidationStrategy();

        const recorded: RecordedValidationRun["recorded"] = {
            disputedForkIds: [],
            disconnectedAddresses: [],
            firedHooks: [],
            restoreQueuedEntryCalled: false,
            calldataRecoveryQueries: 0,
            subjectiveWarningCount: 0,
            lastHookResult: undefined
        };

        const logStore = sm.logger["logStore"];
        const originalStoreLog = logStore.store.bind(logStore);
        logStore.store = (entry) => {
            if (
                entry.level === "warn" &&
                entry.meta.some((meta) => meta?.checkType === "subjective")
            )
                recorded.subjectiveWarningCount += 1;
            originalStoreLog(entry);
        };

        // record-only: a real dispute posts on-chain against the crafted block,
        // a real disconnect cuts a live transport, a real restore re-arms a
        // queue timeout -> all would derail the session. Fraud-proof creation
        // stays real so the hook is identifiable by the persisted proof type.
        const disputeManager = sm.disputeManager;
        const originalDispute = disputeManager?.dispute.bind(disputeManager);
        if (disputeManager) {
            disputeManager.dispute = async (forkId: ForkId) => {
                recorded.disputedForkIds.push(String(forkId));
            };
        }
        const p2pManager = this.p2pManager;
        const originalDisconnect =
            p2pManager.disconnectAndBlacklistPeerByEvmAddress.bind(p2pManager);
        p2pManager.disconnectAndBlacklistPeerByEvmAddress = ((
            address: Address
        ) => {
            recorded.disconnectedAddresses.push(String(address));
        }) as typeof p2pManager.disconnectAndBlacklistPeerByEvmAddress;
        const originalRestore = sm.blockQueueManager.restoreQueuedEntry.bind(
            sm.blockQueueManager
        );
        sm.blockQueueManager.restoreQueuedEntry = (() => {
            recorded.restoreQueuedEntryCalled = true;
        }) as typeof sm.blockQueueManager.restoreQueuedEntry;
        // count-and-forward: recovery must stay real, the count only proves
        // validation reached the on-chain lookup
        const eventSyncService = sm.eventSyncService;
        const originalRecover =
            eventSyncService.tryRecoverBlockCalldataAndScheduleValidation.bind(
                eventSyncService
            );
        eventSyncService.tryRecoverBlockCalldataAndScheduleValidation = ((
            ...args: Parameters<typeof originalRecover>
        ) => {
            recorded.calldataRecoveryQueries += 1;
            return originalRecover(...args);
        }) as typeof eventSyncService.tryRecoverBlockCalldataAndScheduleValidation;

        // record which deviation hook the strategy fired, so a test can pin its
        // named guard
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
                            recorded.firedHooks.push(prop);
                            recorded.lastHookResult =
                                resolved as BlockValidationResult;
                        }
                        return resolved;
                    });
            }
        });

        return {
            block,
            entry,
            strategy,
            instrumentedStrategy,
            recorded,
            restore: () => {
                logStore.store = originalStoreLog;
                if (disputeManager && originalDispute) {
                    disputeManager.dispute = originalDispute;
                }
                p2pManager.disconnectAndBlacklistPeerByEvmAddress =
                    originalDisconnect;
                sm.blockQueueManager.restoreQueuedEntry = originalRestore;
                eventSyncService.tryRecoverBlockCalldataAndScheduleValidation =
                    originalRecover;
            }
        };
    }

    private buildValidationProbe(
        run: RecordedValidationRun,
        result: BlockValidationResult
    ): BlockValidationProbe {
        const fraudProof =
            this.sm.storage.fraudProofs.getFraudProofForParticipant(
                run.block.signerAddress
            );
        return {
            result,
            resultName: BlockValidationResult[result] ?? `UNKNOWN(${result})`,
            strategyName: run.strategy.name,
            disputedForkIds: run.recorded.disputedForkIds,
            disconnectedAddresses: run.recorded.disconnectedAddresses,
            firedHooks: run.recorded.firedHooks,
            restoreQueuedEntryCalled: run.recorded.restoreQueuedEntryCalled,
            signerAddress: String(run.block.signerAddress),
            fraudProofType: fraudProof ? String(fraudProof.proofType) : null,
            sourcePeers: [...run.entry.sourcePeers].map(String),
            calldataRecoveryQueries: run.recorded.calldataRecoveryQueries,
            subjectiveWarningCount: run.recorded.subjectiveWarningCount
        };
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
    public createRPCMethods(transport: ATransport): ValidationProbeRpcMethods {
        return new ValidationProbeRpcMethods(transport, this);
    }
}

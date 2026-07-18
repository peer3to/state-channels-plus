// External libraries
import { ethers, ZeroHash, TransactionResponse } from "ethers";

// TypeChain types - Data types
import {
    TransactionStruct,
    SignedBlockStruct,
    BalanceStruct,
    StateSnapshotStruct,
    BlockConfirmationStruct,
    BlockStruct,
    SnapshotDataStruct,
    MessageStruct,
    MessageBlockStruct,
    JoinChannelConfirmationStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

// TypeChain types - Dispute types
import { TimeoutStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

// TypeChain types - Contract interfaces
import { StateChannelManagerProxy } from "@typechain-types";

// Core components
import AgreementManager from "../agreementManager/AgreementManager";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import DisputeManager from "@/disputeManager";
import P2PManager from "@/P2PManager";
import StateChannelEventListener from "@/StateChannelEventListener";
import ValidationService from "./ValidationService";
import { ReductionManager } from "./reduction";
import { SnapshotUpdateService } from "./snapshotUpdate";
import Storage from "@/storage";
import type { QueuedBlockEntry } from "@/storage/QueueStorage";
import { EventHandler } from "@/eventHandlers/EventHandler";
import {
    tryDecodeCustomError,
    tryHandleEvmError
} from "@/utils/evmErrorHandler";

// Event handlers and processors
import P2pEventHooks from "@/P2pEventHooks";

// Models
import { Block, BlockCoordinates, StateSnapshot } from "@/models";

// Utils
import {
    DebugProxy,
    Mutex,
    Codec,
    Type,
    hash,
    difference,
    isSubset,
    Logger,
    DetachedPromises,
    createEthersResultProxy,
    getChecksumAddress,
    union
} from "@/utils";
import type { MutexLockOptions, MutexUnlockOptions } from "@/utils";
// Types
import {
    BlockValidationResult,
    Status,
    TimeConfig,
    firstBlockGrace
} from "@/types";
import {
    Address,
    BlockHeight,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";

import FraudProofService from "./utils/FraudProofService";
import DisputeValidationService from "./DisputeValidationService";
import AValidationStrategy from "./validationStrategy/AValidationStrategy";
import BlockValidationStrategy from "./validationStrategy/BlockValidationStrategy";
import SpectatingValidationStrategy from "./validationStrategy/SpectatingValidationStrategy";

import { config } from "@/utils/config";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";
import MainRpcService from "@/rpc/MainRpcService";
import type { CustomRpcConstructor } from "@/rpc/registry";
import DisputeValidationStrategy from "./validationStrategy/DisputeValidationStrategy";
import EventSyncService from "./EventSyncService";
import BlockQueueManager, {
    IngestBlockConfirmationOptions
} from "./BlockQueueManager";

const NULL = ZeroHash;

type ParticipantChanges = {
    left: Set<Address>;
    joined: Set<Address>;
};

class StateManager<
    TCustomRpc extends MainRpcService = MainRpcService,
    TCustomRpcOptions = undefined
> {
    diamondStateMachine: ADiamondStateMachine;
    p2pEventHooks: P2pEventHooks;
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelEventListener: StateChannelEventListener;
    disputeManager: DisputeManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    p2pManager: P2PManager<TCustomRpc>;
    timeConfig: TimeConfig;
    channelId: ChannelId = NULL;
    mutex: Mutex;
    self = config.DEBUG_STATE_MANAGER ? DebugProxy.createProxy(this) : this;
    isDisposed: boolean = false;
    validationService: ValidationService;
    disputeValidationService: DisputeValidationService;
    storage: Storage;
    fraudProofService: FraudProofService;
    latestForkId: ForkId = NULL;
    blockValidationStrategy: BlockValidationStrategy;
    spectatingValidationStrategy: SpectatingValidationStrategy;
    eventHandler: EventHandler;
    status: Status = Status.NOT_OPENED;
    timeoutManager: TimeoutManager;
    logger: Logger;
    readonly eventSyncService: EventSyncService;
    blockQueueManager: BlockQueueManager;
    readonly reductionManager: ReductionManager;
    readonly snapshotUpdateService: SnapshotUpdateService;
    private disposalPromise?: Promise<void>;

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        logger: Logger,
        customRpc?: CustomRpcConstructor<TCustomRpc, TCustomRpcOptions>,
        customRpcOptions?: TCustomRpcOptions
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.diamondStateMachine = diamondStateMachine;
        this.p2pEventHooks = p2pEventHooks;
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = createEthersResultProxy(
            stateChannelManagerContract
        ) as StateChannelManagerProxy;
        this.storage = storage;

        this.logger = logger.child({ component: "StateManager" });
        this.mutex = new Mutex(
            this.logger.child({ component: "StateManager:Mutex" })
        );
        this.timeoutManager = new TimeoutManager(logger);

        this.eventHandler = new EventHandler(
            this.storage,
            this.self,
            this.p2pEventHooks,
            this.diamondStateMachine,
            logger
        );
        this.eventSyncService = new EventSyncService(
            this.channelId,
            this.stateChannelManagerContract,
            this.eventHandler,
            this.storage,
            this.timeConfig,
            logger
        );
        this.stateChannelEventListener = new StateChannelEventListener(
            this.stateChannelManagerContract,
            this.eventSyncService,
            logger
        );
        this.agreementManager = new AgreementManager(this.storage, this.logger);
        this.disputeManager = new DisputeManager(
            this.channelId,
            signer,
            signerAddress,
            this.agreementManager,
            this.stateChannelManagerContract,
            this.p2pEventHooks,
            this.storage,
            this.diamondStateMachine,
            logger
        );
        this.p2pManager = new P2PManager<TCustomRpc>(
            this.self,
            signer,
            customRpc,
            customRpcOptions
        );
        this.blockQueueManager = new BlockQueueManager(
            this.self,
            this.timeConfig,
            this.timeoutManager,
            this.logger
        );
        this.reductionManager = new ReductionManager(this.self, this.logger);
        this.snapshotUpdateService = new SnapshotUpdateService(
            this.self,
            this.logger
        );
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
        this.validationService = new ValidationService(
            this.storage,
            this.diamondStateMachine,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.eventSyncService,
            this.self,
            this.logger
        );
        this.disputeValidationService = new DisputeValidationService(this.self);
        this.blockValidationStrategy = new BlockValidationStrategy(
            this.storage,
            this.p2pManager,
            this.disputeManager,
            this.blockQueueManager,
            this.logger
        );
        this.spectatingValidationStrategy = new SpectatingValidationStrategy(
            this.storage,
            this.p2pManager,
            this.blockQueueManager,
            this.logger
        );
    }
    /**
     * General abort: give up participation in the current channel and tear down
     * P2P and chain resources. Used by any component/service that needs to stop
     * participating (slashed/removed by dispute resolution, unrecoverable sync
     * failure, race-condition join). We tear down the event listener so we no
     * longer track state — drop to OPENED (channel exists on-chain, not synced)
     * rather than SYNCED or NOT_OPENED.
     */
    public abort() {
        if (this.disposalPromise) return;
        // TODO: Abort should tear down the entire peer runtime and control port
        // so disposed peers cannot continue serving host RPC queries.
        this.logger.warn("Aborting channel participation", {
            channelId: this.channelId,
            status: Status[this.status]
        });
        this.p2pEventHooks.onAbort?.();
        this.setStatus(Status.OPENED);
        DetachedPromises.collect(this.dispose());
    }

    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.isDisposed = true;
        this.reductionManager.dispose();

        this.disposalPromise = Promise.all([
            this.timeoutManager.dispose(),
            this.stateChannelEventListener.dispose(),
            this.p2pManager.dispose(),
            this.diamondStateMachine.dispose()
        ])
            .then(() => undefined)
            .finally(() => {
                this.logger.dispose({
                    cascadeChildren: true,
                    cascadeParent: true
                });
            });
        return this.disposalPromise;
    }
    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pEventHooks = p2pEventHooks;
    }

    public setStatus(status: Status) {
        const oldStatus = this.status;
        if (oldStatus === status) {
            return;
        }
        this.logger.debug("Status changed", {
            oldStatus: Status[oldStatus] ?? `UNKNOWN(${oldStatus})`,
            newStatus: Status[status] ?? `UNKNOWN(${status})`
        });
        this.status = status;
        this.p2pEventHooks.onStatusChanged?.(oldStatus, status);
    }
    public getStatus(): Status {
        return this.status;
    }

    /**
     * Refreshes the status from on-chain `isChannelOpen(channelId)`.
     *
     * Intended for the early lifecycle where we know the channelId (e.g. after
     * `connectToChannel`) but we haven't synced/appplied the genesis snapshot yet.
     */
    public async refreshOpenedStatusFromChain(): Promise<Status> {
        if (!this.channelId || this.channelId === NULL) {
            this.setStatus(Status.NOT_OPENED);
            return this.status;
        }

        try {
            const [isOpen, snapshotStruct] =
                await this.stateChannelManagerContract.isChannelOpen(
                    this.channelId
                );

            if (isOpen) {
                // Best-effort cache: store the latest on-chain snapshot in LocalDiamond
                try {
                    await this.diamondStateMachine.localDiamondContract.onStateSnapshotUpdated(
                        this.channelId,
                        snapshotStruct,
                        0,
                        0
                    );
                    const snapshotMeta = LoggerUtils.getSnapshotMetadata(
                        StateSnapshot.from(snapshotStruct)
                    );
                    this.logger.debug(
                        "Cached on-chain snapshot in LocalDiamond",
                        snapshotMeta
                    );
                } catch {
                    // ignore caching errors
                }
            }

            if (!isOpen) {
                this.setStatus(Status.NOT_OPENED);
                return this.status;
            }

            // Only move to OPENED if we haven't already synced/applied state.
            if (this.status === Status.NOT_OPENED) {
                this.setStatus(Status.OPENED);
            }
        } catch {
            // Best-effort: don't flip status on transient RPC errors.
        }

        return this.status;
    }
    public async setChannelId(channelId: ChannelId): Promise<void> {
        this.logger.verbose("Setting channel ID", { channelId });
        this.channelId = channelId;
        this.logger.updateSharedContext({ channelId: String(channelId) });
        this.disputeManager.setChannelId(channelId);
        this.eventSyncService.setChannelId(channelId);
        await this.stateChannelEventListener.setChannelId(channelId);
    }
    public getChannelId(): ChannelId {
        return this.channelId;
    }

    public async getOnChainParticipantUnion(
        channelId: ChannelId = this.channelId
    ): Promise<Address[]> {
        const [participants, pendingParticipants] = await Promise.all([
            this.stateChannelManagerContract.getParticipants(channelId),
            this.stateChannelManagerContract.getPendingParticipants(channelId)
        ]);
        return [
            ...union(new Set(participants), new Set(pendingParticipants))
        ].map(String) as Address[];
    }

    /**
     * High-level status for SDK consumers.
     *
     * - NOT_OPENED: channel not opened on-chain
     * - OPENED: opened on-chain but local node not yet synced (no fork id)
     * - SYNCED: opened on-chain and locally synced, but signer is not a participant
     * - PARTICIPATING: opened on-chain, locally synced, and signer is a participant
     */
    public async getChannelStatus(): Promise<Status> {
        return this.status;
    }
    public getSignerAddress(): Address {
        return this.signerAddress;
    }
    public getParticipantsCurrent(): Promise<Address[]> {
        //TODO? this can be done through the AgreementManager for the given fork or thought the stateMachine
        return this.diamondStateMachine.getParticipants();
    }
    public get forkId(): ForkId {
        return this.latestForkId;
    }
    public set forkId(forkId: ForkId) {
        if (this.latestForkId !== forkId) {
            // Queue recovery gates are tied to the active fork. Reduction
            // operations and their kill-period observations remain fork-scoped.
            this.blockQueueManager.onForkTransition();
        }
        this.latestForkId = forkId;
    }

    public async onInboundMessage(
        messageBlock: MessageBlockStruct,
        messageBlockHash: Hash
    ) {
        this.storage.inboundMessages.store(messageBlock, {
            hash: messageBlockHash
        });
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        if (this.status !== Status.SYNCED) {
            throw new Error(
                `joinChannel requires SYNCED status, got ${Status[this.status]}`
            );
        }

        this.setStatus(Status.PENDING_PARTICIPANT);
        this.logger.info(
            "joinChannel - promoted to PENDING_PARTICIPANT on broadcast"
        );

        const joinSubmissionHeight =
            this.storage.blocks.getNextBlockHeight(this.forkId) - 1;
        this.storage.forceJoin.setJoinSubmissionBlockHeight(
            joinSubmissionHeight
        );
        this.logger.info(
            "joinChannel - recorded force join submission height",
            { joinSubmissionHeight }
        );

        try {
            const tx = await this.stateChannelManagerContract.joinChannel(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await tx.wait();
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom?.name === "ErrorJoinChannelParticipantAlreadyExists") {
                this.logger.warn(
                    "joinChannel - participant already exists; preserving pending join state"
                );
                throw custom;
            }

            this.setStatus(Status.SYNCED);
            this.storage.forceJoin.clear();
            switch (custom?.name) {
                case "RaceConditionJoinChannelExpired":
                case "RaceConditionSnapshotForkMismatch":
                case "RaceConditionJoinChannelSnapshotMismatch":
                case "RaceConditionForceInboundJoinForkDisputed":
                case "ErrorJoinChannelInvalidSignature":
                    this.logger.warn(
                        `joinChannel - race condition: ${custom.name}`,
                        {
                            name: custom.name,
                            args: custom.errorDescription.args
                        }
                    );
                    // TODO: support concurrent joins by collecting safe extra signatures before submission.
                    // Rethrown as CustomEvmError
                    this.abort();
                    throw custom; //TODO - comunncate abort to the outside
            }
            this.logger.warn("joinChannel - tx failed, reverting to SYNCED", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    public async topUpBalance(
        confirmation: JoinChannelConfirmationStruct,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<void> {
        if (
            this.status !== Status.PARTICIPATING &&
            this.status !== Status.PENDING_PARTICIPANT
        ) {
            throw new Error(
                `topUpBalance requires PARTICIPATING or PENDING_PARTICIPANT status, got ${Status[this.status]}`
            );
        }

        try {
            const tx = await this.stateChannelManagerContract.topUpBalance(
                confirmation,
                expectedSnapshotHash,
                expectedForkId
            );
            await tx.wait();
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            if (custom) {
                this.logger.warn(`topUpBalance failed: ${custom.name}`, {
                    name: custom.name,
                    args: custom.errorDescription.args
                });
                throw custom;
            }
            throw error;
        }
    }

    private async tryExecuteFromQueue() {
        await this.blockQueueManager.tryExecuteFromQueue(this.forkId);
    }

    public async setLatestState(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        await this.withMutex(
            () =>
                this.unsafeSetLatestState(
                    stateSnapshot,
                    encodedState,
                    outboundMessageBlock
                ),
            { taskName: "setLatestState" }
        );
    }

    public async withMutex<T>(
        fn: () => T | Promise<T>,
        options?: MutexLockOptions,
        unlockOptions?: MutexUnlockOptions
    ): Promise<T> {
        await this.mutex.lock(options);
        try {
            return await fn();
        } finally {
            this.mutex.unlock(unlockOptions);
        }
    }

    public async unsafeSetLatestState(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        const normalizedGenesisTimestamp = Number(stateSnapshot.timestamp);

        // Persist state snapshot (as a model)
        const latestSnapshot = StateSnapshot.from(stateSnapshot);
        this.storage.stateSnapshots.storeStateSnapshot(latestSnapshot);

        // Persist outbound message block if provided
        if (outboundMessageBlock) {
            this.storage.outboundMessages.store(outboundMessageBlock);
        }

        // Persist state machine state (keyed by snapshot hash when available)
        this.storage.stateMachineStates.storeStateMachineState(encodedState, {
            hash: stateSnapshot.snapshotData.stateMachineStateHash
        });

        // Update local EVM/state machine
        await this.diamondStateMachine.setState(encodedState);

        // Update the forkId to the new fork
        const forkId = stateSnapshot.forkId;
        this.forkId = forkId;

        const participants = await this.diamondStateMachine.getParticipants();
        const isParticipant = participants.includes(this.signerAddress);
        if (isParticipant) {
            this.setStatus(Status.PARTICIPATING);
        } else {
            this.setStatus(Status.SYNCED);
        }

        const nextToWrite = await this.diamondStateMachine.getNextToWrite();

        const nextTransactionCnt = this.storage.blocks.getNextBlockHeight(
            this.forkId
        );

        const timeAdjustment =
            normalizedGenesisTimestamp - Clock.getTimeInSeconds();
        const turnTime = this.timeConfig.p2pTime;
        const timeoutWaitTime =
            this.getTimeoutWaitTimeSeconds(nextTransactionCnt) + timeAdjustment;
        this.logger.info(
            `setLatestState - schedule timeoutNext in (${timeoutWaitTime}s)`,
            {
                nextToWrite,
                turnTime,
                timeAdjustment,
                timeoutWaitTime,
                genesisTimestamp: normalizedGenesisTimestamp
            }
        );
        this.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkId,
                    nextTransactionCnt,
                    nextToWrite
                ),
            timeoutWaitTime * 1000,
            `participantTimeout(setState) - fork ${forkId} - block ${nextTransactionCnt} - participant ${nextToWrite}`
        );

        this.timeoutManager.scheduleTask(
            () => this.tryExecuteFromQueue(),
            0,
            "tryExecuteFromQueue"
        );

        this.p2pEventHooks.onSetState?.(forkId);
        P2pEventHooksUtils.notifyTurn({
            nextToWrite,
            nextBlockHeight: nextTransactionCnt,
            relevantTimestamp: normalizedGenesisTimestamp,
            currentTimestamp: Clock.getTimeInSeconds(),
            timeConfig: this.timeConfig,
            p2pEventHooks: this.p2pEventHooks,
            logger: this.logger
        });
    }

    public async unsafeSetGenesisState(
        snapshotData: SnapshotDataStruct,
        encodedState: Bytes,
        forkId: ForkId,
        genesisTimestamp: Timestamp,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        const normalizedGenesisTimestamp = Number(genesisTimestamp);
        this.logger.info("Setting genesis state", {
            forkId,
            genesisTimestamp: normalizedGenesisTimestamp,
            participant: snapshotData.participants
        });

        // generate and store genesis snapshot
        const _genesisSnapshot: StateSnapshotStruct = {
            forkId,
            blockHeight: 0,
            timestamp: normalizedGenesisTimestamp,
            snapshotData: snapshotData
        };
        this.logger.debug("Stored genesis snapshot", { _genesisSnapshot });

        await this.unsafeSetLatestState(
            _genesisSnapshot,
            encodedState,
            outboundMessageBlock
        );
    }

    public ingestBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        options?: IngestBlockConfirmationOptions
    ): Promise<boolean> {
        return this.blockQueueManager.ingestBlockConfirmation(
            blockConfirmation,
            options
        );
    }

    public async isBlockConfirmationAuthentic(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<boolean> {
        return this.diamondStateMachine.localDiamondContract.isBlockAuthentic(
            blockConfirmation.signedBlock
        );
    }

    public async isForkDisputed(
        forkId: ForkId,
        channelId: ChannelId
    ): Promise<boolean> {
        return this.validationService.isDisputedFork(forkId, channelId);
    }

    /**
     * Is `forkId` a fork in our canonical past - one we've moved past and can
     * safely drop a late block on - rather than an unknown/malicious fork we
     * should sync-probe? Callers only ask about a NON-current fork.
     *
     * O(1), no chain walk: a non-current fork is "known past" if it is disputed
     * (we are leaving it) OR we already hold its genesis snapshot or any of its
     * blocks locally (we've seen it in our history). Anything we don't recognize
     * is treated as unknown → sync (never a silent drop on ambiguity).
     */
    public async isKnownStaleFork(forkId: ForkId): Promise<boolean> {
        if (forkId === this.forkId || forkId === NULL) return false;
        if (await this.isForkDisputed(forkId, this.channelId)) return true;
        return (
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId) !==
                undefined ||
            this.storage.blocks.getLatestBlock(forkId) !== undefined
        );
    }

    public getActiveValidationStrategy(): AValidationStrategy {
        return this.getStrategyByStatus(this.status);
    }

    public async tryMergeStoredBlockConfirmation(
        entry: QueuedBlockEntry,
        strategy: AValidationStrategy
    ): Promise<BlockValidationResult | undefined> {
        const block = entry.block;
        const existingBlock = this.storage.blocks.getBlock(block.hash);
        if (!existingBlock) return undefined;

        if (block.onChainTimestamp !== undefined) {
            this.storage.blocks.setOnChainTimestamp(
                block.hash,
                block.onChainTimestamp
            );
        }

        const existingSignatures = existingBlock.confirmationSignatures;
        const incomingSignatures = block.confirmationSignatures;
        const newSignatures = difference(
            incomingSignatures,
            existingSignatures
        );

        if (newSignatures.size === 0) {
            return strategy.noNewSignaturesOnExistingBlock(block);
        }

        const participants = new Set<Address>(
            this.storage
                .getParticipantsUnion(
                    existingBlock.coordinates,
                    existingBlock.stateSnapshotHash
                )
                .map((participant) => getChecksumAddress(participant))
        );

        const newSignerAddresses = new Set<Address>(
            Array.from(newSignatures).map((signature) =>
                getChecksumAddress(block.signatureToAddress(signature))
            )
        );

        if (!isSubset(newSignerAddresses, participants)) {
            const unexpectedSigners = difference(
                newSignerAddresses,
                participants
            );
            const unexpectedSignatures = new Set(
                Array.from(newSignatures).filter((signature) =>
                    unexpectedSigners.has(
                        getChecksumAddress(
                            block.signatureToAddress(signature)
                        ) as Address
                    )
                )
            );
            this.logger.warn(
                "maybeMergeStoredBlockConfirmation - signers outside the participant union",
                {
                    strategy: strategy.name,
                    block: LoggerUtils.getBlockMetadata(block, this.storage),
                    unexpectedSigners: Array.from(unexpectedSigners),
                    participants: Array.from(participants)
                }
            );
            const validationResult =
                await strategy.notAllSingersAreParticipants(
                    entry,
                    unexpectedSignatures,
                    (() => {
                        const previous = this.storage.getPreviousStateSnapshot(
                            block.coordinates
                        );
                        const resulting =
                            this.storage.stateSnapshots.getStateSnapshotByHash(
                                block.stateSnapshotHash
                            );
                        return previous && resulting
                            ? { previous, resulting }
                            : undefined;
                    })()
                );
            if (validationResult !== BlockValidationResult.SUCCESS) {
                return validationResult;
            }
            // SUCCESS: the strategy stripped the stray signatures and cut
            // their byzantine sender.
            if (
                difference(block.confirmationSignatures, existingSignatures)
                    .size === 0
            ) {
                return strategy.noNewSignaturesOnExistingBlock(block);
            }
        }

        this.storage.blocks.storeBlock(block);
        const persisted = this.storage.blocks.getBlock(block.hash);
        if (persisted) {
            P2pEventHooksUtils.maybeNotifyBlockFinalized({
                block: persisted,
                storage: this.storage,
                p2pEventHooks: this.p2pEventHooks,
                logger: this.logger
            });
        }

        if (!(strategy instanceof DisputeValidationStrategy)) {
            this.p2pManager.remoteRpc.stateTransitionService
                .onBlockConfirmation(block.blockConfirmationStruct)
                .broadcast();
            return BlockValidationResult.BROADCAST;
        }

        return BlockValidationResult.DUPLICATE;
    }

    /**
     * Struct adapter for callers that replay confirmations outside the queue
     * (dispute stateProof replay, spectate sync): wraps into a sourceless
     * entry — those pipelines don't punish by transport.
     */
    public async onBlockConfirmationStruct(
        blockConfirmation: BlockConfirmationStruct,
        options?: {
            validationStrategy?: AValidationStrategy;
        }
    ): Promise<boolean> {
        return this.onBlockConfirmation(
            this.storage.queues.createEntry(
                Block.fromBlockConfirmation(blockConfirmation)
            ),
            options
        );
    }

    // Passes the block confirmation through a verification pipeline.
    // The entry is the CRDT accumulation of the block up to scheduling; the
    // run is atomic over it and its source attribution.
    // returns true if the block is valid and the state transition is successful
    // returns false -> the calling context should disconnect from the peer
    public async onBlockConfirmation(
        entry: QueuedBlockEntry,
        options?: {
            validationStrategy?: AValidationStrategy;
        }
    ): Promise<boolean> {
        let strategy: AValidationStrategy | undefined;
        let block: Block | undefined;
        let keepConnection: boolean | undefined;
        // The VM is advanced by applyTransaction below; every exit that doesn't
        // reach success() must restore it, or later validations run against a
        // state the channel never agreed on (e.g. a rotated-past turn index).
        let stateBeforeTransitionValidation: Bytes | undefined;
        let restoreReason = "aborted before success";

        try {
            await this.mutex.lock({ taskName: "onBlockConfirmation" });

            strategy =
                options?.validationStrategy ||
                this.getStrategyByStatus(this.status);
            block = entry.block;

            // A fork transition can land while we wait for the mutex, so the
            // block's fork may no longer be current. Don't validate against the
            // wrong fork: restore the entry for a timeout sync if we don't
            // recognize its fork as known-past, or drop it if we've moved past
            // it. The dispute strategy runs disputed/other-fork state-proof
            // blocks by design, so it is exempt.
            if (
                !(strategy instanceof DisputeValidationStrategy) &&
                block.forkId !== this.forkId
            ) {
                if (await this.isKnownStaleFork(block.forkId)) {
                    this.logger.verbose(
                        "onBlockConfirmation - dropping entry from a known stale fork (fork changed under mutex)",
                        { blockHash: block.hash, blockForkId: block.forkId }
                    );
                } else {
                    this.blockQueueManager.restoreQueuedEntry(entry, strategy);
                }
                keepConnection = true; // not a peer fault
                return keepConnection;
            }

            if (this.storage.blocks.getBlock(block.hash)) {
                this.blockQueueManager.scheduleStoredBlockConfirmationMerge(
                    entry,
                    strategy
                );
                return true;
            }

            let validationResult: BlockValidationResult =
                BlockValidationResult.SUCCESS;

            const isAuthentic = await this.isBlockConfirmationAuthentic(
                block.blockConfirmationStruct
            );

            if (!isAuthentic) {
                validationResult = await strategy.authenticateBlockFailed(
                    block.blockConfirmationStruct
                );

                this.logger.warn(
                    "onBlockConfirmation - authentication failed",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        blockHash: block.hash
                    }
                );

                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                return keepConnection;
            }

            validationResult =
                await this.validationService.validateBlockConfirmation(
                    entry,
                    strategy
                );

            if (validationResult !== BlockValidationResult.SUCCESS) {
                // handle all non-success actions
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                if (!keepConnection) {
                    this.logger.warn(
                        "onBlockConfirmation - validateBlockConfirmation failed",
                        {
                            strategy: strategy.name,
                            validationResult:
                                BlockValidationResult[validationResult],
                            block: LoggerUtils.getBlockMetadata(
                                block,
                                this.storage
                            )
                        }
                    );
                }
                return keepConnection;
            }

            // SUCCESS, continue with state transition validation

            const coordinates = block.coordinates;
            const previousStateSnapshot =
                this.getPreviousStateSnapshotOrThrow(coordinates);
            const inboundMessageBlocks = block.messageBlocks;

            const brokenInboundChainBlock =
                this.findBrokenInboundMessageChainBlock(
                    previousStateSnapshot,
                    inboundMessageBlocks
                );

            if (brokenInboundChainBlock) {
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                this.logger.warn("onBlockConfirmation - broken inbound chain", {
                    strategy: strategy.name,
                    validationResult: BlockValidationResult[validationResult],
                    block: LoggerUtils.getBlockMetadata(block, this.storage)
                });
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                return keepConnection;
            }

            const forgedInboundMessageBlock =
                await this.detectForgedInboundMessageBlock(block);

            if (forgedInboundMessageBlock) {
                validationResult =
                    await strategy.forgedInboundMessageBlockDetected(
                        block,
                        forgedInboundMessageBlock
                    );
                this.logger.warn(
                    "onBlockConfirmation - forged inbound message block",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockMetadata(block, this.storage)
                    }
                );
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                return keepConnection;
            }

            stateBeforeTransitionValidation =
                await this.diamondStateMachine.getState();

            const {
                success,
                encodedState,
                successCallback,
                outboundMessages,
                participantsBefore
            } = await this.applyTransaction(block.tx);

            if (!success) {
                restoreReason = "state transition failed";
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                this.logger.warn(
                    "onBlockConfirmation - state transition failed",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockMetadata(block, this.storage)
                    }
                );
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                return keepConnection;
            }

            const { encodedState: stateAfterInbound } =
                await this.applyInboundMessageBlocksToState(
                    inboundMessageBlocks,
                    previousStateSnapshot.snapshotData.totalDeposits,
                    encodedState
                );

            const finalParticipants =
                await this.diamondStateMachine.getParticipants();
            const participantChanges = this.computeParticipantChanges(
                participantsBefore,
                finalParticipants
            );

            const { stateSnapshot, outboundMessageBlock } =
                await this.createStateSnapshot(
                    hash(stateAfterInbound),
                    coordinates,
                    block.timestamp,
                    outboundMessages,
                    inboundMessageBlocks,
                    finalParticipants
                );

            if (stateSnapshot.hash !== block.stateSnapshotHash) {
                restoreReason = "state snapshot hash mismatch";
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                this.logger.warn(
                    "onBlockConfirmation - state snapshot hash mismatch",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockMetadata(block, this.storage)
                    }
                );
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                return keepConnection;
            }

            // Union on the participant set -> check signers
            const allowedSigners = new Set<Address>([
                ...previousStateSnapshot.snapshotData.participants,
                ...stateSnapshot.snapshotData.participants
            ]);
            const unexpectedSigners = difference(
                block.allSignerAddresses,
                allowedSigners
            );

            if (unexpectedSigners.size > 0) {
                const blockForSignatureRecovery = block;
                const unexpectedSignatures = new Set(
                    Array.from(block.allSignatures).filter((signature) =>
                        unexpectedSigners.has(
                            blockForSignatureRecovery.signatureToAddress(
                                signature
                            )
                        )
                    )
                );
                restoreReason = "signers not in participant union";
                validationResult = await strategy.notAllSingersAreParticipants(
                    entry,
                    unexpectedSignatures,
                    {
                        previous: previousStateSnapshot,
                        resulting: stateSnapshot
                    }
                );
                this.logger.warn(
                    "onBlockConfirmation - signers outside the participant union",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockMetadata(
                            block,
                            this.storage
                        ),
                        author: block.signerAddress,
                        unexpectedSigners: Array.from(unexpectedSigners),
                        allowedSigners: Array.from(allowedSigners)
                    }
                );
                if (validationResult !== BlockValidationResult.SUCCESS) {
                    keepConnection =
                        await strategy.interpretFinalValidationResult(
                            validationResult
                        );
                    return keepConnection;
                }
                // SUCCESS: the strategy stripped the stray signatures and cut
                // their byzantine senders — continue with the valid ones.
            }

            // TODO - apply strategy here too
            // All validations passed - proceed with success action
            await this.success(
                block,
                stateSnapshot,
                stateAfterInbound,
                successCallback,
                participantChanges,
                {
                    outboundMessageBlock,
                    strategy,
                    onBlockCommitted: () => {
                        // The VM keeps the advanced state once the block is
                        // stored - post-commit side-effect failures must not
                        // rewind it behind storage.
                        stateBeforeTransitionValidation = undefined;
                    }
                }
            );
            const blockMeta = LoggerUtils.getBlockMetadata(block, this.storage);
            this.logger.info(
                `onBlockConfirmation - success - ${blockMeta.blockHeight}`,
                {
                    strategy: strategy.name,
                    block: blockMeta
                }
            );
            keepConnection = true;
            return keepConnection;
        } catch (error) {
            this.logger.error("onBlockConfirmation - error", {
                strategy: strategy?.name,
                channelId: this.channelId,
                blockHash: block?.hash,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        } finally {
            // Any exit that advanced the VM without reaching success() —
            // validation aborts and thrown errors alike — must revert it before
            // the mutex frees the next task to run against the dirty state.
            if (stateBeforeTransitionValidation !== undefined) {
                await this.restoreStateAfterFailedValidation(
                    stateBeforeTransitionValidation,
                    restoreReason,
                    block
                );
            }
            this.mutex.unlock({ scheduleNextAsMacroTask: true });
            // try signaling blocks in the queue (in case this block enabled them to be validated)
            this.timeoutManager.scheduleTask(
                () => this.tryExecuteFromQueue(),
                0,
                "tryExecuteFromQueue"
            );
            if (block && keepConnection !== undefined) {
                P2pEventHooksUtils.notifyBlockConfirmationProcessed({
                    blockHash: block.hash,
                    keepConnection,
                    p2pEventHooks: this.p2pEventHooks
                });
            }
        }
    }

    private async restoreStateAfterFailedValidation(
        encodedState: Bytes,
        reason: string,
        block?: Block
    ): Promise<void> {
        try {
            await this.diamondStateMachine.setState(encodedState);
            this.logger.debug(
                "onBlockConfirmation - restored local state after failed validation",
                {
                    reason,
                    block: block
                        ? LoggerUtils.getBlockMetadata(block, this.storage)
                        : undefined
                }
            );
        } catch (error) {
            this.logger.error(
                "onBlockConfirmation - failed to restore local state after failed validation",
                {
                    reason,
                    block: block
                        ? LoggerUtils.getBlockMetadata(block, this.storage)
                        : undefined,
                    error
                }
            );
        }
    }

    //Applies a transaction to the state machine and returns the encoded state with a success callback
    public async applyTransaction(transaction: TransactionStruct): Promise<{
        success: boolean;
        encodedState: Bytes;
        successCallback: () => void;
        outboundMessages: MessageStruct[];
        participantsBefore: Address[];
    }> {
        const participantsBefore =
            await this.diamondStateMachine.getParticipants();
        const { success, successCallback, outboundMessages } =
            await this.diamondStateMachine.stateTransition(transaction);
        const encodedState = await this.diamondStateMachine.getState();

        return {
            success,
            encodedState,
            successCallback,
            outboundMessages,
            participantsBefore
        };
    }

    private async logPlayTransaction(tx: TransactionStruct): Promise<string> {
        const forkId = this.forkId;
        const txHeight = Number(tx.header.transactionCnt);
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        const latestBlock = this.storage.blocks.getLatestBlock(forkId);
        const latestStoredHeight = latestBlock?.height ?? null;
        const nextStoredHeight = this.storage.blocks.getNextBlockHeight(forkId);
        const message =
            `playTransaction start: ` +
            ` - myAddress: ${String(this.signerAddress)}` +
            ` - nextToWrite: ${String(nextToWrite)}` +
            ` - txHeight: #${txHeight}` +
            ` - latestStoredHeight: ${String(latestStoredHeight)}` +
            ` - nextStoredHeight: ${nextStoredHeight}` +
            ` - forkId: ${forkId}` +
            ` - Block timestamp: ${Number(tx.header.timestamp)}` +
            ` - Current timestamp: ${Clock.getTimeInSeconds()}`;
        this.logger.info(message);
        return message;
    }

    // Used when authoring a block - Executes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<BlockConfirmationStruct> {
        await this.mutex.lock({ taskName: "playTransaction" });
        const message = await this.logPlayTransaction(tx);
        try {
            if (!this.validationService.isChannelOpen(this.forkId)) {
                throw new Error("Channel not open");
            }
            if (!(await this.isMyTurn())) {
                throw new Error("NOT MY TURN: " + message);
            }
            this.adjustTimestampIfNeeded(tx);

            const coordinates = {
                forkId: this.forkId,
                height: Number(tx.header.transactionCnt)
            };
            const previousStateSnapshot =
                this.getPreviousStateSnapshotOrThrow(coordinates);
            const inboundMessageBlocks = this.getPendingInboundMessageBlocks(
                previousStateSnapshot
            );

            const invalidPendingInboundBlock =
                this.findBrokenInboundMessageChainBlock(
                    previousStateSnapshot,
                    inboundMessageBlocks
                );
            if (invalidPendingInboundBlock) {
                throw new Error(
                    "Pending inbound message blocks do not form a valid chain"
                );
            }

            const {
                success,
                encodedState,
                successCallback,
                outboundMessages,
                participantsBefore
            } = await this.applyTransaction(tx);

            if (!success) {
                throw new Error(
                    "CreateAndApplyTransaction - Internal error - Transaction not successful"
                );
            }

            const { encodedState: stateAfterInbound } =
                await this.applyInboundMessageBlocksToState(
                    inboundMessageBlocks,
                    previousStateSnapshot.snapshotData.totalDeposits,
                    encodedState
                );

            const finalParticipants =
                await this.diamondStateMachine.getParticipants();
            const participantChanges = this.computeParticipantChanges(
                participantsBefore,
                finalParticipants
            );

            const { stateSnapshot, outboundMessageBlock } =
                await this.createStateSnapshot(
                    hash(stateAfterInbound),
                    coordinates,
                    Number(tx.header.timestamp),
                    outboundMessages,
                    inboundMessageBlocks,
                    finalParticipants
                );

            const blockStruct = await this.createBlock(
                tx,
                stateSnapshot.hash,
                inboundMessageBlocks
            );

            const encodedBlock = Codec.encode(blockStruct, Type.Block);
            const blockHash = hash(encodedBlock);
            const signedBlock: SignedBlockStruct = {
                encodedBlock: encodedBlock,
                signature: await this.p2pManager.p2pSigner.signMessage(
                    ethers.getBytes(blockHash)
                )
            };

            const block = Block.fromSignedBlock(signedBlock);

            await this.success(
                block,
                stateSnapshot,
                stateAfterInbound,
                successCallback,
                participantChanges,
                {
                    outboundMessageBlock
                }
            );

            const blockMeta = LoggerUtils.getBlockMetadata(block, this.storage);
            this.logger.info(
                `playTransaction - success - ${blockMeta.blockHeight}`,
                {
                    block: blockMeta
                }
            );
            return block.blockConfirmationStruct;
        } finally {
            this.mutex.unlock();
        }
    }

    private maybePostBlockOnChain(blockHash: Hash) {
        // Retrieve the latest version of the block from storage (with all collected signatures)
        const block = this.storage.blocks.getBlock(blockHash);
        if (!block) {
            return;
        }
        // If not everyone has signed, do the on-chain post
        const participants = this.storage.getParticipantsUnion(
            block.coordinates,
            block.stateSnapshotHash
        );

        // TODO - this can be race conditioned and we could be granted extra time, but we don't care to check that on-chain and will assume we're not granted extra time for this
        const previousRelevantTimestamp =
            this.storage.getPreviousRelevantTimestamp(
                block.coordinates,
                block.author
            );

        if (!block.didEveryoneSign(participants)) {
            this.p2pEventHooks.onPostingCalldata?.();

            const maxTimestamp =
                previousRelevantTimestamp +
                this.getTimeoutWaitTimeSeconds(block.height);

            const blockMetadata = LoggerUtils.getBlockMetadata(
                block,
                this.storage
            );
            const currentTime = Clock.getTimeInSeconds();
            this.logger.info(
                `Posting block calldata on-chain #${blockMetadata.blockHeight}`,
                {
                    block: blockMetadata,
                    maxTimestamp,
                    currentTime
                }
            );

            let txResponse: TransactionResponse;
            const txResponsePromise = this.stateChannelManagerContract
                .postBlockCalldata(block.signedBlock, maxTimestamp)
                .then((tx) => {
                    txResponse = tx;
                    const txReceiptPromise = txResponse.wait();
                    DetachedPromises.collect(txReceiptPromise);
                    return txReceiptPromise;
                })
                .catch(async (error) => {
                    const success = await tryHandleEvmError(error, {
                        logger: this.logger,
                        signer: this.signer,
                        tx: txResponse!,
                        handlers: {
                            RaceConditionBlockCalldataTimestampTooLate:
                                async () => {
                                    const localErrorTimestamp =
                                        Clock.getTimeInSeconds();
                                    const currentOnChainTimestamp =
                                        await Clock.getBlockchainTime();
                                    this.logger.warn(
                                        "RaceConditionBlockCalldataTimestampTooLate",
                                        {
                                            localErrorTimestamp,
                                            maxTimestamp,
                                            currentOnChainTimestamp,
                                            previousRelevantTimestamp,
                                            block: blockMetadata
                                        }
                                    );
                                }
                        }
                    });
                    //
                    if (success) return;
                    const custom = tryDecodeCustomError(error);
                    this.logger.error(
                        "Posting block calldata ERROR",
                        custom, // tryHandleEvmError already logged the custom error if not null
                        error
                    );
                });
            DetachedPromises.collect(txResponsePromise);
        }
    }

    private async calculateTotalBalance(
        balances: { balance: BalanceStruct }[],
        initialTotal?: BalanceStruct
    ): Promise<BalanceStruct> {
        let total =
            initialTotal ?? (await this.diamondStateMachine.getZeroBalance());

        for (const balance of balances) {
            total = await this.diamondStateMachine.addBalance(
                total,
                balance.balance
            );
        }

        return total;
    }

    // Fires the force-join dispute exactly once when N turns have passed without the joiner being included
    private async maybeInitiateForceJoinDispute(
        block: Block,
        participants: Address[]
    ): Promise<void> {
        const joinSubmissionHeight =
            this.storage.forceJoin.getJoinSubmissionBlockHeight();
        if (joinSubmissionHeight === undefined) return;
        const N = participants.length + 1;
        const fireOnBlockHeight = joinSubmissionHeight + N;
        if (block.height !== fireOnBlockHeight) return;
        this.logger.info(
            "Force join dispute triggered: N turns passed without inclusion",
            { N, forkId: this.forkId, blockHeight: block.height }
        );
        await this.disputeManager.dispute(this.forkId);
    }

    // Tries to timeout a participant by checking did the participant fail to transition the state within time - if successful -> creates a dispute
    private async tryTimeoutParticipant(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address
    ): Promise<void> {
        if (participantAddress === this.signerAddress) {
            return;
        }

        const participants = await this.diamondStateMachine.getParticipants();
        if (!participants.includes(this.signerAddress)) {
            return;
        }

        // if a block exist in storage (regardless of own signature on it) -> it was accepted
        const block = this.storage.blocks.getBlock(forkId, blockHeight);
        if (block) {
            return;
        }

        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            {
                forkId,
                height: blockHeight
            }
        );
        // check is good time to timeout
        const previousRelevantTimestamp = previousBlockOrSnapshot.block
            ? previousBlockOrSnapshot.block.getRelevantTimestamp(
                  participantAddress
              )
            : previousBlockOrSnapshot.stateSnapshot!.timestamp;
        const timeoutWaitTime = this.getTimeoutWaitTimeSeconds(blockHeight);
        const timeoutMinTimestamp = previousRelevantTimestamp + timeoutWaitTime;
        let difference = timeoutMinTimestamp - Clock.getTimeInSeconds();
        if (difference > 0) {
            this.logger.info(
                `tryTimeoutParticipant - rescheduling in (${difference}s)`,
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    difference,
                    previousRelevantTimestamp,
                    previousBlockOrSnapshot,
                    timeoutWaitTime
                }
            );
            this.timeoutManager.scheduleTask(
                () => {
                    return this.tryTimeoutParticipant(
                        forkId,
                        blockHeight,
                        participantAddress
                    );
                },
                difference * 1000,
                `timeoutParticipantDelayed - fork ${forkId} - block ${blockHeight} - participant ${participantAddress}`
            );
            return;
        }

        // A timeout added to an existing dispute window is judged against the
        // window's original creation time, not the new transaction timestamp.
        // Do not submit if that window opened before this timeout became valid;
        // the on-chain race-condition guard repeats this check authoritatively.
        const disputeWindowCreationTimestamp = Number(
            await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                this.channelId,
                forkId
            )
        );
        if (
            disputeWindowCreationTimestamp !== 0 &&
            disputeWindowCreationTimestamp < timeoutMinTimestamp
        ) {
            this.logger.info(
                "tryTimeoutParticipant - existing dispute window predates timeout deadline; not submitting",
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    disputeWindowCreationTimestamp,
                    timeoutMinTimestamp
                }
            );
            return;
        }

        // (race condition) check did previous participant post on-chain granting this one extra time
        if (
            previousBlockOrSnapshot.block &&
            !previousBlockOrSnapshot.block.onChainTimestamp
        ) {
            const recovery =
                await this.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                    previousBlockOrSnapshot.block.forkId,
                    previousBlockOrSnapshot.block.height,
                    previousBlockOrSnapshot.block.author
                );

            if (recovery.validationScheduled) {
                this.logger.info(
                    "tryTimeoutParticipant - waiting for previous on-chain block validation",
                    {
                        forkId,
                        blockHeight,
                        participantAddress,
                        previousBlock: LoggerUtils.getBlockMetadata(
                            previousBlockOrSnapshot.block,
                            this.storage
                        ),
                        validationScheduled: recovery.validationScheduled
                    }
                );
                this.scheduleTimeoutParticipantRetry(
                    forkId,
                    blockHeight,
                    participantAddress,
                    "previousOnChainBlockValidation"
                );
                return;
            }

            const matchingPreviousCalldata =
                this.storage.blockCalldata.getMatchingBlockCalldata(
                    previousBlockOrSnapshot.block
                );
            if (matchingPreviousCalldata) {
                difference =
                    matchingPreviousCalldata.onChainTimestamp +
                    this.getTimeoutWaitTimeSeconds(blockHeight) -
                    Clock.getTimeInSeconds();
                if (difference > 0) {
                    // There's a chance that the on-chain timestamp will not persist if the BlockConfirmation pipeline didn't decide to persist the block since most likely the calldata is junk
                    // This is not a problem since on the next run difference < 0 -> force timeout
                    // Only inefficiency is we'd querry the RPC node for calldata for this 2 times in the case of a force timeout like this
                    this.logger.info(
                        `tryTimeoutParticipant - after fetching, rescheduling in (${difference}s)`,
                        {
                            forkId,
                            blockHeight,
                            participantAddress,
                            difference,
                            previousBlock: previousBlockOrSnapshot.block,
                            timeoutWaitTime
                        }
                    );
                    this.timeoutManager.scheduleTask(
                        () => {
                            return this.tryTimeoutParticipant(
                                forkId,
                                blockHeight,
                                participantAddress
                            );
                        },
                        difference * 1000,
                        `timeoutParticipantDelayed - fork ${forkId} - block ${blockHeight} - participant ${participantAddress}`
                    );
                    return;
                }
            }
        }
        // No race condition on previous block on-chain calldata

        // (local) check if current block calldata slot is occupied on-chain
        let commitment =
            await this.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                this.channelId,
                forkId,
                blockHeight,
                participantAddress
            );
        if (commitment.found) {
            // Commitment found, but block not accepted by BlockConfirmation pipeline -> proceed no timeout force
            return await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress,
                timeoutMinTimestamp,
                true
            );
        }

        // (race condition) check if current block posted on-chain
        const recovery =
            await this.eventSyncService.tryRecoverBlockCalldataAndScheduleValidation(
                forkId,
                blockHeight,
                participantAddress
            );
        if (recovery.validationScheduled) {
            this.logger.info(
                "tryTimeoutParticipant - waiting for current on-chain block validation",
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    validationScheduled: recovery.validationScheduled
                }
            );
            this.scheduleTimeoutParticipantRetry(
                forkId,
                blockHeight,
                participantAddress,
                "currentOnChainBlockValidation"
            );
            return;
        }

        const updatedBlock = this.storage.blocks.getBlock(forkId, blockHeight);
        if (updatedBlock?.onChainTimestamp) {
            return; // block found and accepted
        }
        // Check locally again - if scheduled on-chain validation found a block -> local evm is synced
        commitment =
            await this.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                this.channelId,
                forkId,
                blockHeight,
                participantAddress
            );
        if (commitment.found) {
            // commitment exists on-chain, but block confirmation pipeline didn't accept it -> proceed no timeout force
            return await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress,
                timeoutMinTimestamp,
                true
            );
        }
        // block not found on-chain -> normal timeout
        return await this.createTimeOutDispute(
            forkId,
            blockHeight,
            participantAddress,
            timeoutMinTimestamp,
            false
        );
    }

    private scheduleTimeoutParticipantRetry(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        reason: string
    ): void {
        this.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkId,
                    blockHeight,
                    participantAddress
                ),
            1000,
            `timeoutParticipantAfterOnChainValidation - ${reason} - fork ${forkId} - block ${blockHeight} - participant ${participantAddress}`
        );
    }

    private async createTimeOutDispute(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address,
        timeoutMinTimestamp: Timestamp,
        isForced: boolean = false
    ): Promise<void> {
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            {
                forkId,
                height: blockHeight
            }
        );

        const previousBlock = previousBlockOrSnapshot.block;
        let previousBlockProducerPostedCalldata = false;
        if (previousBlock) {
            if (previousBlock.onChainTimestamp) {
                previousBlockProducerPostedCalldata = true;
            } else {
                previousBlockProducerPostedCalldata = (
                    await this.diamondStateMachine.localDiamondContract.getBlockCallDataCommitment(
                        this.channelId,
                        forkId,
                        previousBlock.height,
                        previousBlock.author
                    )
                ).found;
            }
        }

        const timeout: TimeoutStruct = {
            participant: participantAddress.toString(),
            blockHeight: BigInt(blockHeight),
            minTimeStamp: timeoutMinTimestamp,
            isForced: isForced,
            previousBlockProducer: previousBlock
                ? previousBlock.author.toString()
                : ethers.ZeroAddress,
            previousBlockProducerPostedCalldata:
                previousBlockProducerPostedCalldata,
            participantSignatureOnPreviousBlock:
                (previousBlock?.findSignature(participantAddress) as Bytes) ||
                "0x"
        };

        LoggerUtils.logTimeoutDetected(
            this.logger,
            blockHeight,
            previousBlockOrSnapshot,
            timeout
        );

        // persist timeout locally
        this.storage.timeout.storeTimeout(forkId, timeout);

        // Time has fully elapsed - create dispute immediately
        await this.disputeManager.dispute(forkId);
    }

    public getTimeoutWaitTimeSeconds(blockHeight: BlockHeight) {
        return (
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime +
            firstBlockGrace(this.timeConfig, blockHeight)
        );
    }

    public async isMyTurn(): Promise<boolean> {
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        return this.signerAddress === nextToWrite;
    }

    private adjustTimestampIfNeeded(tx: TransactionStruct): void {
        const forkId = tx.header.forkId;
        const latestBlock = this.storage.blocks.getLatestBlock(forkId);

        let previousTimestamp: Timestamp;
        let previousRelativeTimestamp: Timestamp;
        if (!latestBlock) {
            // No blocks yet - check against genesis snapshot timestamp
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
            if (!genesisSnapshot) {
                return; // No genesis snapshot yet, nothing to adjust against
            }
            previousTimestamp = genesisSnapshot.timestamp;
            previousRelativeTimestamp = genesisSnapshot.timestamp;
        } else {
            previousTimestamp = latestBlock.timestamp;
            previousRelativeTimestamp = latestBlock.getRelevantTimestamp(
                tx.header.participant
            );
        }

        const latestLocalTimestamp = Clock.getTimeInSeconds() + 1; // allow 1s of execution time

        if (latestLocalTimestamp > Number(tx.header.timestamp)) {
            this.logger.verbose(
                "Adjusting timestamp - reassigning to latest local time",
                {
                    forkId,
                    txTimestamp: Number(tx.header.timestamp),
                    latestLocalTimestamp,
                    diff: latestLocalTimestamp - Number(tx.header.timestamp),
                    newTimestamp: latestLocalTimestamp
                }
            );
            tx.header.timestamp = BigInt(latestLocalTimestamp);
        }

        if (Number(tx.header.timestamp) < previousTimestamp) {
            this.logger.verbose("Adjusting timestamp - was in the past", {
                forkId,
                txTimestamp: Number(tx.header.timestamp),
                previousTimestamp,
                diff: previousTimestamp - Number(tx.header.timestamp),
                newTimestamp: previousTimestamp
            });
            tx.header.timestamp = BigInt(previousTimestamp);
        }

        const graceSeconds = firstBlockGrace(
            this.timeConfig,
            Number(tx.header.transactionCnt)
        );
        const maxTimestamp =
            previousRelativeTimestamp + graceSeconds + this.timeConfig.p2pTime;

        if (Number(tx.header.timestamp) > maxTimestamp) {
            this.logger.verbose("Adjusting timestamp - was in the future", {
                forkId,
                txTimestamp: Number(tx.header.timestamp),
                previousRelativeTimestamp,
                firstBlockGrace: graceSeconds,
                p2pTime: this.timeConfig.p2pTime,
                diff: Number(tx.header.timestamp) - maxTimestamp,
                newTimestamp: maxTimestamp
            });
            tx.header.timestamp = BigInt(maxTimestamp);
        }
    }

    private async createStateSnapshot(
        stateMachineStateHash: Hash,
        coordinates: BlockCoordinates,
        timestamp: Timestamp,
        outboundMessages: MessageStruct[],
        inboundMessageBlocks: MessageBlockStruct[],
        participants: Address[]
    ): Promise<{
        stateSnapshot: StateSnapshot;
        outboundMessageBlock?: MessageBlockStruct;
    }> {
        const previousStateSnapshot =
            this.getPreviousStateSnapshotOrThrow(coordinates);
        const previousSnapshotData = previousStateSnapshot.snapshotData;
        let latestInboundMessageBlockHash =
            previousSnapshotData.latestInboundMessageBlockHash;
        let totalDeposits = previousSnapshotData.totalDeposits;
        const originForkId = previousSnapshotData.originForkId;

        let { latestOutboundMessageBlockHash, totalWithdrawals } =
            previousSnapshotData;
        let latestOutboundMessageBlockHeight = BigInt(
            previousSnapshotData.latestOutboundMessageBlockHeight ?? 0n
        );
        let latestInboundMessageBlockHeight = BigInt(
            previousSnapshotData.latestInboundMessageBlockHeight ?? 0n
        );
        if (inboundMessageBlocks.length > 0) {
            const lastInboundBlock =
                inboundMessageBlocks[inboundMessageBlocks.length - 1];
            latestInboundMessageBlockHash = hash(
                Codec.encode(lastInboundBlock, Type.MessageBlock)
            );
            latestInboundMessageBlockHeight = BigInt(
                lastInboundBlock.blockHeight ?? latestInboundMessageBlockHeight
            );
            totalDeposits = lastInboundBlock.totalBalance;
        }

        let outboundMessageBlock: MessageBlockStruct | undefined;

        if (outboundMessages.length > 0) {
            totalWithdrawals = await this.calculateTotalBalance(
                outboundMessages,
                totalWithdrawals
            );

            latestOutboundMessageBlockHeight =
                latestOutboundMessageBlockHeight + 1n;

            outboundMessageBlock = {
                previousBlockHash: latestOutboundMessageBlockHash,
                blockHeight: latestOutboundMessageBlockHeight,
                messages: outboundMessages,
                totalBalance: totalWithdrawals,
                timestamp: BigInt(timestamp)
            };

            latestOutboundMessageBlockHash = hash(
                Codec.encode(outboundMessageBlock, Type.MessageBlock)
            );
        }

        const stateSnapshot: StateSnapshotStruct = {
            forkId: coordinates.forkId,
            blockHeight: BigInt(coordinates.height),
            timestamp: timestamp,
            snapshotData: {
                originForkId,
                stateMachineStateHash: stateMachineStateHash,
                participants,
                latestInboundMessageBlockHash,
                latestInboundMessageBlockHeight,
                latestOutboundMessageBlockHash,
                latestOutboundMessageBlockHeight,
                totalDeposits,
                totalWithdrawals
            }
        };
        this.logger.debug(`Creating state snapshot #${coordinates.height}`, {
            args: {
                stateMachineStateHash,
                coordinates,
                timestamp,
                outboundMessagesLength: outboundMessages.length,
                outboundMessages: outboundMessages.map((message) =>
                    LoggerUtils.getMessageStructMeta(message)
                ),
                inboundMessageBlocksLength: inboundMessageBlocks.length,
                participants
            },
            previousSnapshotHash: previousStateSnapshot.hash,
            latestInboundMessageBlockHash,
            latestInboundMessageBlockHeight:
                latestInboundMessageBlockHeight.toString(),
            latestOutboundMessageBlockHash,
            latestOutboundMessageBlockHeight:
                latestOutboundMessageBlockHeight.toString(),
            totalDeposits: totalDeposits.toString(),
            totalWithdrawals: totalWithdrawals.toString(),
            stateSnapshot: LoggerUtils.getSnapshotMetadata(
                StateSnapshot.from(stateSnapshot)
            ),
            outboundMessageBlock: outboundMessageBlock
                ? LoggerUtils.getMessageBlockMetadata(outboundMessageBlock)
                : "",
            previousSnapshot: LoggerUtils.getSnapshotMetadata(
                previousStateSnapshot
            )
        });
        return {
            stateSnapshot: StateSnapshot.from(stateSnapshot),
            outboundMessageBlock
        };
    }

    private getPreviousStateSnapshotOrThrow(
        coordinates: BlockCoordinates
    ): StateSnapshot {
        const previousStateSnapshot =
            this.storage.getPreviousStateSnapshot(coordinates);
        if (!previousStateSnapshot)
            throw new Error(
                "createStateSnapshot for block - previousStateSnapshot undefined"
            );
        return previousStateSnapshot;
    }

    private getPendingInboundMessageBlocks(
        previousStateSnapshot: StateSnapshot
    ): MessageBlockStruct[] {
        const latestStoredHash =
            this.storage.inboundMessages.getLatestBlockHash();
        if (!latestStoredHash) {
            return [];
        }

        const previousHash =
            previousStateSnapshot.snapshotData.latestInboundMessageBlockHash;

        if (previousHash && latestStoredHash === previousHash) {
            return [];
        }

        return this.storage.inboundMessages.getMessageBlocksInRange({
            upperBlockHash: latestStoredHash,
            lowerBlockHash: previousHash ?? ethers.ZeroHash
        });
    }

    private findBrokenInboundMessageChainBlock(
        previousStateSnapshot: StateSnapshot,
        inboundMessageBlocks: MessageBlockStruct[]
    ): MessageBlockStruct | undefined {
        if (inboundMessageBlocks.length === 0) {
            return undefined;
        }

        let expectedPreviousHash =
            previousStateSnapshot.snapshotData.latestInboundMessageBlockHash ??
            ethers.ZeroHash;
        let expectedHeight = BigInt(
            previousStateSnapshot.snapshotData
                .latestInboundMessageBlockHeight ?? 0n
        );

        for (const inboundBlock of inboundMessageBlocks) {
            if (inboundBlock.previousBlockHash !== expectedPreviousHash) {
                return inboundBlock;
            }
            expectedHeight += 1n;
            if (BigInt(inboundBlock.blockHeight ?? 0n) !== expectedHeight) {
                return inboundBlock;
            }
            expectedPreviousHash = hash(
                Codec.encode(inboundBlock, Type.MessageBlock)
            );
        }

        return undefined;
    }

    private async applyInboundMessageBlocksToState(
        inboundMessageBlocks: MessageBlockStruct[],
        totalDeposits: BalanceStruct,
        encodedState: Bytes
    ): Promise<{ encodedState: Bytes; totalDeposits: BalanceStruct }> {
        let updatedTotalDeposits = totalDeposits;

        if (inboundMessageBlocks.length === 0) {
            return {
                encodedState,
                totalDeposits: updatedTotalDeposits
            };
        }

        for (const messageBlock of inboundMessageBlocks) {
            this.logger.debug(
                `Applying inbound message block at height ${messageBlock.blockHeight} to state machine`
            );
            for (const message of messageBlock.messages) {
                this.logger.debug(
                    `Processing inbound message of type ${LoggerUtils.decodeMessageType(String(message.messageType))}`
                );
                const processed =
                    await this.diamondStateMachine.processInboundMessage(
                        message
                    );
                if (!processed) {
                    throw new Error("Failed to process inbound message");
                }
                updatedTotalDeposits =
                    await this.diamondStateMachine.addBalance(
                        updatedTotalDeposits,
                        message.balance
                    );
            }
        }

        const updatedEncodedState = await this.diamondStateMachine.getState();

        return {
            encodedState: updatedEncodedState,
            totalDeposits: updatedTotalDeposits
        };
    }

    private computeParticipantChanges(
        previousParticipants: Address[],
        finalParticipants: Address[]
    ): ParticipantChanges {
        const previousSet = new Set(previousParticipants);
        const finalSet = new Set(finalParticipants);

        return {
            left: difference(previousSet, finalSet),
            joined: difference(finalSet, previousSet)
        };
    }

    private async createBlock(
        tx: TransactionStruct,
        stateSnapshotHash: Hash,
        messageBlocks: MessageBlockStruct[]
    ): Promise<BlockStruct> {
        const forkId = this.forkId;
        const blockHeight = Number(tx.header.transactionCnt);

        let previousHash: Hash;

        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            {
                forkId,
                height: blockHeight
            }
        );

        if (previousBlockOrSnapshot.block) {
            previousHash = previousBlockOrSnapshot.block.hash;
        } else {
            previousHash = previousBlockOrSnapshot.stateSnapshot!.hash;
        }

        const blockStruct = {
            transaction: tx,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousHash,
            messageBlocks
        } as BlockStruct;

        return blockStruct;
    }

    private async detectForgedInboundMessageBlock(
        block: Block
    ): Promise<MessageBlockStruct | undefined> {
        if (block.messageBlocks.length === 0) {
            return undefined;
        }

        for (const inboundBlock of block.messageBlocks) {
            const inboundBlockHash = hash(
                Codec.encode(inboundBlock, Type.MessageBlock)
            );

            const existsLocally =
                this.storage.inboundMessages.getMessageBlock(inboundBlockHash);
            if (existsLocally) {
                continue;
            }

            const existsOnChain =
                await this.stateChannelManagerContract.hasInboundMessageBlock(
                    this.channelId,
                    inboundBlockHash
                );

            if (existsOnChain) {
                continue;
            }

            return inboundBlock;
        }

        return undefined;
    }

    // ─────────────────────── ACTION HANDLERS ───────────────────────
    private async success(
        block: Block,
        stateSnapshot: StateSnapshot,
        encodedStateMachineState: Bytes,
        successCallback: () => void,
        participantChanges: ParticipantChanges,
        options?: {
            outboundMessageBlock?: MessageBlockStruct;
            strategy?: AValidationStrategy;
            onBlockCommitted?: () => void;
        }
    ): Promise<void> {
        // step 9 - potentially change status: SYNCED | PENDING_PARTICIPANT → PARTICIPATING
        if (
            this.status === Status.SYNCED ||
            this.status === Status.PENDING_PARTICIPANT
        ) {
            const participants =
                await this.diamondStateMachine.getParticipants();
            const isParticipant = participants.includes(this.signerAddress);
            if (isParticipant) {
                this.setStatus(Status.PARTICIPATING);
                this.storage.forceJoin.clear();
            } else if (this.status === Status.PENDING_PARTICIPANT) {
                await this.maybeInitiateForceJoinDispute(block, participants);
            }
        }
        // step 1 - persist the state snapshot + state machine state first:
        // shouldSignBlock reads the resulting participants from storage
        this.storage.stateSnapshots.storeStateSnapshot(stateSnapshot);
        this.storage.stateMachineStates.storeStateMachineState(
            encodedStateMachineState,
            { hash: stateSnapshot.stateMachineStateHash }
        );

        // step 2 - add my signature if appropriate
        if (
            (await this.shouldSignBlock(block)) &&
            !(options?.strategy instanceof DisputeValidationStrategy)
        ) {
            // Sign the block and add our signature to confirmation signatures
            const signature = await block.sign(this.signer);
            this.logger.debug("Signing block", {
                block: LoggerUtils.getBlockMetadata(block)
            });
            block.expandSignatures([signature]);
        }

        // step 3 - persist the block // TODO - quick hack - cleaner code later
        this.storage.blocks.storeBlock(block, {
            justPersist: options?.strategy instanceof DisputeValidationStrategy
        });
        // The block is canonical from here: a failure in the remaining side
        // effects must not roll the VM back behind stored state.
        options?.onBlockCommitted?.();
        P2pEventHooksUtils.maybeNotifyBlockFinalized({
            block,
            storage: this.storage,
            p2pEventHooks: this.p2pEventHooks,
            logger: this.logger
        });

        // step 5 - persist the outbound message blocks if any
        if (options?.outboundMessageBlock) {
            this.storage.outboundMessages.store(options.outboundMessageBlock);
        }

        // TODO - quick hack - cleaner code later
        if (options?.strategy instanceof DisputeValidationStrategy) return;

        // step 6 - persist participant change points
        if (
            participantChanges.left.size > 0 ||
            participantChanges.joined.size > 0
        ) {
            this.storage.participantSetChanges.storeChangePoint(
                block.forkId,
                block.height
            );
        }

        // step 7 - gossip after local persistence, so echoed confirmations are
        // recognized as duplicates/signature updates instead of being replayed.
        if (
            this.status === Status.PARTICIPATING &&
            !(options?.strategy instanceof DisputeValidationStrategy)
        ) {
            this.p2pManager.remoteRpc.stateTransitionService
                .onBlockConfirmation(block.blockConfirmationStruct)
                .broadcast();
        }

        // step 8 - startMaybeExitOnChain
        await this.startMaybeExitOnChain(
            block,
            stateSnapshot,
            participantChanges,
            options?.outboundMessageBlock
        );

        // step 9 - success callback
        successCallback();

        // step 10 - Notify any event hooks
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        const relevantTimestamp = block.getRelevantTimestamp(nextToWrite);
        P2pEventHooksUtils.notifyTurn({
            nextToWrite,
            nextBlockHeight: block.height + 1,
            relevantTimestamp,
            currentTimestamp: Clock.getTimeInSeconds(),
            timeConfig: this.timeConfig,
            p2pEventHooks: this.p2pEventHooks,
            logger: this.logger
        });

        // step 11 - maybe post block on chain
        if (block.author === this.signerAddress) {
            this.timeoutManager.scheduleTask(
                () => {
                    this.maybePostBlockOnChain(block.hash);
                },
                this.timeConfig.agreementTime * 1000,
                `maybePostBlockOnChain - block ${block.height} - fork ${block.forkId}`
            );
        }

        // step 12 - schedule a timeout check for the next participant

        this.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    block.forkId,
                    block.height + 1, // Check for the next block that the participant should create
                    nextToWrite
                ),
            this.getTimeoutWaitTimeSeconds(block.height + 1) * 1000,
            `participantTimeout(onSuccess) - fork ${block.forkId} - block ${block.height + 1} - participant ${nextToWrite}`
        );
        // step 13 - try execute from queue
        // Universally scheduled on mutex release
    }

    public async shouldSignBlock(block: Block): Promise<boolean> {
        if (this.p2pManager.isBlacklisted(block.author)) return false;
        if (this.status !== Status.PARTICIPATING) return false;
        // Sign only blocks whose previous/resulting participant union contains
        // us (e.g. never after leaving the channel). The resulting snapshot is
        // persisted before signing, so a missing union means "don't sign".
        const signerUnion = new Set<Address>(
            this.storage.getParticipantsUnion(
                block.coordinates,
                block.stateSnapshotHash
            )
        );
        if (!signerUnion.has(this.signerAddress)) {
            return false;
        }
        // Check if the block is posted on-chain and I am the next to write
        if (block.onChainTimestamp !== undefined) {
            const nextToWrite = await this.diamondStateMachine.getNextToWrite();
            if (nextToWrite === this.signerAddress) {
                return false;
            }
        }

        return true;
    }

    private async startMaybeExitOnChain(
        block: Block,
        _stateSnapshot: StateSnapshot,
        participantChanges: ParticipantChanges,
        _outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        if (!participantChanges.left.has(this.signerAddress)) {
            // I didn't exit, nothing to do
            return;
        }

        this.logger.info(
            `startMaybeExitOnChain - I left the channel at block ${block.height}, waiting agreementTime to attempt N/N exit`,
            { blockHeight: block.height, forkId: block.forkId }
        );

        this.timeoutManager.scheduleTask(
            async () => {
                const persistedBlock =
                    this.storage.blocks.getBlock(block.forkId, block.height) ??
                    block;
                const everyoneSigned =
                    this.agreementManager.didEveryoneSignBlock(persistedBlock);

                if (everyoneSigned) {
                    this.logger.info(
                        `startMaybeExitOnChain - everyone signed block ${block.height}, posting state snapshot`,
                        { blockHeight: block.height, forkId: block.forkId }
                    );
                    try {
                        await this.snapshotUpdateService.postStateSnapshot(
                            block.forkId
                        );
                    } catch (error) {
                        this.logger.error(
                            `startMaybeExitOnChain - failed to post state snapshot`,
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            }
                        );
                    }
                } else {
                    // Slow path: not everyone signed - create a self-removal dispute
                    this.logger.info(
                        `startMaybeExitOnChain - not everyone signed block ${persistedBlock.height}, creating self-removal dispute`,
                        {
                            blockHeight: persistedBlock.height,
                            forkId: persistedBlock.forkId
                        }
                    );
                    try {
                        this.storage.forceExit.setForceExit(true);
                        await this.disputeManager.dispute(
                            persistedBlock.forkId
                        );
                    } catch (error) {
                        this.logger.error(
                            `startMaybeExitOnChain - failed to create self-removal dispute`,
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            }
                        );
                    }
                }
            },
            this.timeConfig.agreementTime * 1000,
            `MaybeExitOnChain - block ${block.height} - fork ${block.forkId}`
        );
    }

    private getStrategyByStatus(status: Status): AValidationStrategy {
        if (status === Status.PARTICIPATING) {
            return this.blockValidationStrategy;
        }
        return this.spectatingValidationStrategy;
    }
}
export default StateManager;

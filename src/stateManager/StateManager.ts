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

// TypeChain types - Proof types
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

// TypeChain types - Dispute types
import {
    DisputeStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

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
import Storage from "@/storage";
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
    getChecksumAddress
} from "@/utils";
import type { MutexLockOptions, MutexUnlockOptions } from "@/utils";
// Types
import { BlockValidationResult, Status, TimeConfig } from "@/types";
import {
    Address,
    BlockHeight,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    ReductionTimeoutHandle,
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
import BlockDataAvailabilityService from "./BlockDataAvailabilityService";
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
    reductionTriggerMap: Map<ForkId, ReductionTimeoutHandle> = new Map();
    status: Status = Status.NOT_OPENED;
    timeoutManager: TimeoutManager;
    logger: Logger;
    private readonly blockDataAvailabilityService: BlockDataAvailabilityService;
    blockQueueManager: BlockQueueManager;

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
        this.blockDataAvailabilityService = new BlockDataAvailabilityService(
            this.channelId,
            this.stateChannelManagerContract,
            this.eventHandler,
            this.timeConfig,
            logger
        );
        this.stateChannelEventListener = new StateChannelEventListener(
            this.stateChannelManagerContract,
            this.eventHandler,
            this.diamondStateMachine.localDiamondContract,
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
        this.fraudProofService = new FraudProofService(
            this.storage,
            this.logger
        );
        this.validationService = new ValidationService(
            this.storage,
            this.diamondStateMachine,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.blockDataAvailabilityService,
            this.self,
            this.logger
        );
        this.disputeValidationService = new DisputeValidationService(this.self);
        this.blockValidationStrategy = new BlockValidationStrategy(
            this.storage,
            this.p2pManager,
            this.disputeManager,
            this.logger
        );
        this.spectatingValidationStrategy = new SpectatingValidationStrategy(
            this.storage,
            this.p2pManager,
            this.logger
        );
    }
    //Mark resources for garbage collection
    public async dispose() {
        this.isDisposed = true;
        // Clear reduction timeouts
        for (const [_, reductionHandle] of this.reductionTriggerMap) {
            this.timeoutManager.cancelTask(reductionHandle.handle);
        }
        this.reductionTriggerMap.clear();

        try {
            await Promise.all([
                this.timeoutManager.dispose(),
                this.stateChannelEventListener.dispose(),
                this.p2pManager.dispose(),
                this.diamondStateMachine.dispose()
            ]);
        } finally {
            this.logger.dispose({
                cascadeChildren: true,
                cascadeParent: true
            });
        }
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
                        snapshotStruct
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
        this.blockDataAvailabilityService.setChannelId(channelId);
        await this.stateChannelEventListener.setChannelId(channelId);
    }
    public getChannelId(): ChannelId {
        return this.channelId;
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
    public setReductionTimeout(
        forkId: ForkId,
        localTriggerTimestamp: Timestamp,
        isRescheduled: boolean = false
    ) {
        const now = Clock.getTimeInSeconds();
        this.logger.debug(
            `setReductionTimeout called for fork ${forkId} at ${localTriggerTimestamp} (in ${localTriggerTimestamp - now}s)`
        );
        if (this.forkId !== forkId) return;

        const existingHandle = this.reductionTriggerMap.get(forkId);

        // If existing timeout exists, only replace if new timeout is further in the future or if it's reschduled (fix a bug where the rescheduled timeout isn't replaced and doesn't fire)
        // TODO - probably has an edge-case related to the timestamp (think)
        if (existingHandle) {
            if (
                !isRescheduled &&
                existingHandle.triggerTimestamp >= localTriggerTimestamp
            ) {
                return;
            }
            this.timeoutManager.cancelTask(existingHandle.handle);
        }

        // Schedule new reduction attempt
        const handle = this.timeoutManager.scheduleTask(
            () => {
                // Don't call reductionTriggerMap.delete(forkId) - race condition problem
                this.tryReduce(forkId);
            },
            Math.max(0, (localTriggerTimestamp - now) * 1000),
            `reduction-${forkId}`
        );

        this.reductionTriggerMap.set(forkId, {
            handle,
            triggerTimestamp: localTriggerTimestamp
        });

        this.logger.info(
            `Scheduled reduction timeout for fork ${forkId} at ${localTriggerTimestamp} (in ${localTriggerTimestamp - now}s)`
        );
    }

    private async tryReduce(forkId: ForkId) {
        // Ensure we're still on this fork
        if (this.forkId !== forkId) {
            this.logger.debug(
                `Skipping reduction - no longer on fork ${forkId}`
            );
            return;
        }

        // Step 1: Check locally if kill period expired (fast, no RPC call)
        const { isExpired: canReduceLocally, killPeriodEnd: killTimestamp } =
            await this.diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                this.channelId,
                forkId
            );

        const timeRemaining = Math.max(
            0,
            Number(killTimestamp) - Clock.getTimeInSeconds()
        );
        this.logger.debug(
            `Local Reduction check for fork ${forkId}: canReduce=${canReduceLocally}, timeRemaining=${timeRemaining}s`
        );

        // Step 2: If local state says not ready, reschedule check
        if (!canReduceLocally) {
            if (timeRemaining > 0) {
                this.logger.debug(
                    `Rescheduling reduction check in ${timeRemaining}s`
                );
                return this.setReductionTimeout(
                    forkId,
                    Clock.getTimeInSeconds() + timeRemaining,
                    true
                );
            }
            // timeRemaining is 0 but can't reduce -> local state not synced, fall through to on-chain check
            this.logger.debug(
                `Local state not synced, checking on-chain state`
            );
        }

        // Step 3: Verify on-chain before committing to reduction
        const {
            isExpired: canReduceOnChain,
            killPeriodEnd: onChainKillTimestamp,
            blockTimestamp: onChainTimestamp
        } = await this.stateChannelManagerContract.isKillPeriodExpired(
            this.channelId,
            forkId
        );

        const remaining = Math.max(
            0,
            Number(onChainKillTimestamp) - Number(onChainTimestamp) // TODO this was Clock.getTimeInSeconds() before, but we were ecountering remaining == 0
        );

        await LoggerUtils.logTimestamp(this.logger, "verbose");
        this.logger.debug(
            `On-chain Reduction check for fork ${forkId}: canReduce=${canReduceOnChain}, timeRemaining=${remaining}s`,
            {
                onChainKillTimestamp,
                onChainTimestamp
            }
        );

        if (!canReduceOnChain) {
            if (remaining > 0) {
                this.logger.debug(
                    `On-chain check: rescheduling in ${remaining}s`
                );
                return this.setReductionTimeout(
                    forkId,
                    Clock.getTimeInSeconds() + remaining,
                    true
                );
            }
            throw new Error(
                `Cannot reduce fork ${forkId}: kill period not expired on-chain (timeRemaining=${remaining})`
            );
        }

        //TODO - see to put all genesisTimestamp logic in one place
        const genesisTimestamp =
            Number(onChainKillTimestamp) + this.timeConfig.evidenceTime;
        // Step 4: Perform reduction
        try {
            await this.performReduction(forkId, genesisTimestamp);
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith("Missing Dispute in storage")
            ) {
                this.logger.error(
                    `Skipping reduction for fork ${forkId} because local dispute data is unavailable`,
                    { error: error.message }
                );
            }
            throw error;
        }
    }

    private async performReduction(
        forkId: ForkId,
        genesisTimestamp: Timestamp
    ) {
        const now = Clock.getTimeInSeconds();
        this.logger.info(
            `Performing reduction for fork ${forkId} with genesis timestamp ${genesisTimestamp}, in (${genesisTimestamp - now}s)`
        );
        const disputes = await this.agreementManager.getForkDisputes(
            this.channelId,
            forkId,
            this.stateChannelManagerContract
        );

        this.logger.debug(
            `Performing reduction on disputes for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                disputes: disputes.map((d) => LoggerUtils.getDisputeMetadata(d))
            }
        );
        if (disputes.length === 0) {
            this.logger.warn(
                `No disputes found while reducing disputed fork ${forkId}; initiating local dispute`
            );
            await this.disputeManager.dispute(forkId);
            return;
        }

        const reducedOutput =
            await this.stateChannelManagerContract.reduce.staticCall(disputes);

        const reduceData = await this.agreementManager.getReduceData(
            forkId,
            reducedOutput
        );
        const [
            reducedSnapshotData,
            reducedEncodedStateMachineState,
            reducedOutboundMessageBlock
        ] =
            await this.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                forkId,
                reducedOutput,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.inboundMessageBlocks
            );
        const expectedReducedForkId = ethers.keccak256(
            Codec.encode(reducedSnapshotData, Type.SnapshotData)
        );

        // Pre-store the outbound message block so buildForkSnapshotCalldata can
        // find it via getMessageBlocksInRange.
        if (reducedOutboundMessageBlock) {
            this.storage.outboundMessages.store(reducedOutboundMessageBlock, {
                justPersist: true
            });
        }

        const currentOnChainSnapshot = StateSnapshot.from(
            await this.stateChannelManagerContract.getStateSnapshot(
                this.channelId
            )
        );
        const reducedGenesisSnapshot = StateSnapshot.from({
            forkId: expectedReducedForkId,
            blockHeight: 0,
            timestamp: Number(genesisTimestamp),
            snapshotData: reducedSnapshotData
        });
        const { calldata: forkCalldata } = this.buildForkSnapshotCalldata(
            reducedGenesisSnapshot,
            currentOnChainSnapshot
        );

        const reduceCalldata =
            this.stateChannelManagerContract.interface.encodeFunctionData(
                "reduceAndFinalize",
                [
                    disputes,
                    reduceData.latestStateSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.inboundMessageBlocks,
                    expectedReducedForkId
                ]
            );

        this.logger.info("Reduction transaction submit", {
            reducedForkId: expectedReducedForkId,
            channelId: this.channelId
        });

        let txResponse: TransactionResponse;
        this.logger.debug(
            `Submitting reduction transaction for fork ${LoggerUtils.formatHash(forkId)}`,
            {
                disputes: disputes.map((d) =>
                    LoggerUtils.getDisputeMetadata(d)
                ),
                reduceData: {
                    latestStateSnapshot: LoggerUtils.getSnapshotMetadata(
                        StateSnapshot.from(reduceData.latestStateSnapshot)
                    ),
                    encodedStateMachineState:
                        reduceData.encodedStateMachineState,
                    inboundMessageBlocks: reduceData.inboundMessageBlocks.map(
                        (b) => LoggerUtils.getMessageBlockMetadata(b)
                    )
                }
            }
        );

        const txResponsePromise = this.stateChannelManagerContract
            .multicall([reduceCalldata, forkCalldata], { gasLimit: 10_000_000 })
            .then((tx: TransactionResponse) => {
                txResponse = tx;
                const txReceiptPromise = tx.wait();
                DetachedPromises.collect(txReceiptPromise);
                return txReceiptPromise;
            })
            .then(() => {
                this.logger.info(
                    `Reduction complete (on-chain): transitioning from fork ${LoggerUtils.formatHash(forkId)}`
                );
            })
            .catch(async (error: any) => {
                const success = await tryHandleEvmError(error, {
                    tx: txResponse!,
                    forkId,
                    logger: this.logger,
                    handlers: {
                        RaceConditionDisputeAlreadyReduced: () => {
                            this.logger.debug(
                                `Reduction already completed by another peer for fork ${LoggerUtils.formatHash(forkId)} - RaceConditionDisputeAlreadyReduced`
                            );
                        },
                        RaceConditionReductionExpectationDoesntMatch: () => {
                            this.logger.error(
                                `Reduction expectation mismatch for fork ${LoggerUtils.formatHash(forkId)} -> expected ${LoggerUtils.formatHash(expectedReducedForkId)}`
                            );
                        },
                        RaceConditionBlockHeightTooOld: () => {
                            this.logger.error(
                                `Update of on-chain snapshot already completed by another peer for fork ${LoggerUtils.formatHash(forkId)} - RaceConditionBlockHeightTooOld`
                            );
                        },
                        ErrorCantParticipateInDispute: () => {
                            // TODO -> ignore -> malicious peer
                        }
                    },
                    signer: this.signer
                });

                if (!success) throw error;
            });
        DetachedPromises.collect(txResponsePromise);

        try {
            // Compute local state after reduction (optimistic - assume tx will succeed)
            const snapshotData = reducedSnapshotData;
            const encodedStateMachineState = reducedEncodedStateMachineState;
            const outboundMessageBlock = reducedOutboundMessageBlock;
            this.logger.debug(
                `Optimistic local reduction computed for fork ${LoggerUtils.formatHash(forkId)}`,
                {
                    reducedSnapshotData:
                        LoggerUtils.getSnapshotDataMetadata(snapshotData),
                    outboundMessageBlock: outboundMessageBlock
                        ? LoggerUtils.getMessageBlockMetadata(
                              outboundMessageBlock
                          )
                        : null
                }
            );
            const reducedForkId = ethers.keccak256(
                Codec.encode(snapshotData, Type.SnapshotData)
            );

            // Update local state to the reduced fork
            this.logger.info(
                `Reduction complete (local): transitioning from fork ${LoggerUtils.formatHash(forkId)} to fork ${LoggerUtils.formatHash(reducedForkId)}`
            );
            await this.setGenesisState(
                snapshotData,
                encodedStateMachineState,
                reducedForkId,
                genesisTimestamp,
                outboundMessageBlock
            );
        } catch (error) {
            const custom = tryDecodeCustomError(error);
            this.logger.error("Error computing reduced snapshot data", {
                custom,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    private buildForkSnapshotCalldata(
        reducedGenesisSnapshot: StateSnapshot,
        currentOnChainSnapshot: StateSnapshot
    ): { calldata: string; outboundMessageBlocks: MessageBlockStruct[] } {
        // reducedGenesisSnapshot is  newer than currentOnChainSnapshot,
        const outboundMessageBlocks =
            this.storage.outboundMessages.getMessageBlocksInRange({
                lowerBlockHash:
                    currentOnChainSnapshot.latestOutboundMessageBlockHash,
                upperBlockHash:
                    reducedGenesisSnapshot.latestOutboundMessageBlockHash
            });
        const calldata =
            this.stateChannelManagerContract.interface.encodeFunctionData(
                "updateStateSnapshotFork",
                [
                    this.channelId,
                    reducedGenesisSnapshot.toStruct(),
                    outboundMessageBlocks
                ]
            );
        return { calldata, outboundMessageBlocks };
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
        this.latestForkId = forkId;
    }

    //Triggered by the On-chain Event Listener when a joinChannelEvent is emitted on-chain
    public async onInboundMessage(
        messageBlock: MessageBlockStruct,
        messageBlockHash: Hash
    ) {
        this.storage.inboundMessages.store(messageBlock, {
            hash: messageBlockHash
        });
    }

    public async joinChannel(
        confirmation: JoinChannelConfirmationStruct
    ): Promise<void> {
        if (this.status !== Status.SYNCED) return;

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
            const expectedSnapshotHash = StateSnapshot.from(
                await this.diamondStateMachine.localDiamondContract.getStateSnapshot(
                    this.channelId
                )
            ).hash;
            const tx = await this.stateChannelManagerContract.joinChannel(
                confirmation,
                expectedSnapshotHash
            );
            await tx.wait();
        } catch (error) {
            this.setStatus(Status.SYNCED);
            this.storage.forceJoin.clear();

            const custom = tryDecodeCustomError(error);
            switch (custom?.name) {
                case "RaceConditionJoinChannelExpired":
                case "RaceConditionJoinChannelSnapshotMismatch":
                case "RaceConditionJoinChannelForkDisputed":
                    // TODO: call general abort() here once it exists outside spectate
                    // (see SpectateService.abort + EventHandler.onStateSnapshotUpdated).
                    this.logger.warn(
                        `joinChannel - race condition: ${custom.name}`,
                        {
                            name: custom.name,
                            args: custom.errorDescription.args
                        }
                    );
                    // Rethrown as CustomEvmError
                    throw custom;
            }
            this.logger.warn("joinChannel - tx failed, reverting to SYNCED", {
                error: error instanceof Error ? error.message : String(error)
            });
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
            this.getTimeoutWaitTimeSeconds() + timeAdjustment;
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

        this.p2pEventHooks.onSetState?.();
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

    public async setGenesisState(
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

        await this.setLatestState(
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

    public getActiveValidationStrategy(): AValidationStrategy {
        return this.getStrategyByStatus(this.status);
    }

    public async tryMergeStoredBlockConfirmation(
        block: Block,
        strategy: AValidationStrategy,
        senderAddress?: Address
    ): Promise<BlockValidationResult | undefined> {
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
            this.logger.warn(
                "maybeMergeStoredBlockConfirmation - not all new signers are participants",
                {
                    strategy: strategy.name,
                    senderAddress,
                    block: LoggerUtils.getBlockMetadata(block, this.storage),
                    newSignerAddresses: Array.from(newSignerAddresses),
                    participants: Array.from(participants)
                }
            );
            return strategy.notAllSingersAreParticipants(block);
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

    // Passes the block confirmation through a verification pipeline
    // returns true if the block is valid and the state transition is successful
    // returns false -> the calling context should disconnect from the peer
    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        options?: {
            onChainTimestamp?: Timestamp;
            validationStrategy?: AValidationStrategy;
            senderAddress?: string;
        }
    ): Promise<boolean> {
        let strategy: AValidationStrategy | undefined;
        let block: Block | undefined;
        let keepConnection: boolean | undefined;

        try {
            await this.mutex.lock({ taskName: "onBlockConfirmation" });

            strategy =
                options?.validationStrategy ||
                this.getStrategyByStatus(this.status);
            block = Block.fromBlockConfirmation(
                blockConfirmation,
                options?.onChainTimestamp
            );

            if (this.storage.blocks.getBlock(block.hash)) {
                this.blockQueueManager.scheduleStoredBlockConfirmationMerge(
                    block,
                    strategy,
                    options?.senderAddress
                        ? [options.senderAddress as Address]
                        : []
                );
                return true;
            }

            let validationResult: BlockValidationResult =
                BlockValidationResult.SUCCESS;

            const isAuthentic =
                await this.isBlockConfirmationAuthentic(blockConfirmation);

            if (!isAuthentic) {
                validationResult =
                    await strategy.authenticateBlockFailed(blockConfirmation);

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
                    block,
                    strategy,
                    options?.senderAddress
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

            const stateBeforeTransitionValidation =
                await this.diamondStateMachine.getState();

            const {
                success,
                encodedState,
                successCallback,
                outboundMessages,
                participantsBefore
            } = await this.applyTransaction(block.tx);

            if (!success) {
                await this.restoreStateAfterFailedValidation(
                    stateBeforeTransitionValidation,
                    "state transition failed",
                    block
                );

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
                await this.restoreStateAfterFailedValidation(
                    stateBeforeTransitionValidation,
                    "state snapshot hash mismatch",
                    block
                );

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
                this.blockQueueManager.disconnectPeersForSignatures(
                    block.hash,
                    unexpectedSignatures
                );
                validationResult =
                    await strategy.notAllSingersAreParticipants(block);
                this.logger.warn(
                    "onBlockConfirmation - signer not in previous/resulting participant union",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        block: LoggerUtils.getBlockMetadata(
                            block,
                            this.storage
                        ),
                        unexpectedSigners: Array.from(unexpectedSigners),
                        allowedSigners: Array.from(allowedSigners)
                    }
                );
                keepConnection =
                    await strategy.interpretFinalValidationResult(
                        validationResult
                    );
                return keepConnection;
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
                    strategy
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
                this.timeConfig.p2pTime +
                this.timeConfig.agreementTime +
                this.timeConfig.chainFallbackTime;

            const blockMetadata = LoggerUtils.getBlockMetadata(
                block,
                this.storage
            );
            const currentTime = Clock.getTimeInSeconds();
            this.logger.info("Posting block calldata on-chain", {
                block: blockMetadata,
                maxTimestamp,
                currentTime
            });

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

    public async postStateSnapshot(
        forkId: ForkId
    ): Promise<StateSnapshot | undefined> {
        const forkData = await this.prepareUpdateStateSnapshotFork();
        const sameForkData = await this.prepareUpdateSnapshotSameFork(forkId);

        const expectedSnapshot =
            sameForkData?.expectedSnapshot ??
            forkData?.expectedSnapshot ??
            undefined;

        const callData: string[] = [
            ...(forkData?.callData ?? []),
            ...(sameForkData?.callData ?? [])
        ];

        if (callData.length > 0) {
            this.logger.info(
                `Posting state snapshot on-chain for fork ${LoggerUtils.formatHash(forkId)}`,
                {
                    expectedSnapshot: expectedSnapshot
                        ? LoggerUtils.getSnapshotMetadata(expectedSnapshot)
                        : "ERROR N/A",
                    forkData: {
                        snapshot: forkData?.expectedSnapshot
                            ? LoggerUtils.getSnapshotMetadata(
                                  forkData.expectedSnapshot
                              )
                            : "N/A",
                        outboundMessageBlocks: forkData?.outboundMessageBlocks
                            ? forkData.outboundMessageBlocks.map(
                                  LoggerUtils.getMessageBlockMetadata
                              )
                            : "N/A"
                    },
                    sameForkData: {
                        snapshot: sameForkData?.expectedSnapshot
                            ? LoggerUtils.getSnapshotMetadata(
                                  sameForkData.expectedSnapshot
                              )
                            : "N/A",
                        outboundMessageBlocks:
                            sameForkData?.outboundMessageBlocks
                                ? sameForkData.outboundMessageBlocks.map(
                                      LoggerUtils.getMessageBlockMetadata
                                  )
                                : "N/A"
                    }
                }
            );
            let transactionResponse: TransactionResponse;
            const txResponsePromise = this.stateChannelManagerContract
                .multicall(callData)
                .then((txResponse) => {
                    transactionResponse = txResponse;
                    const txReceiptPromise = txResponse.wait();
                    DetachedPromises.collect(txReceiptPromise);
                    return txReceiptPromise;
                })
                .catch(async (error) => {
                    const success = await tryHandleEvmError(error, {
                        tx: transactionResponse!,
                        logger: this.logger,
                        signer: this.signer,
                        forkId,
                        handlers: {
                            RaceConditionSnapshotForkMismatch: () => {
                                this.logger.warn(
                                    "postStateSnapshot: snapshot fork mismatch — another peer's snapshot landed first",
                                    { forkId }
                                );
                            },
                            RaceConditionBlockHeightTooOld: () => {
                                this.logger.warn(
                                    "postStateSnapshot: block height too old — newer snapshot already on-chain",
                                    { forkId }
                                );
                            },
                            RaceConditionPendingInboundNotConsumed: () => {
                                this.logger.error(
                                    "postStateSnapshot: pending inbound not consumed by our snapshot",
                                    { forkId }
                                );
                                throw new Error(
                                    `postStateSnapshot: pending inbound not consumed for forkId=${forkId}`
                                );
                            },
                            RaceConditionReductionExpectationDoesntMatch:
                                () => {
                                    this.logger.error(
                                        "postStateSnapshot: reduction already finalized to a different forkId",
                                        { forkId }
                                    );
                                    throw new Error(
                                        `postStateSnapshot: reduction already finalized to a different forkId for forkId=${forkId}`
                                    );
                                }
                        }
                    });
                    if (success) return;
                    const custom = tryDecodeCustomError(error);
                    this.logger.error("Error posting state snapshot", {
                        custom,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    });
                    throw error;
                });
            DetachedPromises.collect(txResponsePromise);
            return expectedSnapshot;
        } else {
            this.logger.debug("No state snapshot updates needed");
            return undefined;
        }
    }

    /**
     * Prepares data for updating the state snapshot when the fork is the same
     */
    public async prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshot;
              milestoneProofs: MilestoneProofStruct[];
              milestoneSnapshots: StateSnapshot[];
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        try {
            const currentOnChainSnapshot = StateSnapshot.from(
                await this.diamondStateMachine.localDiamondContract.getStateSnapshot(
                    this.channelId
                )
            );

            if (!currentOnChainSnapshot) {
                return undefined;
            }
            // Get the latest block height for this fork from storage
            const latestBlockHeight =
                this.storage.blocks.getNextBlockHeight(forkId) - 1;

            // Get the state proof from AgreementManager
            const stateProof = await this.agreementManager.getStateProof(
                forkId,
                latestBlockHeight
            );

            // Filter milestone proofs to only include those relevant for the transition from current on-chain state
            const milestoneProofs: MilestoneProofStruct[] = [];
            const milestoneSnapshots: StateSnapshot[] = [];

            for (const milestoneProof of stateProof.milestones) {
                if (milestoneProof.blockConfirmations.length === 0) {
                    throw new Error("Empty milestone proof found");
                }

                // Get the state snapshot
                const snapshot =
                    this.agreementManager.getSnapshotFromMilestone(
                        milestoneProof
                    );
                if (!snapshot)
                    throw new Error(
                        "Milestone built but corresponding snapshot not found"
                    );

                if (
                    await this.diamondStateMachine.localDiamondContract.isSnapshotNewer(
                        snapshot.toStruct(),
                        currentOnChainSnapshot.toStruct()
                    )
                ) {
                    milestoneProofs.push(milestoneProof);
                    milestoneSnapshots.push(snapshot);
                }
            }

            // No relevant milestones found
            if (milestoneSnapshots.length === 0) {
                return undefined;
            }

            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];

            // Latest snapshot is the same as current on-chain
            if (latestSnapshot.hash === currentOnChainSnapshot.hash) {
                return undefined;
            }

            // Verify that both snapshots belong to the same fork
            if (currentOnChainSnapshot.forkID !== latestSnapshot.forkID) {
                throw new Error(
                    `Fork mismatch: current fork ${currentOnChainSnapshot.forkID}, new fork ${latestSnapshot.forkID}`
                );
            }

            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData
                    .latestOutboundMessageBlockHash;
            const latestLocalExitBlockHash =
                latestSnapshot.snapshotData.latestOutboundMessageBlockHash;
            const outboundMessageBlocks =
                this.storage.outboundMessages.getMessageBlocksInRange({
                    upperBlockHash: latestLocalExitBlockHash,
                    lowerBlockHash: currentOnChainExitBlockHash
                });

            const sameForkCalldata =
                this.stateChannelManagerContract.interface.encodeFunctionData(
                    "updateStateSnapshotSameFork",
                    [
                        this.channelId,
                        milestoneProofs,
                        milestoneSnapshots.map((snapshot) =>
                            snapshot.toStruct()
                        ),
                        outboundMessageBlocks
                    ]
                );

            return {
                callData: [sameForkCalldata],
                expectedSnapshot: latestSnapshot,
                milestoneProofs,
                milestoneSnapshots,
                outboundMessageBlocks
            };
        } catch (error) {
            this.logger.error(
                "Error preparing update snapshot for the same fork",
                {
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            throw error;
        }
    }

    /**
     * Prepares data for updateStateSnapshotFork
     */
    public async prepareUpdateStateSnapshotFork(): Promise<
        | {
              callData: string[];
              expectedSnapshot: StateSnapshot;
              outboundMessageBlocks: MessageBlockStruct[];
          }
        | undefined
    > {
        try {
            // Get the current on-chain snapshot first
            const currentOnChainSnapshot = StateSnapshot.from(
                await this.stateChannelManagerContract.getStateSnapshot(
                    this.channelId
                )
            );

            this.logger.debug("prepareUpdateStateSnapshotFork - start", {
                channelId: this.channelId,
                onChainForkId: currentOnChainSnapshot.forkID,
                onChainBlockHeight: currentOnChainSnapshot.blockHeight,
                onChainLatestOutboundMessageBlockHash:
                    currentOnChainSnapshot.snapshotData
                        .latestOutboundMessageBlockHash
            });

            let currentForkId = currentOnChainSnapshot.forkID;
            const callData: string[] = [];

            // Traverse through dispute windows until we reach a fork with no disputes
            let isDisputed =
                await this.stateChannelManagerContract.isForkDisputed(
                    this.channelId,
                    currentForkId
                );

            this.logger.verbose(
                "prepareUpdateStateSnapshotFork - dispute status",
                {
                    forkId: currentForkId,
                    isDisputed
                }
            );

            if (!isDisputed) {
                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - fork not disputed; no update needed",
                    {
                        forkId: currentForkId
                    }
                );
                return undefined; // No fork update needed
            }

            while (isDisputed) {
                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - traversing disputed fork",
                    {
                        forkId: currentForkId
                    }
                );
                // If reduced result already exists on-chain, traverse to it
                const existingReducedResult =
                    await this.stateChannelManagerContract.getReducedResult(
                        this.channelId,
                        currentForkId
                    );
                // if reduceResult exists and is final
                if (existingReducedResult?.reducedForkId != ethers.ZeroHash) {
                    this.logger.verbose(
                        "prepareUpdateStateSnapshotFork - reduced result exists; traversing",
                        {
                            fromForkId: currentForkId,
                            toForkId: existingReducedResult.reducedForkId
                        }
                    );
                    currentForkId = existingReducedResult.reducedForkId;
                    isDisputed =
                        await this.stateChannelManagerContract.isForkDisputed(
                            this.channelId,
                            currentForkId
                        );

                    this.logger.verbose(
                        "prepareUpdateStateSnapshotFork - dispute status after traverse",
                        {
                            forkId: currentForkId,
                            isDisputed
                        }
                    );
                    continue;
                }

                // Fetch dispute commitments for this window
                const disputeCommitments =
                    await this.stateChannelManagerContract.getWindowCommitments(
                        this.channelId,
                        currentForkId
                    );

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - window commitments",
                    {
                        forkId: currentForkId,
                        commitmentsCount: disputeCommitments?.length ?? 0
                    }
                );
                if (!disputeCommitments || disputeCommitments.length === 0) {
                    // Nothing to reduce; wait for more data
                    this.logger.verbose(
                        "prepareUpdateStateSnapshotFork - no commitments; stopping traversal",
                        {
                            forkId: currentForkId
                        }
                    );
                    break;
                }

                // Build disputes from local storage confirmations
                const disputes: DisputeStruct[] = disputeCommitments.map(
                    (commitment) => {
                        const dispute =
                            this.storage.disputes.getDispute(commitment);
                        if (!dispute) {
                            throw new Error(
                                `Missing Dispute in storage for dispute commitment ${commitment}`
                            );
                        }
                        return dispute;
                    }
                );

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - disputes built from storage",
                    {
                        forkId: currentForkId,
                        disputesCount: disputes.length
                    }
                );

                // Use proxy view to compute reduced output cheaply (no tx)
                const reducedOutput =
                    await this.stateChannelManagerContract.reduce.staticCall(
                        disputes
                    );
                const reduceData = await this.agreementManager.getReduceData(
                    currentForkId,
                    reducedOutput
                );

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - reduce data prepared",
                    {
                        forkId: currentForkId,
                        latestStateSnapshotForkId:
                            reduceData.latestStateSnapshot.forkId
                    }
                );

                const [snapshotData] =
                    await this.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                        currentForkId,
                        reducedOutput,
                        reduceData.latestStateSnapshot,
                        reduceData.encodedStateMachineState,
                        reduceData.inboundMessageBlocks
                    );
                const reducedForkId = ethers.keccak256(
                    Codec.encode(snapshotData, Type.SnapshotData)
                );

                const reduceAndFinalizeCalldata =
                    this.stateChannelManagerContract.interface.encodeFunctionData(
                        "reduceAndFinalize",
                        [
                            disputes,
                            reduceData.latestStateSnapshot,
                            reduceData.encodedStateMachineState,
                            reduceData.inboundMessageBlocks,
                            reducedForkId
                        ]
                    );
                callData.push(reduceAndFinalizeCalldata);

                this.logger.verbose(
                    "prepareUpdateStateSnapshotFork - reduced fork prepared",
                    {
                        fromForkId: currentForkId,
                        reducedForkId
                    }
                );

                // Traverse to the reduced fork
                currentForkId = reducedForkId;
                isDisputed =
                    await this.stateChannelManagerContract.isForkDisputed(
                        this.channelId,
                        currentForkId
                    );

                this.logger.debug(
                    "prepareUpdateStateSnapshotFork - dispute status after reduction",
                    {
                        forkId: currentForkId,
                        isDisputed
                    }
                );
            }

            this.logger.debug(
                "prepareUpdateStateSnapshotFork - traversal complete",
                {
                    resolvedForkId: currentForkId,
                    resolvedForkIsDisputed: isDisputed
                }
            );

            // Get the genesis snapshot for the final resolved fork
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    currentForkId
                );
            if (!genesisSnapshot) {
                throw new Error(
                    `No genesis snapshot found for fork ${currentForkId}`
                );
            }

            if (genesisSnapshot.forkID !== this.forkId) {
                throw new Error(
                    `Fork mismatch: update will result in fork ${genesisSnapshot.forkID}, but target fork is ${this.forkId}.`
                );
            }

            const { calldata: forkCalldata, outboundMessageBlocks } =
                this.buildForkSnapshotCalldata(
                    genesisSnapshot,
                    currentOnChainSnapshot
                );

            this.logger.debug(
                "prepareUpdateStateSnapshotFork - outbound message block range",
                {
                    forkId: currentForkId,
                    blocksCount: outboundMessageBlocks.length
                }
            );

            callData.push(forkCalldata);

            if (callData.length === 0) {
                return undefined;
            }

            return {
                callData,
                expectedSnapshot: genesisSnapshot,
                outboundMessageBlocks
            };
        } catch (error) {
            this.logger.error("Error preparing update state snapshot fork", {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
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

    private summarizeMilestoneProofsForLog(
        milestoneProofs: MilestoneProofStruct[]
    ): Array<{ blockHeight: number; signers: Address[] }> {
        return milestoneProofs.flatMap((milestone) =>
            milestone.blockConfirmations.map((blockConfirmation) => {
                const block = Block.fromBlockConfirmation(blockConfirmation);
                return {
                    blockHeight: block.height,
                    signers: Array.from(block.allSignerAddresses)
                };
            })
        );
    }

    private summarizeMilestoneSnapshotsForLog(
        milestoneSnapshots: StateSnapshot[]
    ): Array<{ ThresholdSet: Address[] }> {
        return milestoneSnapshots.map((snapshot) => ({
            ThresholdSet: snapshot.snapshotData.participants
        }));
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
        const timeoutWaitTime = this.getTimeoutWaitTimeSeconds();
        let difference =
            previousRelevantTimestamp +
            timeoutWaitTime -
            Clock.getTimeInSeconds();
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

        // (race condition) check did previous participant post on-chain granting this one extra time
        if (
            previousBlockOrSnapshot.block &&
            !previousBlockOrSnapshot.block.onChainTimestamp
        ) {
            const scheduleStatus =
                await this.blockDataAvailabilityService.tryFetchOnChainBlockAndScheduleValidation(
                    previousBlockOrSnapshot.block.forkId,
                    previousBlockOrSnapshot.block.height,
                    previousBlockOrSnapshot.block.author
                );

            if (
                this.blockDataAvailabilityService.shouldDeferCurrentValidation(
                    scheduleStatus
                )
            ) {
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
                        scheduleStatus
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

            const updatedPreviousBlock = this.storage.blocks.getBlock(
                previousBlockOrSnapshot.block.forkId,
                previousBlockOrSnapshot.block.height
            );
            if (updatedPreviousBlock?.onChainTimestamp) {
                difference =
                    updatedPreviousBlock.onChainTimestamp +
                    this.getTimeoutWaitTimeSeconds() -
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
                            updatedPreviousBlock,
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
                true
            );
        }

        // (race condition) check if current block posted on-chain
        const scheduleStatus =
            await this.blockDataAvailabilityService.tryFetchOnChainBlockAndScheduleValidation(
                forkId,
                blockHeight,
                participantAddress
            );
        if (
            this.blockDataAvailabilityService.shouldDeferCurrentValidation(
                scheduleStatus
            )
        ) {
            this.logger.info(
                "tryTimeoutParticipant - waiting for current on-chain block validation",
                {
                    forkId,
                    blockHeight,
                    participantAddress,
                    scheduleStatus
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
                true
            );
        }
        // block not found on-chain -> normal timeout
        return await this.createTimeOutDispute(
            forkId,
            blockHeight,
            participantAddress,
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
            minTimeStamp: Clock.getTimeInSeconds(),
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

    public getTimeoutWaitTimeSeconds() {
        return (
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime
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

        if (
            Number(tx.header.timestamp) >
            previousRelativeTimestamp + this.timeConfig.p2pTime
        ) {
            this.logger.verbose("Adjusting timestamp - was in the future", {
                forkId,
                txTimestamp: Number(tx.header.timestamp),
                previousRelativeTimestamp,
                p2pTime: this.timeConfig.p2pTime,
                diff:
                    Number(tx.header.timestamp) -
                    (previousRelativeTimestamp + this.timeConfig.p2pTime),
                newTimestamp:
                    previousRelativeTimestamp + this.timeConfig.p2pTime
            });
            tx.header.timestamp = BigInt(
                previousRelativeTimestamp + this.timeConfig.p2pTime
            );
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
        // step 1 - add my signature if appropriate
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

        // step 2 - persist the block // TODO - quick hack - cleaner code later
        this.storage.blocks.storeBlock(block, {
            justPersist: options?.strategy instanceof DisputeValidationStrategy
        });
        P2pEventHooksUtils.maybeNotifyBlockFinalized({
            block,
            storage: this.storage,
            p2pEventHooks: this.p2pEventHooks,
            logger: this.logger
        });

        // step 3 - persist the state snapshot
        this.storage.stateSnapshots.storeStateSnapshot(stateSnapshot);

        // step 4 - persist state machine state
        this.storage.stateMachineStates.storeStateMachineState(
            encodedStateMachineState,
            { hash: stateSnapshot.stateMachineStateHash }
        );

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
            this.getTimeoutWaitTimeSeconds() * 1000,
            `participantTimeout(onSuccess) - fork ${block.forkId} - block ${block.height + 1} - participant ${nextToWrite}`
        );
        // step 13 - try execute from queue
        // Universally scheduled on mutex release
    }

    public async shouldSignBlock(block: Block): Promise<boolean> {
        if (this.p2pManager.isBlacklisted(block.author)) return false;
        if (this.status !== Status.PARTICIPATING) return false;
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
                        await this.postStateSnapshot(block.forkId);
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

    private async dispute(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // The fraud proof has already been stored by ValidationService
        // rest is left as TODO for now
        // https://trello.com/c/qwpYPLj8
        throw new Error("Not implemented");
    }

    private getStrategyByStatus(status: Status): AValidationStrategy {
        if (status === Status.PARTICIPATING) {
            return this.blockValidationStrategy;
        }
        return this.spectatingValidationStrategy;
    }
}
export default StateManager;

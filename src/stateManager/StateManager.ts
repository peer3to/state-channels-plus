// External libraries
import { ethers } from "ethers";

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
    MessageBlockStruct
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
    Logger,
    DetachedPromises,
    createEthersResultProxy
} from "@/utils";
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
    Timestamp,
    UpdatedBlockWithCalldata
} from "@/types/types";

import FraudProofService from "./utils/FraudProofService";
import DisputeValidationService from "./DisputeValidationService";
import AValidationStrategy from "./validationStrategy/AValidationStrategy";
import BlockValidationStrategy from "./validationStrategy/BlockValidationStrategy";
import SpectatingValidationStrategy from "./validationStrategy/SpectatingValidationStrategy";

import { config } from "@/utils/config";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { LoggerUtils } from "@/utils/LoggerUtils";
import type { RpcServiceFactoryMap } from "@/rpc/registry";
import { TransactionResponse } from "ethers";
import DisputeValidationStrategy from "./validationStrategy/DisputeValidationStrategy";

const NULL = "0x00";

type ParticipantChanges = {
    left: Set<Address>;
    joined: Set<Address>;
};
class StateManager {
    diamondStateMachine: ADiamondStateMachine;
    p2pEventHooks: P2pEventHooks;
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelEventListener: StateChannelEventListener;
    disputeManager: DisputeManager;
    stateChannelManagerContract: StateChannelManagerProxy;
    p2pManager: P2PManager;
    timeConfig: TimeConfig;
    channelId: ChannelId = NULL;
    mutex: Mutex = new Mutex();
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

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        logger: Logger,
        rpcServiceFactories?: RpcServiceFactoryMap
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
        this.timeoutManager = new TimeoutManager(logger);

        this.eventHandler = new EventHandler(
            this.storage,
            this.self,
            this.p2pEventHooks,
            this.diamondStateMachine,
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
        this.p2pManager = new P2PManager<RpcServiceFactoryMap>(
            this.self,
            signer,
            rpcServiceFactories
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
                this.p2pManager.dispose()
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

    public maybeNotifyBlockFinalized(block: Block): void {
        try {
            const participantsUnion = this.storage.getParticipantsUnion(
                block.coordinates,
                block.stateSnapshotHash
            );
            if (block.didEveryoneSign(participantsUnion)) {
                this.p2pEventHooks.onBlockFinalized?.();
            }
        } catch (error) {
            this.logger.debug("maybeNotifyBlockFinalized skipped", {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    public setStatus(status: Status) {
        this.logger.debug("Status changed", {
            oldStatus: Status[this.status] ?? `UNKNOWN(${this.status})`,
            newStatus: Status[status] ?? `UNKNOWN(${status})`
        });
        this.status = status;
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
    public setChannelId(channelId: ChannelId) {
        this.logger.verbose("Setting channel ID", { channelId });
        this.channelId = channelId;
        this.logger.updateSharedContext({ channelId: String(channelId) });
        this.stateChannelEventListener.setChannelId(channelId);
        this.disputeManager.setChannelId(channelId);
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

        // If existing timeout exists, only replace if new timeout is further in the future
        if (existingHandle) {
            if (existingHandle.triggerTimestamp > localTriggerTimestamp) {
                return;
            }
            if (
                existingHandle.triggerTimestamp == localTriggerTimestamp &&
                !isRescheduled
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
        await this.performReduction(forkId, genesisTimestamp);
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
            .reduceAndFinalize(
                disputes,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.inboundMessageBlocks,
                expectedReducedForkId,
                {
                    gasLimit: 10_000_000
                }
            )
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
            this.setGenesisState(
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

    private async tryExecuteFromQueue() {
        const nextBlockHeight = this.storage.blocks.getNextBlockHeight(
            this.forkId
        );
        const blockConfirmations = this.storage.queues.tryDequeue(
            this.forkId,
            nextBlockHeight
        );

        for (const blockConfirmation of blockConfirmations) {
            const shouldDisconnect = await this.onBlockConfirmation(
                blockConfirmation.blockConfirmationStruct
            );
            if (shouldDisconnect) break;
        }
    }

    public async setLatestState(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        await this.mutex.lock();
        try {
            const normalizedGenesisTimestamp = Number(stateSnapshot.timestamp);

            // Persist state snapshot (as a model)
            const latestSnapshot = StateSnapshot.from(stateSnapshot);
            this.storage.stateSnapshots.storeStateSnapshot(latestSnapshot);

            // Persist outbound message block if provided
            if (outboundMessageBlock) {
                this.storage.outboundMessages.store(outboundMessageBlock);
            }

            // Persist state machine state (keyed by snapshot hash when available)
            this.storage.stateMachineStates.storeStateMachineState(
                encodedState,
                {
                    hash: stateSnapshot.snapshotData.stateMachineStateHash
                }
            );

            // Update local EVM/state machine
            await this.diamondStateMachine.setState(encodedState);

            // Update the forkId to the new fork
            const forkId = stateSnapshot.forkId;
            this.forkId = forkId;

            const participants =
                await this.diamondStateMachine.getParticipants();
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
            this.p2pEventHooks.onTurn?.(
                nextToWrite,
                turnTime,
                this.timeConfig.agreementTime,
                this.timeConfig.chainFallbackTime
            );
        } finally {
            this.mutex.unlock();
        }
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

    // Passes the signedBlock through a verification pipeline and returns shouldDisconnect flag
    public onSignedBlock(signedBlock: SignedBlockStruct): Promise<boolean> {
        return this.onBlockConfirmation({
            signedBlock,
            signatures: []
        });
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
            skipMutex?: boolean;
        }
    ): Promise<boolean> {
        const strategy =
            options?.validationStrategy ||
            this.getStrategyByStatus(this.status);

        try {
            if (!options?.skipMutex) {
                await this.mutex.lock();
            }

            let validationResult: BlockValidationResult =
                BlockValidationResult.SUCCESS;

            const isAuthentic =
                await this.diamondStateMachine.localDiamondContract.isBlockAuthentic(
                    blockConfirmation.signedBlock
                );

            if (!isAuthentic) {
                validationResult =
                    await strategy.authenticateBlockFailed(blockConfirmation);

                this.logger.warn(
                    "onBlockConfirmation - authentication failed",
                    {
                        strategy: strategy.name,
                        validationResult:
                            BlockValidationResult[validationResult],
                        blockHash: ethers.keccak256(
                            blockConfirmation.signedBlock.encodedBlock
                        )
                    }
                );

                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            const block = Block.fromBlockConfirmation(
                blockConfirmation,
                options?.onChainTimestamp
            );

            validationResult =
                await this.validationService.validateBlockConfirmation(
                    block,
                    strategy,
                    options?.senderAddress
                );

            if (validationResult !== BlockValidationResult.SUCCESS) {
                // handle all non-success actions
                const keepConnection =
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
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
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
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            const {
                success,
                encodedState,
                successCallback,
                outboundMessages,
                participantsBefore
            } = await this.applyTransaction(block.tx);

            if (!success) {
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
                return await strategy.interpretFinalValidationResult(
                    validationResult
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
                    block.timestamp,
                    outboundMessages,
                    inboundMessageBlocks,
                    finalParticipants
                );

            if (stateSnapshot.hash !== block.stateSnapshotHash) {
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
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
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
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
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
            // success - no disconnect
            return true;
        } catch (error) {
            this.logger.error("onBlockConfirmation - error", {
                strategy: strategy.name,
                channelId: this.channelId,
                blockHash: ethers.keccak256(
                    blockConfirmation.signedBlock.encodedBlock
                ),
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        } finally {
            if (!options?.skipMutex) {
                this.mutex.unlock();
            }
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
            ` - txHeight: ${txHeight}` +
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
        await this.mutex.lock();
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
                .catch((error) => {
                    const custom = tryHandleEvmError(error, {
                        tx: transactionResponse!,
                        logger: this.logger,
                        signer: this.signer,
                        forkId
                    });
                    this.logger.error("Error posting state snapshot", {
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
            // Get the current on-chain snapshot first
            const currentOnChainSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);

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
                    fromBlockHash: latestLocalExitBlockHash,
                    toBlockHash: currentOnChainExitBlockHash
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

            // Build exit blocks
            const latestOutboundBlockHash =
                genesisSnapshot.snapshotData.latestOutboundMessageBlockHash;
            const currentOnChainOutboundBlockHash =
                currentOnChainSnapshot.snapshotData
                    .latestOutboundMessageBlockHash;
            const outboundMessageBlocks =
                this.storage.outboundMessages.getMessageBlocksInRange({
                    fromBlockHash: latestOutboundBlockHash,
                    toBlockHash: currentOnChainOutboundBlockHash
                });

            this.logger.debug(
                "prepareUpdateStateSnapshotFork - outbound message block range",
                {
                    forkId: currentForkId,
                    fromBlockHash: latestOutboundBlockHash,
                    toBlockHash: currentOnChainOutboundBlockHash,
                    blocksCount: outboundMessageBlocks.length
                }
            );

            if (genesisSnapshot.forkID !== this.forkId) {
                throw new Error(
                    `Fork mismatch: update will result in fork ${genesisSnapshot.forkID}, but target fork is ${this.forkId}.`
                );
            }

            const forkCalldata =
                this.stateChannelManagerContract.interface.encodeFunctionData(
                    "updateStateSnapshotFork",
                    [
                        this.channelId,
                        genesisSnapshot.toStruct(),
                        outboundMessageBlocks
                    ]
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
            const updatedPreviousBlock = await this.fetchUpdatedOnChainBlock(
                previousBlockOrSnapshot.block.forkId,
                previousBlockOrSnapshot.block.height,
                previousBlockOrSnapshot.block.author
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
        const updatedBlock = await this.fetchUpdatedOnChainBlock(
            forkId,
            blockHeight,
            participantAddress
        );
        if (updatedBlock?.onChainTimestamp) {
            return; // block found and accepted
        }
        // Check locally again - if fetchUpdatedOnChainBlock found a block -> local evm is synced
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

        if (Number(tx.header.timestamp) < previousTimestamp) {
            this.logger.verbose("Adjusting timestamp - was in the past", {
                forkId,
                txTimestamp: Number(tx.header.timestamp),
                previousTimestamp,
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
            fromBlockHash: latestStoredHash,
            toBlockHash: previousHash ?? ethers.ZeroHash
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
        // step 9 - potentially change status
        // TODO - quick hack to account for union - should at a status `PENDING_PARTICIPANT`, so we don't abort the channel when we commited on-chain and waiting for inclusion
        if (this.status === Status.SYNCED) {
            const participants =
                await this.diamondStateMachine.getParticipants();
            const isParticipant = participants.includes(this.signerAddress);
            if (isParticipant) this.setStatus(Status.PARTICIPATING);
        }
        // step 1 - Confirm and Gossip // TODO - quick hack - cleaner code later
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
        // always broadcast if participating // TODO - quick hack - cleaner code later
        if (
            this.status === Status.PARTICIPATING &&
            !(options?.strategy instanceof DisputeValidationStrategy)
        ) {
            this.p2pManager.remoteRpc.stateTransitionService
                .onBlockConfirmation(block.blockConfirmationStruct)
                .broadcast();
        }

        // step 2 - persist the block // TODO - quick hack - cleaner code later
        this.storage.blocks.storeBlock(block, {
            justPersist: options?.strategy instanceof DisputeValidationStrategy
        });
        this.maybeNotifyBlockFinalized(block);

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

        // step 7 - startMaybeExitOnChain
        await this.startMaybeExitOnChain(
            block,
            stateSnapshot,
            participantChanges,
            options?.outboundMessageBlock
        );

        // step 8 - success callback
        successCallback();

        // step 10 - Notify any event hooks
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        const turnTime = this.timeConfig.p2pTime;
        this.p2pEventHooks.onTurn?.(
            nextToWrite,
            turnTime,
            this.timeConfig.agreementTime,
            this.timeConfig.chainFallbackTime
        );

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
        this.timeoutManager.scheduleTask(
            () => this.tryExecuteFromQueue(),
            0,
            "tryExecuteFromQueue"
        );
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
            // TODO - think about this
            return;
        }

        this.timeoutManager.scheduleTask(
            () => {
                if (this.agreementManager.didEveryoneSignBlock(block)) {
                    // Update the snapshot with the BlockConfirmation proving the latest state to exit on-chain
                    // Todo
                    // https://trello.com/c/Nv7AGVyR
                } else {
                    // Failure: create a dispute with the BlockConfirmation set as the latest state
                    // and selfRemoval flag set to true
                    // Todo
                    // https://trello.com/c/qwpYPLj8
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

    async fetchBlockCommitmentCalldata(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address,
        blockCommitment: Hash,
        options?: {
            skipMutex?: boolean;
        }
    ): Promise<UpdatedBlockWithCalldata | undefined> {
        try {
            // filter BlockCalldataPosted calls by channelId and blockCalldataCommitment
            const filter =
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    this.channelId,
                    blockCommitment
                );

            // Calculate how many blocks back should we look for the log on-chain
            const latestBlock =
                await this.stateChannelManagerContract.runner?.provider?.getBlockNumber();
            if (!latestBlock) {
                const message =
                    "fetchBlockCommitmentCalldata - Unable to fetch latest block number from provider";
                this.logger.error(message);
                throw new Error(message);
            }
            const avgBlockTime = Clock.getAverageOnChainBlockTime();
            const maxTime =
                this.timeConfig.p2pTime +
                this.timeConfig.agreementTime +
                this.timeConfig.chainFallbackTime;
            const blocksToLookBack = Math.ceil(maxTime / avgBlockTime) * 2; // *2 to be safe and account for some delay/failure
            const fromBlock = Math.max(0, latestBlock - blocksToLookBack);

            const logs = await this.stateChannelManagerContract.queryFilter(
                filter,
                fromBlock, // from block
                "latest" // to block
            );

            // There should be a single log if the commitment exists or none
            if (logs.length == 0) {
                return undefined;
            }
            if (logs.length > 1) {
                throw new Error(
                    `Multiple logs found for commitment: ${blockCommitment} - logs: ${logs}`
                );
            }
            // Create a mutable copy of signedBlock since logs[0].args is read-only
            const signedBlock = {
                encodedBlock: logs[0].args.signedBlock.encodedBlock,
                signature: logs[0].args.signedBlock.signature
            };
            const timestamp = Number(logs[0].args.timestamp);

            await this.eventHandler.onBlockCalldataPosted(
                this.channelId,
                blockCommitment,
                blockAuthor,
                signedBlock,
                timestamp,
                {
                    skipMutex: options?.skipMutex
                }
            );

            const updatedBlock = this.storage.blocks.getBlock(
                forkId,
                blockHeight
            );

            return {
                signedBlock,
                timestamp,
                updatedBlock: updatedBlock
            };
        } catch (error) {
            this.logger.error(`Error fetchBlockCommitmentCalldata:`, { error });
            return undefined;
        }
    }

    async fetchUpdatedOnChainBlock(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address,
        options?: {
            skipMutex?: boolean;
        }
    ): Promise<Block | undefined> {
        try {
            const commitmentResult =
                await this.stateChannelManagerContract.getBlockCallDataCommitment(
                    this.channelId,
                    forkId,
                    blockHeight,
                    blockAuthor
                );
            if (!commitmentResult.found) {
                return undefined;
            }
            return (
                await this.fetchBlockCommitmentCalldata(
                    forkId,
                    blockHeight,
                    blockAuthor,
                    commitmentResult.blockCalldataCommitment,
                    options
                )
            )?.updatedBlock;
        } catch (error) {
            this.logger.error(`Error fetchUpdatedOnChainBlock:`, { error });
            return undefined;
        }
    }
}
export default StateManager;

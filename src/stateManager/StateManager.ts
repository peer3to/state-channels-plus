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
import { decodeCustomError } from "@/utils/evmErrorHandler";

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
    isCustomEvmError,
    difference,
    Logger,
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

import { DEBUG_STATE_MANAGER } from "@/utils/config";
import ATransport from "@/transport/ATransport";
import { TimeoutManager } from "@/utils/TimeoutManager";

const NULL = "0x00";
const LOG_TAG = "[STATE MANAGER]";

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
    self = DEBUG_STATE_MANAGER ? DebugProxy.createProxy(this) : this;
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
    status: Status = Status.SPECTATING;
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
        logger: Logger
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
            this.diamondStateMachine.localDiamondContract
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
        this.p2pManager = new P2PManager(this.self, signer);
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

        await Promise.all([
            this.timeoutManager.dispose(),
            this.stateChannelEventListener.dispose(),
            this.p2pManager.dispose()
        ]);
    }
    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pEventHooks = p2pEventHooks;
    }
    public setStatus(status: Status) {
        this.logger.debug("Status changed", {
            oldStatus: this.status,
            newStatus: status
        });
        this.status = status;
    }
    public getStatus(): Status {
        return this.status;
    }
    public setChannelId(channelId: ChannelId) {
        this.logger.verbose("Setting channel ID", { channelId });
        this.channelId = channelId;
        this.stateChannelEventListener.setChannelId(channelId);
        this.disputeManager.setChannelId(channelId);
    }
    public getChannelId(): ChannelId {
        return this.channelId;
    }
    public setReductionTimeout(
        forkId: ForkId,
        triggerTimestamp: Timestamp,
        isRescheduled: boolean = false
    ) {
        this.logger.debug(
            `setReductionTimeout called for fork ${forkId} at ${triggerTimestamp}`
        );
        if (this.forkId !== forkId) return;

        const existingHandle = this.reductionTriggerMap.get(forkId);
        const now = Clock.getTimeInSeconds();

        // If existing timeout exists, only replace if new timeout is further in the future
        if (existingHandle) {
            if (existingHandle.triggerTimestamp > triggerTimestamp) {
                return;
            }
            if (
                existingHandle.triggerTimestamp == triggerTimestamp &&
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
            Math.max(0, (triggerTimestamp - now) * 1000),
            `reduction-${forkId}`
        );

        this.reductionTriggerMap.set(forkId, {
            handle,
            triggerTimestamp
        });

        this.logger.debug(
            `Scheduled reduction timeout for fork ${forkId} at ${triggerTimestamp} (in ${triggerTimestamp - now}s)`
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
        const {
            isKillPeriodExpired: canReduceLocally,
            killPeriodEnd: killTimestamp
        } =
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
                    Number(killTimestamp),
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
            isKillPeriodExpired: canReduceOnChain,
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

        this.logger.debug(
            `On-chain Reduction check for fork ${forkId}: canReduce=${canReduceOnChain}, timeRemaining=${remaining}s`
        );

        if (!canReduceOnChain) {
            if (remaining > 0) {
                this.logger.debug(
                    `On-chain check: rescheduling in ${remaining}s`
                );
                return this.setReductionTimeout(
                    forkId,
                    Number(onChainKillTimestamp),
                    true
                );
            }
            throw new Error(
                `Cannot reduce fork ${forkId}: kill period not expired on-chain (timeRemaining=${remaining})`
            );
        }

        // Step 4: Perform reduction
        await this.performReduction(forkId, Number(onChainKillTimestamp));
    }

    private async performReduction(
        forkId: ForkId,
        genesisTimestamp: Timestamp
    ) {
        const disputes = await this.agreementManager.getForkDisputes(
            this.channelId,
            forkId,
            this.stateChannelManagerContract
        );

        const reducedOutput =
            await this.stateChannelManagerContract.reduce.staticCall(disputes);

        const reduceData = await this.agreementManager.getReduceData(
            forkId,
            reducedOutput
        );
        this.stateChannelManagerContract
            .reduceAndFinalize(
                disputes,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.inboundMessageBlocks
            )
            .then((tx) => tx.wait())
            .catch((error) => {
                try {
                    const decodedError = decodeCustomError(error.data)!;

                    if (decodedError.name === "ErrorDisputeAlreadyReduced") {
                        this.logger.debug(
                            `Reduction already completed by another peer: ${decodedError.name}`
                        );
                        return;
                    }
                    if (decodedError.name === "ErrorCantParticipateInDispute") {
                        this.logger.debug(
                            `Cannot participate in dispute: ${decodedError.name} (slashed on chain)`
                        );
                        return;
                    } else {
                        throw error;
                    }
                } catch (error) {
                    this.logger.error("Error decoding custom error", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    });
                    throw error;
                }
            });

        try {
            // Compute local state after reduction (optimistic - assume tx will succeed)
            const [
                snapshotData,
                encodedStateMachineState,
                outboundMessageBlock
            ] =
                await this.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                    forkId,
                    reducedOutput,
                    reduceData.latestStateSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.inboundMessageBlocks
                );

            const reducedForkId = ethers.keccak256(
                Codec.encode(snapshotData, Type.SnapshotData)
            );

            // Update local state to the reduced fork
            this.logger.debug(
                `Reduction complete: transitioning to fork ${reducedForkId}`
            );
            this.setGenesisState(
                snapshotData,
                encodedStateMachineState,
                reducedForkId,
                genesisTimestamp,
                outboundMessageBlock
            );
        } catch (error) {
            if (isCustomEvmError(error)) {
                this.logger.error(
                    "CustomError computing reduced snapshot data",
                    {
                        errorDescription: error.errorDescription
                    }
                );
            } else {
                this.logger.error("Error computing reduced snapshot data", {
                    error:
                        error instanceof Error ? error.message : String(error)
                });
            }
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

    public async setGenesisState(
        snapshotData: SnapshotDataStruct,
        encodedState: Bytes,
        forkId: ForkId,
        genesisTimestamp: Timestamp,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        const normalizedGenesisTimestamp = Number(genesisTimestamp);
        this.logger.verbose("Setting genesis state", {
            forkId,
            genesisTimestamp: normalizedGenesisTimestamp,
            participantCount: snapshotData.participants.length
        });

        // generate and store genesis snapshot
        const _genesisSnapshot: StateSnapshotStruct = {
            forkId,
            blockHeight: 0,
            timestamp: normalizedGenesisTimestamp,
            snapshotData: snapshotData
        };
        const genesisSnapshot = StateSnapshot.from(_genesisSnapshot);
        this.storage.stateSnapshots.storeStateSnapshot(genesisSnapshot);

        // store exit channel block
        // TODO - check if exists
        if (outboundMessageBlock)
            this.storage.outboundMessages.store(outboundMessageBlock);

        // store genesis state
        this.storage.stateMachineStates.storeStateMachineState(encodedState);

        await this.diamondStateMachine.setState(encodedState);
        // Update the forkId to the new fork
        this.forkId = forkId;

        const participants = await this.diamondStateMachine.getParticipants();
        const isParticipant = participants.includes(this.signerAddress);
        if (isParticipant) {
            this.setStatus(Status.PARTICIPATING);
        }

        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        this.p2pEventHooks.onTurn?.(nextToWrite);
        const nextTransactionCnt =
            this.storage.blocks.getNextBlockHeight(forkId);
        let timeLost = Clock.getTimeInSeconds() - normalizedGenesisTimestamp;
        timeLost = timeLost < 0 ? 0 : timeLost; // if genesisTimestamp is in the future - no time is lost

        this.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkId,
                    nextTransactionCnt,
                    nextToWrite
                ),
            (this.getTimeoutWaitTimeSeconds() - timeLost) * 1000,
            "participantTimeout"
        );

        this.timeoutManager.scheduleTask(
            () => this.tryExecuteFromQueue(),
            0,
            "queueProcessing"
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
            senderTransport?: ATransport;
        }
    ): Promise<boolean> {
        const strategy =
            options?.validationStrategy ||
            this.getStrategyByStatus(this.status);

        try {
            await this.mutex.lock();

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
                        status: this.status,
                        strategy: (strategy as any)?.constructor?.name,
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
                    options?.senderTransport
                );

            if (validationResult !== BlockValidationResult.SUCCESS) {
                // handle all non-success actions
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
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
                    status: this.status,
                    strategy: (strategy as any)?.constructor?.name,
                    block
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
                        status: this.status,
                        strategy: (strategy as any)?.constructor?.name,
                        block
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
            } = await this.applyTransaction(block.transaction);

            if (!success) {
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                this.logger.warn(
                    "onBlockConfirmation - state transition failed",
                    {
                        status: this.status,
                        strategy: (strategy as any)?.constructor?.name,
                        block
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

            const { stateSnapshot, outboundMessageBlock, totalWithdrawals } =
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
                        status: this.status,
                        strategy: (strategy as any)?.constructor?.name,
                        block
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
                totalWithdrawals,
                participantChanges,
                outboundMessageBlock
            );

            // success - no disconnect
            return true;
        } catch (error) {
            if (isCustomEvmError(error)) {
                this.logger.error("onBlockConfirmation - error", {
                    status: this.status,
                    strategy: (strategy as any)?.constructor?.name,
                    channelId: this.channelId,
                    blockHash: ethers.keccak256(
                        blockConfirmation.signedBlock.encodedBlock
                    ),
                    errorDescription: error.errorDescription,
                    errorName: error.name,
                    errorMessage: error.message
                });
            } else {
                this.logger.error("onBlockConfirmation - error", {
                    status: this.status,
                    strategy: (strategy as any)?.constructor?.name,
                    channelId: this.channelId,
                    blockHash: ethers.keccak256(
                        blockConfirmation.signedBlock.encodedBlock
                    ),
                    error:
                        error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                });
            }
            throw error;
        } finally {
            this.mutex.unlock();
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
            `playTransaction: ` +
            ` - myAddress: ${String(this.signerAddress)}` +
            ` - nextToWrite: ${String(nextToWrite)}` +
            ` - txHeight: ${txHeight}` +
            ` - latestStoredHeight: ${String(latestStoredHeight)}` +
            ` - nextStoredHeight: ${nextStoredHeight}` +
            ` - forkId: ${forkId}`;
        this.logger.info(message);
        return message;
    }

    // Used when authoring a block - Executes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<BlockConfirmationStruct> {
        await this.mutex.lock();
        const forkId = this.forkId;
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

            const { stateSnapshot, outboundMessageBlock, totalWithdrawals } =
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
                totalWithdrawals,
                participantChanges,
                outboundMessageBlock
            );

            return block.blockConfirmationStruct;
        } finally {
            this.mutex.unlock();
        }
    }

    private async maybePostBlockOnChain(blockHash: Hash): Promise<void> {
        // Retrieve the latest version of the block from storage (with all collected signatures)
        const block = this.storage.blocks.getBlock(blockHash);
        if (!block) {
            return;
        }
        // If not everyone has signed, do the on-chain post
        const participants = this.storage.getParticipants(block.coordinates);

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

            this.stateChannelManagerContract
                .postBlockCalldata(block.signedBlock, maxTimestamp)
                .then((txResponse) => txResponse.wait())
                .catch((error) => {
                    if (isCustomEvmError(error)) {
                        this.logger.warn("Error posting block on chain", {
                            errorDescription: error.errorDescription
                        });
                    } else {
                        this.logger.warn("Error posting block on chain", {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        });
                    }
                });
        }
    }

    public async postStateSnapshot(forkId: ForkId): Promise<void> {
        // Get the current on-chain snapshot to check if we're on the same fork
        const currentOnChainSnapshot = StateSnapshot.from(
            await this.stateChannelManagerContract.getStateSnapshot(
                this.channelId
            )
        );

        // If we're on the same fork, call updateStateSnapshotSameFork directly
        if (currentOnChainSnapshot.forkId === forkId) {
            const sameForkData =
                await this.prepareUpdateSnapshotSameFork(forkId);
            if (sameForkData) {
                try {
                    const txResponse =
                        await this.stateChannelManagerContract.updateStateSnapshotSameFork(
                            this.channelId,
                            sameForkData.milestoneProofs,
                            sameForkData.milestoneSnapshots.map((snapshot) =>
                                snapshot.toStruct()
                            ),
                            sameForkData.outboundMessageBlocks
                        );
                    await txResponse.wait();
                } catch (error) {
                    if (isCustomEvmError(error)) {
                        this.logger.error("Error posting state snapshot", {
                            errorDescription: error.errorDescription
                        });
                    } else {
                        this.logger.error("Error posting state snapshot", {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        });
                    }
                    throw error;
                }
            } else {
                this.logger.debug("No state snapshot updates needed");
            }
            return;
        }

        // Different fork - use multicall for both fork update and same-fork update
        const forkData = await this.prepareUpdateStateSnapshotFork();
        const sameForkData = await this.prepareUpdateSnapshotSameFork(forkId);

        // Encode data for multicall
        const callData: string[] = [];
        if (forkData) {
            // Check if the fork update will result in the same fork as the target
            if (forkData.genesisSnapshot.forkId === forkId) {
                const forkCalldata =
                    this.stateChannelManagerContract.interface.encodeFunctionData(
                        "updateStateSnapshotFork",
                        [
                            this.channelId,
                            forkData.genesisSnapshot.toStruct(),
                            forkData.outboundMessageBlocks
                        ]
                    );
                callData.push(forkCalldata);
            } else {
                // Fork update results in a different fork
                throw new Error(
                    `Fork mismatch: update will result in fork ${forkData.genesisSnapshot.forkId}, but target fork is ${forkId}.`
                );
            }
        }
        if (sameForkData) {
            const sameForkCalldata =
                this.stateChannelManagerContract.interface.encodeFunctionData(
                    "updateStateSnapshotSameFork",
                    [
                        this.channelId,
                        sameForkData.milestoneProofs,
                        sameForkData.milestoneSnapshots.map((snapshot) =>
                            snapshot.toStruct()
                        ),
                        sameForkData.outboundMessageBlocks
                    ]
                );
            callData.push(sameForkCalldata);
        }

        // Execute the final snapshot updates in a single multicall transaction
        if (callData.length > 0) {
            try {
                const txResponse =
                    await this.stateChannelManagerContract.multicall(callData);
                await txResponse.wait();
            } catch (error) {
                if (isCustomEvmError(error)) {
                    this.logger.error("Error posting state snapshot", {
                        errorDescription: error.errorDescription
                    });
                } else {
                    this.logger.error("Error posting state snapshot", {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    });
                }
                throw error;
            }
        } else {
            this.logger.debug("No state snapshot updates needed");
        }
    }

    /**
     * Prepares data for updating the state snapshot when the fork is the same
     */
    public async prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              milestoneProofs: MilestoneProofStruct[];
              milestoneSnapshots: StateSnapshot[];
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

                // Only include milestones that are newer than the current on-chain block height
                if (snapshot.blockHeight > currentOnChainSnapshot.blockHeight) {
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
            if (
                latestSnapshot.blockHeight ===
                currentOnChainSnapshot.blockHeight
            ) {
                return undefined;
            }

            // Verify that both snapshots belong to the same fork
            if (currentOnChainSnapshot.forkId !== latestSnapshot.forkId) {
                throw new Error(
                    `Fork mismatch: current fork ${currentOnChainSnapshot.forkId}, new fork ${latestSnapshot.forkId}`
                );
            }

            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData
                    .latestOutboundMessageBlockHash;
            const latestLocalExitBlockHash =
                latestSnapshot.snapshotData.latestOutboundMessageBlockHash;
            const outboundMessageBlocks =
                this.storage.outboundMessages.getMessageBlocksInRange(
                    latestLocalExitBlockHash,
                    currentOnChainExitBlockHash
                );

            return {
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
              genesisSnapshot: StateSnapshot;
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

            let currentForkId = currentOnChainSnapshot.forkId;

            // Traverse through dispute windows until we reach a fork with no disputes
            let isDisputed =
                await this.stateChannelManagerContract.isForkDisputed(
                    this.channelId,
                    currentForkId
                );

            if (!isDisputed) {
                return undefined; // No fork update needed
            }

            while (isDisputed) {
                // If reduced result already exists on-chain, traverse to it
                const existingReducedResult =
                    await this.stateChannelManagerContract.getReducedResult(
                        this.channelId,
                        currentForkId
                    );
                // if reduceResult exists and is final
                if (existingReducedResult[0]) {
                    currentForkId = existingReducedResult[0];
                    isDisputed =
                        await this.stateChannelManagerContract.isForkDisputed(
                            this.channelId,
                            currentForkId
                        );
                    continue;
                }

                // Fetch dispute commitments for this window
                const disputeCommitments =
                    await this.stateChannelManagerContract.getWindowCommitments(
                        this.channelId,
                        currentForkId
                    );
                if (!disputeCommitments || disputeCommitments.length === 0) {
                    // Nothing to reduce; wait for more data
                    break;
                }

                // Build disputes from local storage confirmations
                const disputes: DisputeStruct[] = disputeCommitments.map(
                    (commitment) => {
                        const dispute =
                            this.storage.disputes.getDispute(commitment);
                        if (!dispute) {
                            throw new Error(
                                `Missing Data Availability for dispute commitment ${commitment}`
                            );
                        }
                        return dispute;
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

                // Reduce and finalize on-chain to obtain the reduced fork id
                try {
                    const txResponse =
                        await this.stateChannelManagerContract.reduceAndFinalize(
                            disputes,
                            reduceData.latestStateSnapshot,
                            reduceData.encodedStateMachineState,
                            reduceData.inboundMessageBlocks
                        );
                    await txResponse.wait();
                } catch (error) {
                    if (
                        isCustomEvmError(error) &&
                        error.errorDescription.name !==
                            "ErrorDisputeAlreadyReduced"
                    ) {
                        throw error; // Re-throw other errors
                    }
                }

                // Read canonical reduced result from chain and traverse
                const reducedResult =
                    await this.stateChannelManagerContract.getReducedResult(
                        this.channelId,
                        currentForkId
                    );

                // Traverse to the reduced fork
                currentForkId = reducedResult[0];
                isDisputed =
                    await this.stateChannelManagerContract.isForkDisputed(
                        this.channelId,
                        currentForkId
                    );
            }

            // Get the genesis snapshot for the final resolved fork
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
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
                this.storage.outboundMessages.getMessageBlocksInRange(
                    latestOutboundBlockHash,
                    currentOnChainOutboundBlockHash
                );

            return {
                genesisSnapshot,
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
        let difference =
            previousRelevantTimestamp +
            this.getTimeoutWaitTimeSeconds() -
            Clock.getTimeInSeconds();
        if (difference > 0) {
            this.timeoutManager.scheduleTask(
                async () => {
                    await this.tryTimeoutParticipant(
                        forkId,
                        blockHeight,
                        participantAddress
                    );
                },
                difference * 1000,
                "timeoutParticipantDelayed"
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
                    this.timeoutManager.scheduleTask(
                        async () => {
                            await this.tryTimeoutParticipant(
                                forkId,
                                blockHeight,
                                participantAddress
                            );
                        },
                        difference * 1000,
                        "timeoutParticipantDelayed"
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
        const latestBlock = this.storage.blocks.getLatestBlock(this.forkId);

        let previousTimestamp: Timestamp;

        if (!latestBlock) {
            // No blocks yet - check against genesis snapshot timestamp
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    this.forkId
                );
            if (!genesisSnapshot) {
                return; // No genesis snapshot yet, nothing to adjust against
            }
            previousTimestamp = genesisSnapshot.timestamp;
        } else {
            previousTimestamp = latestBlock.timestamp;
        }

        if (Number(tx.header.timestamp) <= previousTimestamp) {
            tx.header.timestamp = BigInt(previousTimestamp);
        }

        if (
            Number(tx.header.timestamp) >
            previousTimestamp + this.timeConfig.p2pTime
        ) {
            tx.header.timestamp = BigInt(
                previousTimestamp + this.timeConfig.p2pTime
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
        totalWithdrawals: BalanceStruct;
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

        return {
            stateSnapshot: StateSnapshot.from(stateSnapshot),
            outboundMessageBlock,
            totalWithdrawals
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

        return this.storage.inboundMessages.getMessageBlocksInRange(
            latestStoredHash,
            previousHash ?? ethers.ZeroHash
        );
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
            for (const message of messageBlock.messages) {
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
        totalWithdrawals: BalanceStruct,
        participantChanges: ParticipantChanges,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        // step 1 - Confirm and Gossip
        if (await this.shouldSignBlock(block)) {
            // Sign the block and add our signature to confirmation signatures
            const signature = await block.sign(this.signer);
            block.expandSignatures([signature]);
        }
        // always broadcast
        this.p2pManager.remoteRpc.stateTransitionService
            .onBlockConfirmation(block.blockConfirmationStruct)
            .broadcast();

        // step 2 - persist the block
        this.storage.blocks.storeBlock(block);

        // step 3 - persist the state snapshot
        this.storage.stateSnapshots.storeStateSnapshot(stateSnapshot);

        // step 4 - persist state machine state
        this.storage.stateMachineStates.storeStateMachineState(
            encodedStateMachineState,
            { hash: stateSnapshot.stateMachineStateHash }
        );

        // step 5 - persist the outbound message blocks if any
        if (outboundMessageBlock) {
            this.storage.outboundMessages.store(outboundMessageBlock);
        }

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
            outboundMessageBlock
        );

        // step 8 - success callback
        successCallback();
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        // step 9 - Notify any event hooks
        this.p2pEventHooks.onTurn?.(nextToWrite);

        // step 10 - maybe post block on chain
        if (block.author === this.signerAddress) {
            this.timeoutManager.scheduleTask(
                () => {
                    this.maybePostBlockOnChain(block.hash);
                },
                this.timeConfig.agreementTime * 1000,
                "maybePostBlockOnChain"
            );
        }

        // step 11 - schedule a timeout check for the next participant

        this.timeoutManager.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    block.forkId,
                    block.height + 1, // Check for the next block that the participant should create
                    nextToWrite
                ),
            this.getTimeoutWaitTimeSeconds() * 1000,
            "participantTimeout"
        );
        // step 12 - try execute from queue
        this.timeoutManager.scheduleTask(
            () => this.tryExecuteFromQueue(),
            0,
            "queueProcessing"
        );
    }

    public async shouldSignBlock(block: Block): Promise<boolean> {
        if (this.p2pManager.isBlacklisted(block.author)) return false;

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
            "MaybeExitOnChain"
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
        switch (status) {
            case Status.SPECTATING:
                return this.spectatingValidationStrategy;
            case Status.PARTICIPATING:
                return this.blockValidationStrategy;
            default:
                throw new Error("Strategy must be explicit");
        }
    }

    async fetchBlockCommitmentCalldata(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address,
        blockCommitment: Hash
    ): Promise<UpdatedBlockWithCalldata | undefined> {
        try {
            // filter BlockCalldataPosted calls by channelId and blockCalldataCommitment
            const filter =
                this.stateChannelManagerContract.filters.BlockCalldataPosted(
                    this.channelId,
                    blockCommitment
                );

            // Calculate how many blocks back should we look for the log on-chain
            const avgBlockTime = Clock.getAverageOnChainBlockTime();
            const maxTime =
                this.timeConfig.p2pTime +
                this.timeConfig.agreementTime +
                this.timeConfig.chainFallbackTime;
            const blocksToLookBack = Math.ceil(maxTime / avgBlockTime) * 2; // *2 to be safe and account for some delay/failure

            const logs = await this.stateChannelManagerContract.queryFilter(
                filter,
                -blocksToLookBack, // from block
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

            // this will also run BlockConfirmation pipeline which will also handle storage updates if needed
            await this.eventHandler.onBlockCalldataPosted(
                this.channelId,
                blockCommitment,
                blockAuthor,
                signedBlock,
                timestamp
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
            console.error(`${LOG_TAG}-fetchBlockCommitmentCalldata:`, error);
            return undefined;
        }
    }

    async fetchUpdatedOnChainBlock(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
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
                    commitmentResult.blockCalldataCommitment
                )
            )?.updatedBlock;
        } catch (error) {
            console.error(`${LOG_TAG}-fetchUpdatedOnChainBlock:`, error);
            return undefined;
        }
    }
}
export default StateManager;

// External libraries
import { ethers } from "ethers";

// TypeChain types - Data types
import {
    TransactionStruct,
    SignedBlockStruct,
    ExitChannelBlockStruct,
    ExitChannelStruct,
    JoinChannelBlockStruct,
    BalanceStruct,
    StateSnapshotStruct,
    BlockConfirmationStruct,
    BlockStruct,
    SnapshotDataStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

// TypeChain types - Dispute types
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

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
    Logger
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
import ReductionController from "./services/ReductionController";
import SnapshotService, {
    SameForkSnapshotData,
    SnapshotForkData
} from "./services/SnapshotService";
import TimeoutController from "./services/TimeoutController";
import StateSnapshotFactory from "./services/StateSnapshotFactory";

import { DEBUG_STATE_MANAGER } from "@/utils/config";
import { TimeoutManager } from "@/utils/TimeoutManager";

const NULL = "0x00";
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
    readonly logger: Logger;
    private readonly reductionController: ReductionController;
    private readonly snapshotService: SnapshotService;
    private readonly timeoutController: TimeoutController;
    private readonly snapshotFactory: StateSnapshotFactory;

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        logger: Logger
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.diamondStateMachine = diamondStateMachine;
        this.p2pEventHooks = p2pEventHooks;
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.storage = new Storage();

        this.logger = logger.child({ component: "StateManager" });

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
        this.agreementManager = new AgreementManager(this.storage);
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
        this.fraudProofService = new FraudProofService(this.storage);
        this.validationService = new ValidationService(
            this.storage,
            this.diamondStateMachine,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.self
        );
        this.disputeValidationService = new DisputeValidationService(
            this.storage,
            this.diamondStateMachine,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.disputeManager,
            this.agreementManager
        );
        this.blockValidationStrategy = new BlockValidationStrategy(
            this.storage,
            this.p2pManager,
            this.disputeManager
        );
        this.spectatingValidationStrategy = new SpectatingValidationStrategy(
            this.storage,
            this.p2pManager
        );
        this.timeoutManager = new TimeoutManager();
        this.reductionController = new ReductionController(this);
        this.snapshotService = new SnapshotService(this);
        this.timeoutController = new TimeoutController(this);
        this.snapshotFactory = new StateSnapshotFactory(this);
    }
    //Mark resources for garbage collection
    public async dispose() {
        this.isDisposed = true;
        // Cancel all scheduled tasks
        this.timeoutManager.dispose();
        // Clear reduction timeouts
        for (const [_, reductionHandle] of this.reductionTriggerMap) {
            clearTimeout(reductionHandle.handle);
        }
        this.reductionTriggerMap.clear();
        this.stateChannelEventListener.dispose();
        await this.p2pManager.dispose();
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
    public setChannelId(channelId: ChannelId) {
        this.logger.verbose("Setting channel ID", { channelId });
        this.channelId = channelId;
        this.stateChannelEventListener.setChannelId(channelId);
        this.disputeManager.setChannelId(channelId);
    }
    public getChannelId(): ChannelId {
        return this.channelId;
    }
    public setReductionTimeout(forkId: ForkId, triggerTimestamp: number) {
        this.reductionController.setReductionTimeout(forkId, triggerTimestamp);
    }
    private async tryReduce(forkId: ForkId, genesisTimestamp: number) {
        await this.reductionController.tryReduce(forkId, genesisTimestamp);
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
    public async onJoinChannel(
        joinChannelBlock: JoinChannelBlockStruct,
        _timestamp: Timestamp,
        totalDeposits: BalanceStruct
    ) {
        this.storage.joinChannelBlocks.storeJoinChannelBlock(
            joinChannelBlock,
            totalDeposits
        );
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
        exitChannelBlock?: ExitChannelBlockStruct
    ): Promise<void> {
        this.logger.verbose("Setting genesis state", {
            forkId,
            genesisTimestamp,
            participantCount: snapshotData.participants.length
        });

        // generate and store genesis snapshot
        const _genesisSnapshot: StateSnapshotStruct = {
            forkId,
            blockHeight: 0,
            timestamp: genesisTimestamp,
            snapshotData: snapshotData
        };
        const genesisSnapshot = StateSnapshot.from(_genesisSnapshot);
        this.storage.stateSnapshots.storeStateSnapshot(genesisSnapshot);

        // store exit channel block
        // TODO - check if exists
        if (exitChannelBlock)
            this.storage.exitChannelBlocks.storeExitChannelBlock(
                exitChannelBlock
            );

        // store genesis state
        this.storage.stateMachineStates.storeStateMachineState(encodedState);

        await this.diamondStateMachine.setState(encodedState);
        // Update the forkId to the new fork
        this.forkId = forkId;
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        this.p2pEventHooks.onTurn?.(nextToWrite);
        const nextTransactionCnt =
            this.storage.blocks.getNextBlockHeight(forkId);
        let timeLost = Clock.getTimeInSeconds() - genesisTimestamp;
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

        // arrow function preserves "this", which is the StateManager instance
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
        onChainTimestamp?: Timestamp,
        validationStrategy?: AValidationStrategy
    ): Promise<boolean> {
        // the try/catch is to ensure that the mutex is unlocked in case of an error
        // no error is actually expected to happen, and the catch block just re-throws the error
        const strategy =
            validationStrategy || this.getStrategyByStatus(this.status);
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
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            const block = Block.fromBlockConfirmation(
                blockConfirmation,
                onChainTimestamp
            );

            validationResult =
                await this.validationService.validateBlockConfirmation(
                    block,
                    strategy
                );

            if (validationResult !== BlockValidationResult.SUCCESS) {
                // handle all non-success actions
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            // SUCCESS, continue with state transition validation

            const {
                success,
                encodedState,
                successCallback,
                exitChannels,
                leftParticipants
            } = await this.applyTransaction(block.transaction);

            if (!success) {
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            // Validate state snapshot hash
            const { stateSnapshot, exitChannelBlock, totalWithdrawals } =
                await this.createStateSnapshotBlock(
                    hash(encodedState),
                    block.coordinates,
                    block.timestamp,
                    exitChannels
                );

            if (stateSnapshot.hash !== block.stateSnapshotHash) {
                validationResult =
                    await strategy.invalidStateTransitionDetected(block);
                return await strategy.interpretFinalValidationResult(
                    validationResult
                );
            }

            // TODO - apply strategy here too
            // All validations passed - proceed with success action
            this.success(
                block,
                stateSnapshot,
                encodedState,
                successCallback,
                totalWithdrawals,
                leftParticipants,
                exitChannelBlock
            );

            // success - no disconnect
            return true;
        } finally {
            this.mutex.unlock();
        }
    }

    //Applies a transaction to the state machine and returns the encoded state with a success callback
    public async applyTransaction(transaction: TransactionStruct): Promise<{
        success: boolean;
        encodedState: Bytes;
        successCallback: () => void;
        exitChannels: ExitChannelStruct[];
        leftParticipants: Set<Address>;
    }> {
        const previousParticipants =
            await this.diamondStateMachine.getParticipants();
        const { success, successCallback, exitChannels } =
            await this.diamondStateMachine.stateTransition(transaction);
        const encodedState = await this.diamondStateMachine.getState();
        const currentParticipants =
            await this.diamondStateMachine.getParticipants();

        const leftParticipants = difference(
            new Set(previousParticipants),
            new Set(currentParticipants)
        );

        return {
            success,
            encodedState,
            successCallback,
            exitChannels,
            leftParticipants
        };
    }

    // Used when authoring a block - Executes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<BlockConfirmationStruct> {
        await this.mutex.lock();

        try {
            if (!this.validationService.isChannelOpen(this.forkId)) {
                throw new Error("Channel not open");
            }
            if (!(await this.isMyTurn())) {
                throw new Error(
                    `Not player turn - myAddress: ${String(this.signerAddress)} - nextToWrite: ${await this.diamondStateMachine.getNextToWrite()}`
                );
            }
            this.adjustTimestampIfNeeded(tx);

            const {
                success,
                encodedState,
                successCallback,
                exitChannels,
                leftParticipants
            } = await this.applyTransaction(tx);

            if (!success) {
                throw new Error(
                    "CreateAndApplyTransaction - Internal error - Transaction not successful"
                );
            }

            const { stateSnapshot, exitChannelBlock, totalWithdrawals } =
                await this.createStateSnapshotBlock(
                    hash(encodedState),
                    {
                        forkId: this.forkId,
                        height: Number(tx.header.transactionCnt)
                    },
                    Number(tx.header.timestamp),
                    exitChannels
                );

            const blockStruct = await this.createBlock(tx, stateSnapshot.hash);

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
                encodedState,
                successCallback,
                totalWithdrawals,
                leftParticipants,
                exitChannelBlock
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
        await this.snapshotService.postStateSnapshot(forkId);
    }

    /**
     * Prepares data for updating the state snapshot when the fork is the same
     */
    public async prepareUpdateSnapshotSameFork(
        forkId: ForkId
    ): Promise<SameForkSnapshotData | undefined> {
        return this.snapshotService.prepareUpdateSnapshotSameFork(forkId);
    }

    public async prepareUpdateStateSnapshotFork(): Promise<
        SnapshotForkData | undefined
    > {
        return this.snapshotService.prepareUpdateStateSnapshotFork();
    }

    // Tries to timeout a participant by checking did the participant fail to transition the state within time - if successful -> creates a dispute
    private async tryTimeoutParticipant(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address
    ): Promise<void> {
        await this.timeoutController.tryTimeoutParticipant(
            forkId,
            blockHeight,
            participantAddress
        );
    }

    private getTimeoutWaitTimeSeconds() {
        return this.timeoutController.getTimeoutWaitTimeSeconds();
    }

    private async isMyTurn(): Promise<boolean> {
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
    }

    private async createStateSnapshotBlock(
        stateMachineStateHash: Hash,
        coordinates: BlockCoordinates,
        timestamp: Timestamp,
        exitChannels?: ExitChannelStruct[]
    ): Promise<{
        stateSnapshot: StateSnapshot;
        exitChannelBlock?: ExitChannelBlockStruct;
        totalWithdrawals: BalanceStruct;
    }> {
        return this.snapshotFactory.createStateSnapshotBlock(
            stateMachineStateHash,
            coordinates,
            timestamp,
            exitChannels
        );
    }

    private async createBlock(
        tx: TransactionStruct,
        stateSnapshotHash: Hash
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

        const blockStruct: BlockStruct = {
            transaction: tx,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousHash
        };

        return blockStruct;
    }

    // ─────────────────────── ACTION HANDLERS ───────────────────────
    private async success(
        block: Block,
        stateSnapshot: StateSnapshot,
        encodedStateMachineState: Bytes,
        successCallback: () => void,
        totalWithdrawals: BalanceStruct,
        leftParticipants: Set<Address>,
        exitChannelBlock?: ExitChannelBlockStruct
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

        // step 5 - persist the exit channel blocks if any
        if (exitChannelBlock) {
            this.storage.exitChannelBlocks.storeExitChannelBlock(
                exitChannelBlock,
                totalWithdrawals
            );
        }

        // step 6 - persist exit points
        if (leftParticipants.size > 0) {
            this.storage.exitPoints.storeExitPoint(block.forkId, block.height);
        }

        // step 7 - startMaybeExitOnChain
        await this.startMaybeExitOnChain(
            block,
            stateSnapshot,
            leftParticipants,
            exitChannelBlock
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

    private async shouldSignBlock(block: Block): Promise<boolean> {
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
        leftParticipants: Set<Address>,
        _exitChannelBlock?: ExitChannelBlockStruct
    ): Promise<void> {
        if (!leftParticipants.has(this.signerAddress)) {
            // I didn't exit, nothing to do
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

    // ----- Event handlers -----
    public async onDisputeCommitted(
        dispute: DisputeStruct,
        timestamp: Timestamp
    ) {
        throw new Error("TODO - Not implemented");
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
        return this.timeoutController.fetchBlockCommitmentCalldata(
            forkId,
            blockHeight,
            blockAuthor,
            blockCommitment
        );
    }

    async fetchUpdatedOnChainBlock(
        forkId: ForkId,
        blockHeight: BlockHeight,
        blockAuthor: Address
    ): Promise<Block | undefined> {
        return this.timeoutController.fetchUpdatedOnChainBlock(
            forkId,
            blockHeight,
            blockAuthor
        );
    }
}
export default StateManager;

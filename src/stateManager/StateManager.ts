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
    BlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

// TypeChain types - Proof types
import { MilestoneProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

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
    scheduleTask,
    Codec,
    Type,
    hash,
    isCustomEvmError,
    decodeErrorProxy,
    difference
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
    Timestamp
} from "@/types/types";

import FraudProofService from "./utils/FraudProofService";
import DisputeValidationService from "./DisputeValidationService";
import AValidationStrategy from "./validationStrategy/AValidationStrategy";
import BlockValidationStrategy from "./validationStrategy/BlockValidationStrategy";
import SpectatingValidationStrategy from "./validationStrategy/SpectatingValidationStrategy";
import { time } from "console";
import { ReduceOutputStruct } from "@typechain-types/contracts/V1/StateChannelManagerInterface";
import { SnapshotDataStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

const DEBUG_STATE_MANAGER = false;

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
    blockValidationStrategy: AValidationStrategy;
    spectatingValidationStrategy: SpectatingValidationStrategy;
    eventHandler: EventHandler;
    reductionTriggerMap: Map<ForkId, ReductionTimeoutHandle> = new Map();
    status: Status = Status.SPECTATING;

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage
    ) {
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.diamondStateMachine = diamondStateMachine;
        this.p2pEventHooks = p2pEventHooks;
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = decodeErrorProxy(
            stateChannelManagerContract
        );
        this.storage = storage;
        this.eventHandler = new EventHandler(
            this.storage,
            this.self,
            this.p2pEventHooks,
            this.diamondStateMachine
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
            this.diamondStateMachine
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
    }
    //Mark resources for garbage collection
    public async dispose() {
        this.isDisposed = true;
        this.stateChannelEventListener.dispose();
        await this.p2pManager.dispose();
    }
    public setP2pEventHooks(p2pEventHooks: P2pEventHooks) {
        this.p2pEventHooks = p2pEventHooks;
    }
    public setStatus(status: Status) {
        this.status = status;
    }
    public setChannelId(channelId: ChannelId) {
        this.channelId = channelId;
        this.stateChannelEventListener.setChannelId(channelId);
    }
    public getChannelId(): ChannelId {
        return this.channelId;
    }
    public setReductionTimeout(forkId: ForkId, triggerTimestamp: number) {
        const reductionHandle = this.reductionTriggerMap.get(forkId);
        if (
            this.forkId == forkId &&
            (!reductionHandle ||
                reductionHandle.triggerTimestamp < triggerTimestamp)
        ) {
            if (reductionHandle) clearTimeout(reductionHandle.handle);
            const delayInMilliseconds =
                (triggerTimestamp - Clock.getTimeInSeconds()) * 1000;
            const newHandle = setTimeout(async () => {
                this.tryReduce(forkId, triggerTimestamp);
            }, delayInMilliseconds);
            this.reductionTriggerMap.set(forkId, {
                handle: newHandle,
                triggerTimestamp: triggerTimestamp
            });
        }
    }
    private async tryReduce(forkId: ForkId, genesisTimestamp: number) {
        if (this.forkId != forkId) return; // we're not on this fork anymore
        // check locally can we reduce
        let [canReduce, _timeRemainig] =
            await this.diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                this.channelId,
                forkId
            );
        let timeRemainig = Number(_timeRemainig);
        let checkedOnRpcNode = false;
        if (!canReduce) {
            // come back later - new evidence was submitted
            if (timeRemainig > 0)
                return this.setReductionTimeout(
                    forkId,
                    Clock.getTimeInSeconds() + timeRemainig
                );
            // timeRemainig is 0, but not expired -> means window locally is not opened (not synced) -> check on-chain
            [canReduce, _timeRemainig] =
                await this.stateChannelManagerContract.isKillPeriodExpired(
                    this.channelId,
                    forkId
                );
            checkedOnRpcNode = true;
            timeRemainig = Number(_timeRemainig);
            // now check with updated data
            if (!canReduce) {
                if (timeRemainig > 0)
                    return this.setReductionTimeout(
                        forkId,
                        Clock.getTimeInSeconds() + timeRemainig
                    );
                // on-chain timeRemainig is 0, but not expired -> not opened -> we shouldn't be here
                throw new Error(
                    "StateManager - setReductionTimeout - time to reduce, but window not opened on-chain"
                );
            }
        }
        // ^ the above code is an optimization to try to save compute on the RPC node

        // double check on-chain can we reduce
        if (!checkedOnRpcNode) {
            [canReduce, _timeRemainig] =
                await this.stateChannelManagerContract.isKillPeriodExpired(
                    this.channelId,
                    forkId
                );
            checkedOnRpcNode = true;
            timeRemainig = Number(_timeRemainig);
            if (!canReduce) {
                if (timeRemainig > 0)
                    return this.setReductionTimeout(
                        forkId,
                        Clock.getTimeInSeconds() + timeRemainig
                    );
                // on-chain timeRemainig is 0, but not expired -> not opened -> we shouldn't be here
                throw new Error(
                    "StateManager - setReductionTimeout - time to reduce, but window not opened on-chain"
                );
            }
        }
        // reduce on-chain
        const disputeConfirmations =
            await this.agreementManager.getForkDisputeConfirmations(
                this.channelId,
                forkId,
                this.stateChannelManagerContract
            );
        const disputes = disputeConfirmations.map(
            (dc) =>
                Codec.decode(
                    dc.signedDispute.encodedDispute,
                    Type.Dispute
                ) as DisputeStruct
        );
        let reducedOutput: ReduceOutputStruct;
        try {
            reducedOutput =
                await this.stateChannelManagerContract.reduce.staticCall(
                    disputes
                );
        } catch (error) {
            // this should never be the case since:
            // 1) disputeWindows is expired - double checked on-chain
            // 2) dispute commitments - collected on-chain -> we for sure have the correct data
            // 3) even if someone else reduces on-chain -> they would have to reduce to the same output, so race condition is not a problem
            console.error("StateManager - tryReduce - reduce error: ", error);
            throw error;
        }
        const reduceData = await this.agreementManager.getReduceData(
            forkId,
            reducedOutput
        );
        this.stateChannelManagerContract
            .reduceAndFinalize(
                disputes,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.joinChannelBlocks
            )
            .then((tx) => tx.wait())
            .catch((error) => {
                // this has to run async so everyone starts building imediately after successful simulation -> so they don't waste time
                // if this errors here - in the honest case it should never - even under race condition it should success fracefully
                // TODO interpret the error and panic
                throw new Error("reduceAndFinalize error " + error);
            });

        // if we're here - the fork SHOULD BECOME succesfuly finalized on-chain and we can start building on top of it

        // locally compute what will be finalized on-chain
        const [snapshotData, encodedStateMachineState, exitChannelBlock] =
            await this.diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                forkId,
                reducedOutput,
                reduceData.latestStateSnapshot,
                reduceData.encodedStateMachineState,
                reduceData.joinChannelBlocks
            );
        const reducedForkId = ethers.keccak256(
            Codec.encode(snapshotData, Type.SnapshotData)
        );

        this.setGenesisState(
            snapshotData,
            encodedStateMachineState,
            reducedForkId,
            genesisTimestamp,
            exitChannelBlock
        );
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
        _forkId: ForkId,
        genesisTimestamp: Timestamp,
        exitChannelBlock?: ExitChannelBlockStruct
    ): Promise<void> {
        console.log("StateManager - SetState", _forkId, genesisTimestamp);
        // generate and store genesis snapshot
        const _genesisSnapshot: StateSnapshotStruct = {
            forkId: _forkId,
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
        this.forkId = _forkId;
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        this.p2pEventHooks.onTurn?.(nextToWrite);
        const nextTransactionCnt =
            this.storage.blocks.getNextBlockHeight(_forkId);
        let timeLost = Clock.getTimeInSeconds() - genesisTimestamp;
        timeLost = timeLost < 0 ? 0 : timeLost; // if genesisTimestamp is in the future - no time is lost
        scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    _forkId,
                    nextTransactionCnt,
                    nextToWrite
                ),
            (this.getTimeoutWaitTimeSeconds() - timeLost) * 1000,
            "participantTimeout"
        );

        // arrow function preserves "this", which is the StateManager instance
        scheduleTask(() => this.tryExecuteFromQueue(), 0, "queueProcessing");
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
                await this.createStateSnapshot(
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

            if (hash(encodedState) === stateSnapshot.stateMachineStateHash) {
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
            console.log("Play Transaction", this.forkId);
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
                await this.createStateSnapshot(
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

    private async maybePostBlockOnChain(block: Block): Promise<void> {
        // If not everyone has signed, do the on-chain post
        const participants = this.storage.getParticipants(block.coordinates);

        if (!block.didEveryoneSign(participants)) {
            console.log("Posting calldata on chain!");
            this.p2pEventHooks.onPostingCalldata?.();

            this.stateChannelManagerContract
                .postBlockCalldata(block.signedBlock, Clock.getTimeInSeconds())
                .then((txResponse) => txResponse.wait())
                .catch((error) => {
                    if (isCustomEvmError(error)) {
                        console.log(
                            "Error posting block on chain",
                            error.errorDescription
                        );
                    } else {
                        console.log("Error posting block on chain", error);
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
                            sameForkData.exitChannelBlocks
                        );
                    await txResponse.wait();
                    console.log("Successfully posted state snapshot");
                } catch (error) {
                    if (isCustomEvmError(error)) {
                        console.error(
                            "Error posting state snapshot:",
                            error.errorDescription
                        );
                    } else {
                        console.error("Error posting state snapshot:", error);
                    }
                    throw error;
                }
            } else {
                console.log("No state snapshot updates needed");
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
                            forkData.exitBlocks
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
                        sameForkData.exitChannelBlocks
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
                console.log("Successfully posted state snapshot");
            } catch (error) {
                if (isCustomEvmError(error)) {
                    console.error(
                        "Error posting state snapshot:",
                        error.errorDescription
                    );
                } else {
                    console.error("Error posting state snapshot:", error);
                }
                throw error;
            }
        } else {
            console.log("No state snapshot updates needed");
        }
    }

    /**
     * Prepares data for updating the state snapshot when the fork is the same
     */
    public async prepareUpdateSnapshotSameFork(forkId: ForkId): Promise<
        | {
              milestoneProofs: MilestoneProofStruct[];
              milestoneSnapshots: StateSnapshot[];
              exitChannelBlocks: ExitChannelBlockStruct[];
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
                console.log(
                    "No relevant milestones found - state is already up to date"
                );
                return undefined;
            }

            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];

            // Latest snapshot is the same as current on-chain
            if (
                latestSnapshot.blockHeight ===
                currentOnChainSnapshot.blockHeight
            ) {
                console.log("State is already up to date");
                return undefined;
            }

            // Verify that both snapshots belong to the same fork
            if (currentOnChainSnapshot.forkId !== latestSnapshot.forkId) {
                throw new Error(
                    `Fork mismatch: current fork ${currentOnChainSnapshot.forkId}, new fork ${latestSnapshot.forkId}`
                );
            }

            const exitChannelBlocks: ExitChannelBlockStruct[] = [];

            // Get the current on-chain snapshot's latest exit channel block hash
            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData.latestExitChannelBlockHash;

            // Get the latest local exit channel block hash from the latest state snapshot
            if (!latestSnapshot) {
                throw new Error(
                    "Latest snapshot is undefined - this should not happen"
                );
            }
            const latestLocalExitBlockHash =
                latestSnapshot.snapshotData.latestExitChannelBlockHash;

            // Build the chain of exit blocks from current on-chain to latest local
            let currentHash = latestLocalExitBlockHash;
            const exitBlockChain: ExitChannelBlockStruct[] = [];

            // Walk backwards through the chain until we reach the on-chain hash
            while (currentHash !== currentOnChainExitBlockHash) {
                const exitBlock =
                    this.storage.exitChannelBlocks.getExitChannelBlock(
                        currentHash
                    );
                if (!exitBlock) {
                    throw new Error(
                        `Exit channel block not found for hash: ${currentHash}`
                    );
                }
                exitBlockChain.unshift(exitBlock);
                currentHash = exitBlock.previousBlockHash;
            }

            exitChannelBlocks.push(...exitBlockChain);

            return {
                milestoneProofs,
                milestoneSnapshots,
                exitChannelBlocks
            };
        } catch (error) {
            console.error(
                "Error preparing update snapshot for the same fork:",
                error
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
              exitBlocks: ExitChannelBlockStruct[];
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

            // Get the genesis snapshot
            const genesisSnapshot =
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    currentForkId
                );
            if (!genesisSnapshot) {
                throw new Error(
                    `No genesis snapshot found for fork ${currentForkId}`
                );
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
                const disputes: DisputeStruct[] = [];
                for (const commitment of disputeCommitments) {
                    const confirmation =
                        this.storage.disputes.getDisputeConfirmation(
                            commitment
                        );
                    if (!confirmation) {
                        throw new Error(
                            `Missing Data Availability for dispute commitment ${commitment}`
                        );
                    }
                    const dispute = Codec.decode(
                        confirmation.signedDispute.encodedDispute,
                        Type.Dispute
                    ) as DisputeStruct;
                    disputes.push(dispute);
                }

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
                            reduceData.joinChannelBlocks
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

            // Build exit blocks
            let latestExitBlockHash =
                genesisSnapshot.snapshotData.latestExitChannelBlockHash;
            const currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData.latestExitChannelBlockHash;
            const exitBlocks: ExitChannelBlockStruct[] = [];
            let currentExitBlock =
                this.storage.exitChannelBlocks.getExitChannelBlockEntry(
                    latestExitBlockHash
                );

            while (
                currentExitBlock &&
                latestExitBlockHash !== currentOnChainExitBlockHash
            ) {
                exitBlocks.unshift(currentExitBlock.block);
                latestExitBlockHash = currentExitBlock.block.previousBlockHash;
                currentExitBlock =
                    this.storage.exitChannelBlocks.getExitChannelBlockEntry(
                        currentExitBlock.block.previousBlockHash
                    );
            }

            return {
                genesisSnapshot,
                exitBlocks
            };
        } catch (error) {
            console.error("Error preparing update state snapshot fork:", error);
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

        // Get the block entry - if it doesn't exist (can happen ONLY from setState), skip timeout
        const block = this.storage.blocks.getBlock(forkId, blockHeight);
        if (!block) {
            return;
        }

        // If I already signed or block has already onChainTimestamp, no timeout needed
        if (
            block.didISign(this.signerAddress) ||
            block.onChainTimestamp !== undefined
        ) {
            return;
        }

        // Check if participant posted a commitment on-chain
        const commitmentResponse =
            await this.stateChannelManagerContract.getBlockCallDataCommitment(
                this.channelId,
                forkId,
                blockHeight,
                participantAddress
            );

        if (!commitmentResponse.found) {
            // No commitment posted - proceed with timeout
            await this.createTimeOutDispute(
                forkId,
                blockHeight,
                participantAddress
            );
            return;
        }

        // Validate the on-chain commitment is legitimate
        const isValidCommitment = await this.validateBlockCommitment(
            block,
            commitmentResponse.blockCalldataCommitment,
            participantAddress
        );

        if (!isValidCommitment) {
            // Invalid commitment - force timeout
            // TODO
        }
    }

    private async validateBlockCommitment(
        block: Block,
        blockCalldataCommitment: Hash,
        participantAddress: Address
    ): Promise<boolean> {
        const onChainResult =
            await this.validationService.fetchBlockCommitmentCalldata(
                block,
                blockCalldataCommitment
            );

        if (!onChainResult) {
            return false;
        }

        const expectedCommitment = hash(
            Codec.encode(
                {
                    signedBlock: block.signedBlock,
                    timestamp: onChainResult.timestamp
                },
                Type.BlockCommitment
            )
        );

        const isValid = expectedCommitment === blockCalldataCommitment;

        if (isValid) {
            // we should have already been notified the event listener.
            // calling the same handler the event lister would have called
            // this will call collectOnChainBlock on trigger  the block validation pipeline
            // if the  the block is invalid, the signer will get slashed
            this.stateChannelEventListener.eventHandler.onBlockCalldataPosted(
                this.channelId,
                blockCalldataCommitment,
                participantAddress,
                onChainResult.signedBlock,
                onChainResult.timestamp
            );
        }

        return isValid;
    }

    private async createTimeOutDispute(
        forkId: ForkId,
        blockHeight: BlockHeight,
        participantAddress: Address
    ): Promise<void> {
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            {
                forkId,
                height: blockHeight
            }
        );

        // Calculate when the participant should have acted
        const expectedBlockTime: Timestamp = previousBlockOrSnapshot.block
            ? previousBlockOrSnapshot.block.getRelevantTimestamp(
                  participantAddress
              )
            : previousBlockOrSnapshot.stateSnapshot!.timestamp;

        const currentTime = Clock.getTimeInSeconds();
        const timeoutDeadline =
            expectedBlockTime + this.getTimeoutWaitTimeSeconds();

        // If timeout period hasn't elapsed yet, don't create dispute
        if (currentTime < timeoutDeadline) {
            return;
        }

        const elapsedTime = currentTime - expectedBlockTime;
        const remainingDelay = this.getTimeoutWaitTimeSeconds() - elapsedTime;

        if (remainingDelay <= 0) {
            // Time has fully elapsed - create dispute immediately
            this.disputeManager.createDispute(forkId, false, {
                blockHeightToTimeout: blockHeight + 1,
                isForced: false,
                previousBlockProducer: participantAddress,
                previousBlockProducerPostedCalldata: false
            });
            console.log(
                `Timeout dispute created for participant: ${participantAddress}`
            );
        } else {
            // Schedule another timeout check after remaining delay
            scheduleTask(
                async () => {
                    await this.tryTimeoutParticipant(
                        forkId,
                        blockHeight,
                        participantAddress
                    );
                    console.log(
                        `Delayed timeout executed for participant: ${participantAddress}, delay: ${remainingDelay}s`
                    );
                },
                remainingDelay * 1000,
                "timeoutParticipantDelayed"
            );
        }
    }

    private getTimeoutWaitTimeSeconds() {
        return (
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime
        );
    }

    private async isMyTurn(): Promise<boolean> {
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();
        return this.signerAddress === nextToWrite;
    }

    private adjustTimestampIfNeeded(tx: TransactionStruct): void {
        const latestBlock = this.storage.blocks.getLatestBlock(this.forkId);

        // If there are no blocks yet, no need to adjust timestamp
        if (!latestBlock) {
            return;
        }

        const latestBlockTimestamp = latestBlock.timestamp;

        if (Number(tx.header.timestamp) < latestBlockTimestamp) {
            tx.header.timestamp = latestBlockTimestamp + 1;
        }
    }

    private async createStateSnapshot(
        stateMachineStateHash: Hash,
        coordinates: BlockCoordinates,
        timestamp: Timestamp,
        exitChannels?: ExitChannelStruct[]
    ): Promise<{
        stateSnapshot: StateSnapshot;
        exitChannelBlock?: ExitChannelBlockStruct;
        totalWithdrawals: BalanceStruct;
    }> {
        const previousStateSnapshot =
            this.storage.getPreviousStateSnapshot(coordinates);
        if (!previousStateSnapshot)
            throw new Error(
                "createStateSnapshot for block - previousStateSnapshot undefined"
            );

        const latestJoinChannelBlockHash =
            previousStateSnapshot.snapshotData.latestJoinChannelBlockHash;
        const totalDeposits = previousStateSnapshot.snapshotData.totalDeposits;

        let { latestExitChannelBlockHash, totalWithdrawals, participants } =
            previousStateSnapshot.snapshotData;

        let exitChannelBlock: ExitChannelBlockStruct | undefined;

        if (exitChannels && exitChannels.length > 0) {
            participants = await this.diamondStateMachine.getParticipants();
            exitChannelBlock = {
                exitChannels,
                previousBlockHash: latestExitChannelBlockHash
            };

            latestExitChannelBlockHash = hash(
                Codec.encode(exitChannelBlock, Type.ExitChannelBlock)
            );

            totalWithdrawals = await this.calculateTotalBalance(
                exitChannels,
                totalWithdrawals
            );
        }

        const stateSnapshot: StateSnapshotStruct = {
            forkId: coordinates.forkId,
            blockHeight: BigInt(coordinates.height),
            timestamp: timestamp,
            snapshotData: {
                originForkId: previousStateSnapshot.snapshotData.originForkId,
                stateMachineStateHash: stateMachineStateHash,
                participants,
                latestJoinChannelBlockHash,
                latestExitChannelBlockHash,
                totalDeposits,
                totalWithdrawals
            }
        };

        return {
            stateSnapshot: StateSnapshot.from(stateSnapshot),
            exitChannelBlock,
            totalWithdrawals
        };
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
            scheduleTask(
                () => this.maybePostBlockOnChain(block),
                this.timeConfig.agreementTime * 1000,
                "maybePostBlockOnChain"
            );
        }

        // step 11 - schedule a timeout check for the next participant
        scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    block.forkId,
                    block.height,
                    nextToWrite
                ),
            this.getTimeoutWaitTimeSeconds() * 1000,
            "participantTimeout"
        );
        // step 12 - try execute from queue
        scheduleTask(() => this.tryExecuteFromQueue(), 0, "queueProcessing");
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

        scheduleTask(
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
}

export default StateManager;

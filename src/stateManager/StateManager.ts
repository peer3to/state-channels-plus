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
import {
    DisputeFraudProofStruct,
    MilestoneProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";

// TypeChain types - Dispute types
import { SignedDisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

// TypeChain types - Contract interfaces
import { LocalDiamond, StateChannelManagerProxy } from "@typechain-types";

// Core components
import AgreementManager from "../agreementManager/AgreementManager";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import Clock from "@/Clock";
import DisputeHandler from "@/DisputeHandler";
import P2PManager from "@/P2PManager";
import StateChannelEventListener from "@/StateChannelEventListener";
import ValidationService from "./ValidationService";
import Storage from "@/storage";

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
    getActiveParticipants,
    SignatureUtils
} from "@/utils";
// Types
import { AgreementFlag, BlockValidationAction, TimeConfig } from "@/types";
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

let DEBUG_STATE_MANAGER = false;

const NULL = "0x00";

class StateManager {
    diamondStateMachine: ADiamondStateMachine;
    p2pEventHooks: P2pEventHooks;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelEventListener: StateChannelEventListener;
    disputeHandler: DisputeHandler;
    stateChannelManagerContract: StateChannelManagerProxy;
    p2pManager: P2PManager;
    timeConfig: TimeConfig;
    channelId: ChannelId = NULL;
    mutex: Mutex = new Mutex();
    self = DEBUG_STATE_MANAGER ? DebugProxy.createProxy(this) : this;
    isDisposed: boolean = false;
    validationService: ValidationService;
    storage: Storage;
    fraudProofService: FraudProofService;

    private latestForkId: ForkId = NULL;
    private dispatcher = new Map([
        [BlockValidationAction.DISPUTE, this.dispute],
        [BlockValidationAction.BROADCAST, this.broadcast],
        [BlockValidationAction.NOT_ENOUGH_TIME, this.notEnoughTime],
        [BlockValidationAction.SUCCESS, this.success]
    ]);

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage
    ) {
        this.signerAddress = signerAddress;
        this.diamondStateMachine = diamondStateMachine;
        this.p2pEventHooks = p2pEventHooks;
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.storage = storage;
        this.stateChannelEventListener = new StateChannelEventListener(
            this.self,
            this.stateChannelManagerContract,
            this.p2pEventHooks
        );
        this.agreementManager = new AgreementManager(this.storage);
        this.disputeHandler = new DisputeHandler(
            this.channelId,
            signer,
            signerAddress,
            this.agreementManager,
            this.stateChannelManagerContract,
            this.p2pEventHooks
        );
        this.p2pManager = new P2PManager(this.self, signer);
        this.fraudProofService = new FraudProofService(this.storage);
        this.validationService = new ValidationService(
            this.storage,
            this.diamondStateMachine,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.channelId,
            () => this.forkId
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
        this.disputeHandler.setP2pEventHooks(p2pEventHooks);
    }
    public setChannelId(channelId: ChannelId) {
        this.channelId = channelId;
        this.disputeHandler.setChannelId(channelId);
        this.stateChannelEventListener.setChannelId(channelId);
    }
    public getChannelId(): ChannelId {
        return this.channelId;
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
    //Triggered by the On-chain Event Listener when block calldata is posted on-chain
    public collectOnChainBlock(
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ) {
        console.log("StateManager - collectOnChainBlock");
        let flag = this.agreementManager.collectOnChainBlock(
            signedBlock,
            Number(timestamp)
        );
        let block = Block.fromSignedBlock(signedBlock);
        let disputeProof: DisputeFraudProofStruct;
        if (flag == AgreementFlag.DOUBLE_SIGN) {
            console.log("StateManager - collectOnChainBlock - double sign");
            disputeProof =
                this.disputeHandler.proofManager.createDoubleSignProof([
                    signedBlock
                ]);
            this.disputeHandler.createDispute(block.forkId, NULL, 0, [
                disputeProof
            ]);
        } else if (flag == AgreementFlag.INCORRECT_DATA) {
            console.log("StateManager - collectOnChainBlock - incorrect data");
            disputeProof =
                this.disputeHandler.proofManager.createIncorrectDataProof(
                    signedBlock
                );
            this.disputeHandler.createDispute(block.forkId, NULL, 0, [
                disputeProof
            ]);
        }
        console.log("StateManager - collectOnChainBlock - done");
        this.onSuccessCommon();
    }
    private async tryExecuteFromQueue() {
        const nextBlockHeight = this.storage.blocks.getNextBlockHeight(
            this.forkId
        );
        const blockConfirmations = this.storage.queues.tryDequeueConfirmations(
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
    /**
     * Triggered by the On-chain Event Listener when a new state is set on-chain
     * @param encodedState - Encoded state of the state machine
     * @param _forkId - new fork count
     * @param _timestamp - on-chain timestamp
     */
    public async setState(
        encodedState: Bytes,
        _forkId: ForkId,
        _timestamp: Timestamp
    ): Promise<void> {
        console.log("StateManager - SetState", _forkId, _timestamp);
        await this.diamondStateMachine.setState(encodedState);
        this.agreementManager.newFork(
            encodedState,
            await this.diamondStateMachine.getParticipants(),
            _forkId,
            _timestamp
        );

        //Try timeout next participant
        this.p2pEventHooks.onSetState?.();
        return this.onSuccessCommon();
    }

    // Passes the signedBlock through a verification pipeline and returns shouldDisconnect flag
    public onSignedBlock(signedBlock: SignedBlockStruct): Promise<boolean> {
        return this.onBlockConfirmation({
            signedBlock,
            signatures: []
        });
    }

    // Passes the block confirmation through a verification pipeline and returns shouldDisconnect flag
    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<boolean> {
        // the try/catch is to ensure that the mutex is unlocked in case of an error
        // no error is actually expected to happen, and the catch block just re-throws the error
        try {
            await this.mutex.lock();

            const validationResult =
                await this.validationService.validateBlockConfirmation(
                    blockConfirmation
                );
            if (validationResult.action) {
                await this.dispatcher.get(validationResult.action)!(
                    blockConfirmation
                );
            }
            return !!validationResult.shouldDisconnect;
        } catch (error) {
            throw error;
        } finally {
            this.mutex.unlock();
        }
    }

    //Aplies a transaction to the state machine and returns the encoded state with a success callback
    public async applyTransaction(transaction: TransactionStruct): Promise<{
        success: boolean;
        encodedState: Bytes;
        previousStateHash: Hash;
        successCallback: () => void;
        exitChannels: ExitChannelStruct[];
    }> {
        const previousStateHash = await this.diamondStateMachine
            .getState()
            .then(hash);
        const { success, successCallback, exitChannels } =
            await this.diamondStateMachine.stateTransition(transaction);
        const encodedState = await this.diamondStateMachine.getState();

        return {
            success,
            encodedState,
            previousStateHash,
            successCallback,
            exitChannels
        };
    }

    // Used when authoring a block - Executes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<SignedBlockStruct> {
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
                previousStateHash: _previousStateHash,
                successCallback
            } = await this.applyTransaction(tx);

            if (!success) {
                throw new Error(
                    "CreateAndApplyTransaction - Internal error - Transaction not successful"
                );
            }

            const posteriorStateHash = await this.diamondStateMachine
                .getState()
                .then(hash);
            const blockStruct = await this.createBlock(tx, posteriorStateHash);
            const encodedBlock = Codec.encode(blockStruct, Type.Block);
            const blockHash = hash(encodedBlock);
            const signedBlock: SignedBlockStruct = {
                encodedBlock: encodedBlock,
                signature: await this.p2pManager.p2pSigner.signMessage(
                    ethers.getBytes(blockHash)
                )
            };

            const block = Block.fromSignedBlock(signedBlock);

            this.agreementManager.addBlock(
                block,
                signedBlock.signature,
                encodedState
            );

            successCallback();
            await this.onSuccessCommon();

            scheduleTask(
                () => this.maybePostBlockOnChain(block, signedBlock),
                this.timeConfig.agreementTime * 1000,
                "maybePostBlockOnChain"
            );

            return signedBlock;
        } finally {
            this.mutex.unlock();
        }
    }

    private async maybePostBlockOnChain(
        block: Block,
        signedBlock: SignedBlockStruct
    ): Promise<void> {
        // If not everyone has signed, do the on-chain post
        if (!this.agreementManager.didEveryoneSignBlock(block)) {
            console.log("Posting calldata on chain!");
            this.p2pEventHooks.onPostingCalldata?.();

            this.stateChannelManagerContract
                .postBlockCalldata(signedBlock, Clock.getTimeInSeconds())
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

    public async postStateSnapshot(
        milestoneProofs: MilestoneProofStruct[],
        milestoneSnapshots: StateSnapshot[],
        exitChannelBlocks: ExitChannelBlockStruct[] = []
    ) {
        // Get on-chain state
        const onChainforkId = await this.stateChannelManagerContract.getforkId(
            this.channelId
        );
        const onChainDisputeLength =
            await this.stateChannelManagerContract.getDisputeLength(
                this.channelId
            );

        if (onChainDisputeLength == onChainforkId) {
            // Call contract without dispute
            return this.stateChannelManagerContract.updateStateSnapshotWithoutDispute(
                this.channelId,
                milestoneProofs,
                milestoneSnapshots,
                exitChannelBlocks
            );
        }

        // Need to include a dispute
        const disputeData = this.agreementManager.forks.getLatestDispute();
        if (!disputeData) {
            throw new Error(
                "No dispute data available but dispute length > fork count"
            );
        }

        // Get output state snapshot data
        const encodedDispute = Codec.encode(disputeData.dispute, Type.Dispute);
        const commitment = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["bytes", "uint256"],
                [encodedDispute, disputeData.timestamp]
            )
        );

        const outputStateSnapshot =
            this.outputStateSnapshotData.get(commitment);
        if (!outputStateSnapshot) {
            throw new Error("No output state snapshot data available");
        }

        const disputeProof: DisputeProofStruct = {
            dispute: disputeData.dispute,
            outputStateSnapshot: outputStateSnapshot,
            timestamp: disputeData.timestamp,
            signatures: []
        };

        // Check if dispute is within agreement time
        const currentTime = Clock.getTimeInSeconds();
        const timeSinceDispute = currentTime - disputeData.timestamp;

        if (timeSinceDispute > this.timeConfig.challengeTime) {
            // dispute is already finalized, no need for threshold finaliztion
            return this.stateChannelManagerContract.updateStateSnapshotWithDispute(
                this.channelId,
                milestoneProofs,
                milestoneSnapshots,
                disputeProof,
                exitChannelBlocks
            );
        }

        // Check if we have threshold signatures on the dispute
        const fork = this.agreementManager.forks.latestFork();
        if (!fork) {
            throw new Error("No latest fork found");
        }

        // Get all participants who have signed the dispute
        const disputeSignatures = this.agreementManager.getDisputeSignatures(
            disputeData.dispute
        );

        const allowedParticipantsSet = await getActiveParticipants(
            this.stateChannelManagerContract,
            this.getChannelId()
        );

        const hasThreshold = SignatureUtils.hasSignatureThreshold(
            allowedParticipantsSet,
            Codec.encode(disputeData.dispute, Type.Dispute),
            disputeSignatures
        );

        if (hasThreshold) {
            // Create dispute proof from the latest dispute
            // Call contract with dispute and signatures
            disputeProof.signatures = disputeSignatures;
            return this.stateChannelManagerContract.updateStateSnapshotWithDispute(
                this.channelId,
                milestoneProofs,
                milestoneSnapshots,
                disputeProof,
                exitChannelBlocks
            );
        }

        // Dispute is not finalized
        console.log(
            "Dispute is not finalized, state snapshot was not submitted"
        );
    }

    private async calculateTotalBalance(
        balances: { balance: BalanceStruct }[],
        initialTotal?: BalanceStruct
    ): Promise<BalanceStruct> {
        let total = initialTotal ?? (await this.stateMachine.getZeroBalance());

        for (const balance of balances) {
            total = await this.stateMachine.addBalance(total, balance.balance);
        }

        return total;
    }

    private async storeExitChannelBlock(
        exitChannels: ExitChannelStruct[],
        coordinates: BlockCoordinates
    ) {
        const previousStateSnapshot = this.storage.getStateSnapshot({
            forkId: coordinates.forkId,
            height: coordinates.height - 1
        });
        if (!previousStateSnapshot) {
            // This should never happen, but just in case
            throw new Error(
                `Previous state snapshot not found for forkId: ${coordinates.forkId} and height: ${coordinates.height - 1}`
            );
        }

        const previousBlockHash =
            previousStateSnapshot.snapshotData.latestExitChannelBlockHash;

        const exitChannelBlock: ExitChannelBlockStruct = {
            exitChannels,
            previousBlockHash: previousBlockHash
        };

        // Get previous block's total withdrawals or zero balance if first block
        const prevBlock =
            this.storage.exitChannelBlocks.getExitChannelBlockEntry(
                previousBlockHash
            );
        if (prevBlock == undefined && previousBlockHash != NULL)
            throw Error(
                ` previous ExitChannelBlock missing in storage ${previousBlockHash}`
            );

        const totalWithdrawals = await this.calculateTotalBalance(
            exitChannels,
            prevBlock?.totalWithdrawals
        );

        // Store the new block with calculated total withdrawals
        this.storage.exitChannelBlocks.storeExitChannelBlock(
            exitChannelBlock,
            totalWithdrawals
        );
        this.storage.exitPoints.storeExitPoint(
            coordinates.forkId,
            coordinates.height
        );
    }

    private async handleStateSnapshotStorage(
        encodedState: Bytes,
        forkId: ForkId
    ) {
        const stateSnapshot = await this.createStateSnapshot(
            encodedState,
            forkId
        );
        this.storage.stateSnapshots.storeStateSnapshot(stateSnapshot);
    }

    // Tries to timeout a participant by checking did the participant fail to transition the state within time - if successful -> creates a dispute
    private async tryTimeoutParticipant(
        forkId: ForkId,
        transactionCnt: BlockHeight,
        participantAdr: Address
    ) {
        if (participantAdr == this.signerAddress) return;
        const block = this.agreementManager.getBlock(forkId, transactionCnt);
        if (block) {
            if (this.agreementManager.didEveryoneSignBlock(block)) return;
        }
        //if there is no block -> check if player posted on chain and try timeout
        if (
            this.agreementManager.didParticipantPostOnChainLocal(
                forkId,
                transactionCnt,
                participantAdr
            )
        )
            return;

        if (
            Clock.getTimeInSeconds() <
            this.agreementManager.getChainLatestBlockTimestamp(
                forkId,
                transactionCnt
            ) +
                this.getTimeoutWaitTimeSeconds()
        )
            return;
        const response =
            await this.stateChannelManagerContract.getBlockCallDataCommitment(
                this.channelId,
                forkId,
                transactionCnt,
                participantAdr
            );
        if (response.found) return;
        //This should be enough since Clock should always lag behind DLT clock
        const delayTimeSeconds =
            this.getTimeoutWaitTimeSeconds() -
            (Clock.getTimeInSeconds() -
                this.agreementManager.getLatestBlockTimestamp(forkId));

        if (delayTimeSeconds < 0) {
            this.disputeHandler.createDispute(
                forkId,
                participantAdr,
                transactionCnt,
                []
            );
            console.log("Timeout participant!");
        } else {
            scheduleTask(
                async () => {
                    this.disputeHandler.createDispute(
                        forkId,
                        participantAdr,
                        transactionCnt,
                        []
                    );
                    console.log(
                        "Timeout participant! - delayed",
                        delayTimeSeconds
                    );
                },
                delayTimeSeconds * 1000,
                "timeoutParticipantDelayed"
            );
        }
    }

    private async onSuccessCommon() {
        // Immediately schedule a confirm/execute from queue on next tick
        scheduleTask(this.tryExecuteFromQueue, 0, "queueProcessing");

        // Identify the fork/tx counts for the next participant
        const forkId = this.forkId;
        const nextTransactionCnt =
            this.storage.blocks.getNextBlockHeight(forkId);
        const nextToWrite = await this.diamondStateMachine.getNextToWrite();

        // Notify any event hooks
        this.p2pEventHooks.onTurn?.(nextToWrite);

        // Schedule a timeout check for the next participant
        scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkId,
                    nextTransactionCnt,
                    nextToWrite
                ),
            this.getTimeoutWaitTimeSeconds() * 1000,
            "participantTimeout"
        );
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
        const latestBlockTimestamp =
            this.agreementManager.getLatestBlockTimestamp(this.forkId);
        if (Number(tx.header.timestamp) < latestBlockTimestamp) {
            tx.header.timestamp = latestBlockTimestamp + 1;
        }
    }

    private async createStateSnapshot(
        stateMachineStateHash: Hash,
        forkId: ForkId
    ): Promise<StateSnapshot> {
        const participants = await this.diamondStateMachine.getParticipants();

        const latestJoinChannelBlockHash =
            this.storage.joinChannelBlocks.getLatestJoinChannelBlockHash();
        const latestExitChannelBlockHash =
            this.storage.exitChannelBlocks.getLatestExitChannelBlockHash();
        const totalDeposits = this.storage.joinChannelBlocks.getTotalDeposits();
        const totalWithdrawals =
            this.storage.exitChannelBlocks.getTotalWithdrawals();

        const stateSnapshot: StateSnapshotStruct = {
            forkId,
            timestamp: Clock.getTimeInSeconds(),
            snapshotData: {
                stateMachineStateHash: stateMachineStateHash,
                participants,
                latestJoinChannelBlockHash: latestJoinChannelBlockHash as Hash,
                latestExitChannelBlockHash: latestExitChannelBlockHash as Hash,
                totalDeposits: {
                    amount: totalDeposits.amount,
                    data: totalDeposits.data
                },
                totalWithdrawals: {
                    amount: totalWithdrawals.amount,
                    data: totalWithdrawals.data
                }
            }
        };

        return StateSnapshot.from(stateSnapshot);
    }

    private async createBlock(
        tx: TransactionStruct,
        posteriorStateHash: Hash
    ): Promise<BlockStruct> {
        const forkId = this.forkId;
        const transactionCnt = Number(tx.header.transactionCnt);

        const previousBlockHash = this.storageModule.getPreviousBlockHash(
            forkId,
            transactionCnt - 1
        );

        const stateSnapshot = await this.createStateSnapshot(
            posteriorStateHash,
            forkId
        );

        const stateSnapshotHash = stateSnapshot.hash;

        const blockStruct: BlockStruct = {
            transaction: tx,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousBlockHash
        };

        return blockStruct;
    }

    private isValidStateTransition(
        encodedState: string,
        previousStateHash: Hash
    ): boolean {
        // state did not change
        if (hash(encodedState) === previousStateHash) {
            return false;
        }

        return true;
    }

    // ─────────────────────── ACTION HANDLERS ───────────────────────

    private async success(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // this function is still incomplete and should be considered as TODO
        // will be done in follow up PRs (after https://github.com/peer3to/state-channels-plus/pull/130)
        const block = Block.fromBlockConfirmation(blockConfirmation);

        const {
            success,
            encodedState,
            previousStateHash,
            successCallback,
            exitChannels
        } = await this.applyTransaction(block.transaction);

        if (!success) {
            this.fraudProofService.createInvalidStateTransitionProof(block);
            await this.dispute(blockConfirmation);
            return;
        }

        const stateTransitionFlag = this.isValidStateTransition(
            encodedState as string,
            previousStateHash
        );

        if (!stateTransitionFlag) {
            this.fraudProofService.createInvalidStateTransitionProof(block);
            await this.dispute(blockConfirmation);
            return;
        }

        // Store the block confirmation
        this.storage.blocks.storeBlock(block);

        // Handle state snapshot storage
        await this.handleStateSnapshotStorage(encodedState, block.forkId);

        // Store exit channel blocks if present
        if (exitChannels.length > 0) {
            await this.storeExitChannelBlock(exitChannels, block.coordinates);
        }

        successCallback();
        await this.onSuccessCommon();
    }

    private async dispute(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // The fraud proof has already been stored by ValidationService
        // rest is left as TODO for now
    }

    private async broadcast(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // The block has already been stored by ValidationService with merged signatures
        // We would trigger P2P broadcast here: this.p2pManager.broadcastBlockConfirmation(blockConfirmation);
        // For now, this is left as TODO
    }

    private async notEnoughTime(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // No-op - abstain from applying/signing
    }

    // ----- Event handlers -----
    public async onDisputeCommitted(
        encodedDispute: string,
        timestamp: Timestamp
    ) {
        const dispute = Codec.decode(encodedDispute, Type.Dispute);

        // Validate dispute
        const valid = await this.validationService.validateDispute(
            dispute,
            timestamp
        );

        if (!valid) {
            return;
        }
        // Add dispute to ForkService

        this.agreementManager.addDispute(dispute, timestamp);

        if (dispute.disputer !== this.signerAddress) {
            // this signs the dispute, adds the signature to the AgreementManager and broadcasts
            //  the dispute with the additional signature
            // the disputer should not broadcast the dispute, since all peers will receive the dsiputer's signature
            // on the dispute event
            this.p2pManager.p2pSigner.confirmDispute(dispute);
        }
    }

    public onOutputStateSnapshotVerified(
        outputStateSnapshot: StateSnapshot,
        commitment: Hash
    ) {
        this.outputStateSnapshotData.set(commitment, outputStateSnapshot);
    }
    public async onDisputeConfirmation(
        signedDispute: SignedDisputeStruct
    ): Promise<ExecutionFlags> {
        const dispute = Codec.decode(
            signedDispute.encodedDispute,
            Type.Dispute
        );

        const { success, flag } =
            await this.validationService.validateDisputeConfirmation(
                dispute,
                signedDispute.signature
            );

        if (success) {
            this.agreementManager.confirmDispute(
                dispute,
                signedDispute.signature
            );
        }

        return flag;
    }
}

export default StateManager;

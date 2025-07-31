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
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

// TypeChain types - Proof types
import {
    MilestoneProofStruct,
    DisputeFraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";

// TypeChain types - Dispute types
import { SignedDisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

// TypeChain types - Contract interfaces
import { StateChannelManagerProxy } from "@typechain-types";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";

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
import { ExecutionDecisionProcessor } from "./executionDecisionProcessor";

// Models
import { Block, BlockCoordinates, StateSnapshot } from "@/models";

// Utils
import {
    DebugProxy,
    Mutex,
    scheduleTask,
    getActiveParticipants,
    Codec,
    Type,
    SignatureUtils,
    isCustomEvmError,
    difference,
    isSubset,
    hash
} from "@/utils";
// Types
import { AgreementFlag, ExecutionFlags, TimeConfig } from "@/types";
import {
    Address,
    BlockHeight,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";
import { BlockConfirmationStruct } from "@typechain-types/contracts/V1/StateChannelManagerEvents";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";

let DEBUG_STATE_MANAGER = false;

const NULL = "0x00";
class StateManager {
    stateMachine: ADiamondStateMachine;
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

    // Decision processors
    private executionDecisionProcessor: ExecutionDecisionProcessor;

    // Store output state snapshots data
    private latestForkId: ForkId = NULL;

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        stateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage
    ) {
        this.signerAddress = signerAddress;
        this.stateMachine = stateMachine;
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
        this.validationService = new ValidationService(
            this.storage,
            this.agreementManager,
            this.stateMachine,
            this.disputeHandler,
            this.stateChannelManagerContract,
            this.timeConfig,
            this.storage,
            () => this.getChannelId(),
            this.signerAddress,
            this.onSignedBlock.bind(this)
        );

        // Initialize decision processors
        this.executionDecisionProcessor = new ExecutionDecisionProcessor(
            this.storage,
            this.p2pManager,
            this.disputeHandler,
            this.onSuccessCommon.bind(this)
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
        return this.stateMachine.getParticipants();
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
        let block = Block.decode(signedBlock.encodedBlock);
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
            const executionFlag = await this.onSignedBlock(
                blockConfirmation.signedBlock
            );
            if (executionFlag == ExecutionFlags.DISPUTE) break;
        }
    }
    private async tryConfirmFromQueue(): Promise<void> {
        const nextBlockHeight = this.storage.blocks.getNextBlockHeight(
            this.forkId
        );
        const confirmations = this.storage.queues.tryDequeueConfirmations(
            this.forkId,
            nextBlockHeight
        );

        for (const confirmation of confirmations) {
            // Process each signature in the confirmation
            for (const signature of confirmation.signatures) {
                const executionFlag = await this.onBlockConfirmation(
                    confirmation.signedBlock,
                    signature as Signature
                );
                if (executionFlag == ExecutionFlags.DISPUTE) return;
            }
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
        await this.stateMachine.setState(encodedState);
        this.agreementManager.newFork(
            encodedState,
            await this.stateMachine.getParticipants(),
            _forkId,
            _timestamp
        );

        //Try timeout next participant
        this.p2pEventHooks.onSetState?.();
        return this.onSuccessCommon();
    }

    // Passes the signedBlock through a verification pipeline and returns an execution flag based on the outcome
    public onSignedBlock(
        signedBlock: SignedBlockStruct
    ): Promise<ExecutionFlags> {
        return this.onBlockConfirmation({
            signedBlock,
            signatures: []
        });
    }

    // Passes the block confirmation through a verification pipeline and returns an execution flag
    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct
    ): Promise<ExecutionFlags> {
        // 1. Check if channel is open
        if (!this.isChannelOpen()) {
            this.storage.queues.queueConfirmation(blockConfirmation);
            return ExecutionFlags.NOT_READY;
        }

        // 2. Authenticate the block and get participants
        const block = this.authenticateBlock(blockConfirmation);
        if (!block) {
            return ExecutionFlags.DISCONNECT;
        }
        let participants = new Set(
            this.storage.getParticipants(block.coordinates)
        );

        if (participants.size === 0) {
            // get participants from chain
            const participantsFromChain =
                await this.stateChannelManagerContract.getParticipants(
                    this.channelId
                );
            const pendingParticipants =
                await this.stateChannelManagerContract.getPendingParticipants(
                    this.channelId
                );
            participants = new Set([
                ...participantsFromChain,
                ...pendingParticipants
            ]);
        }

        // 3. check duplicate blocks
        const duplicateBlockFlag = await this.checkDuplicateBlock(
            blockConfirmation,
            participants
        );
        // could be DISCONNECT, DUPLICATE, BROADCAST or undefined
        if (duplicateBlockFlag !== undefined) {
            return duplicateBlockFlag;
        }

        // 4. Validate block author
        if (!participants.has(block.author)) {
            return ExecutionFlags.DISCONNECT;
        }

        // 5. Handle conflicting blocks
        const { conflict, fraudProof } = await this.checkConflictingBlock(
            blockConfirmation,
            block
        );
        if (conflict) {
            if (fraudProof !== undefined) {
                // TODO: Persist fraud proof to storage
                return ExecutionFlags.DISPUTE;
            }

            return ExecutionFlags.DISCONNECT;
        }

        if (this.isDisputedFork(block.forkId)) {
            this.storage.queues.queueConfirmation(blockConfirmation);
            return ExecutionFlags.NOT_READY;
        }
        // isNext
        if (
            block.height > this.storage.blocks.getNextBlockHeight(this.forkId)
        ) {
            this.storage.queues.queueConfirmation(blockConfirmation);
            return ExecutionFlags.NOT_READY;
        }

        // 7. Final validation and processing
        return await this.processValidBlock(blockConfirmation, block);
    }

    private authenticateBlock(
        blockConfirmation: BlockConfirmationStruct
    ): Block | undefined {
        let block: Block;

        try {
            block = Block.decode(blockConfirmation.signedBlock.encodedBlock);
            if (block.channelId !== this.channelId) {
                throw new Error(
                    "Block channelId does not match current channelId"
                );
            }
            if (
                block.getSignerAddress(
                    blockConfirmation.signedBlock.signature
                ) !== block.author
            ) {
                throw new Error("Block signature does not match block author");
            }
        } catch (error) {
            console.error("Invalid block confirmation", error);
            return undefined;
        }

        return block;
    }

    private async checkDuplicateBlock(
        blockConfirmation: BlockConfirmationStruct,
        participants: Set<Address>
    ): Promise<ExecutionFlags | undefined> {
        const block = Block.decode(blockConfirmation.signedBlock.encodedBlock);

        // 1. Check if block is in queue
        if (
            this.storage.queues.isBlockQueued(blockConfirmation, {
                hash: block.hash
            })
        ) {
            const signerAddresses = block.getSignerAddresses(
                blockConfirmation.signatures as Signature[]
            );
            const areAllParticipants = isSubset(signerAddresses, participants);

            if (!areAllParticipants) {
                return ExecutionFlags.DISCONNECT;
            }

            // Store in queue (handles signature merging automatically)
            this.storage.queues.queueConfirmation(blockConfirmation);
            return ExecutionFlags.DUPLICATE;
        }

        // 2. Check if block is in block storage
        if (this.storage.blocks.getBlockEntry(block.hash) !== undefined) {
            const existingSignatures = new Set(
                this.storage.blocks.getSignatures(block.hash) as Signature[]
            );
            const incomingSignatures = new Set(
                blockConfirmation.signatures as Signature[]
            );
            const newSignatures = difference(
                incomingSignatures,
                existingSignatures
            );
            const hasNewSignatures = newSignatures.size > 0;

            if (!hasNewSignatures) {
                return ExecutionFlags.DUPLICATE;
            }

            // Validate new signatures are from participants
            const newSignerAddresses: Set<Address> = block.getSignerAddresses(
                Array.from(newSignatures)
            );
            const areNewSignersParticipants = isSubset(
                newSignerAddresses,
                participants
            );

            if (!areNewSignersParticipants) {
                return ExecutionFlags.DISCONNECT;
            }

            // Store (handles signature merging automatically)
            this.storage.blocks.storeBlockConfirmation(blockConfirmation);
            return ExecutionFlags.BROADCAST;
        }

        return undefined;
    }

    private async checkConflictingBlock(
        blockConfirmation: BlockConfirmationStruct,
        block: Block
    ): Promise<{
        conflict: boolean;
        fraudProof?:
            | BlockDoubleSignProofStruct
            | BlockInvalidStateTransitionProofStruct;
    }> {
        const maybePreExistingSignedBlock = this.storage.blocks.getBlockEntry(
            block.forkId,
            block.height
        )?.blockConfirmation.signedBlock;

        if (!maybePreExistingSignedBlock) {
            return { conflict: false, fraudProof: undefined };
        }

        const preExistingSignedBlock = maybePreExistingSignedBlock;
        const preExistingBlock = Block.decode(
            preExistingSignedBlock.encodedBlock
        );

        if (preExistingBlock.author === block.author) {
            // DOUBLE SIGN
            const fraudProof: BlockDoubleSignProofStruct = {
                block1: preExistingSignedBlock,
                block2: blockConfirmation.signedBlock
            };
            return {
                conflict: true,
                fraudProof: fraudProof
            };
        } else {
            const isLinked = this.isLinked(block);
            if (!isLinked) {
                return {
                    conflict: true,
                    fraudProof: undefined
                };
            }

            // invalid state fraud proof
            const previousEntity = this.getPreviousBlockOrSnapshot(block);

            let prevSignedBlock: SignedBlockStruct | undefined;
            let prevStateSnapshot: StateSnapshot;

            if (previousEntity.block) {
                // Height > 0 case - we have a previous block
                prevSignedBlock = previousEntity.block;
                const prevBlock = Block.decode(prevSignedBlock.encodedBlock);
                prevStateSnapshot =
                    this.storage.stateSnapshots.getStateSnapshotByHash(
                        prevBlock.stateSnapshotHash
                    )!;
            } else {
                // Height === 0 case - we have genesis state snapshot
                prevSignedBlock = undefined;
                prevStateSnapshot = previousEntity.stateSnapshot!;
            }

            const fraudProof: BlockInvalidStateTransitionProofStruct = {
                invalidBlock: blockConfirmation.signedBlock,
                previousBlock: prevSignedBlock,
                previousBlockStateSnapshot: prevStateSnapshot.toStruct(),
                previousStateStateMachineState:
                    this.storage.stateMachineStates.getStateMachineState(
                        prevStateSnapshot.stateMachineStateHash
                    )!
            };

            return {
                conflict: true,
                fraudProof: fraudProof
            };
        }
    }

    /**
     * Performs final validation and processes the valid block
     */
    private async processValidBlock(
        blockConfirmation: BlockConfirmationStruct,
        block: Block
    ): Promise<ExecutionFlags> {
        const executionFlag =
            await this.validationService.validateBlockConfirmation(
                blockConfirmation.signedBlock,
                blockConfirmation.signatures[0] as Signature,
                block
            );

        if (executionFlag.success) {
            this.storage.blocks.storeBlockConfirmation(blockConfirmation);
            return ExecutionFlags.SUCCESS;
        } else {
            return executionFlag.flag;
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
        const previousStateHash = await this.getEncodedStateKecak256();
        const { success, successCallback, exitChannels } =
            await this.stateMachine.stateTransition(transaction);
        const encodedState = await this.stateMachine.getState();

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
            if (!this.isChannelOpen()) {
                throw new Error("Channel not open");
            }
            if (!(await this.isMyTurn())) {
                throw new Error(
                    `Not player turn - myAddress: ${String(this.signerAddress)} - nextToWrite: ${await this.stateMachine.getNextToWrite()}`
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

            const posteriorStateHash = await this.getEncodedStateKecak256();
            const block = await this.createBlock(tx, posteriorStateHash);
            const signedBlock = await block.signedBlock(
                this.p2pManager.p2pSigner
            );

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
        // TODO: Fix this section - outputStateSnapshotData property doesn't exist
        /*
        const outputStateSnapshot = this.outputStateSnapshotData.get(commitment);
        if (!outputStateSnapshot) {
            throw new Error("No output state snapshot data available");
        }
        */

        // TODO: Fix this section - DisputeProofStruct type doesn't exist and updateStateSnapshotWithDispute method doesn't exist
        /*
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
        */

        // Dispute is not finalized
        console.log(
            "Dispute is not finalized, state snapshot was not submitted"
        );
    }

    public getEncodedState(): Promise<Bytes> {
        return this.stateMachine.getState();
    }

    public getEncodedStateKecak256(): Promise<Hash> {
        return this.getEncodedState().then(ethers.keccak256);
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

        // TODO: Fix this - getBlock method doesn't exist in AgreementManager
        /*
        const block = this.agreementManager.getBlock(forkId, transactionCnt);
        if (block) {
            if (this.agreementManager.didEveryoneSignBlock(block)) return;
        }
        */

        //if there is no block -> check if player posted on chain and try timeout
        if (
            this.agreementManager.didParticipantPostOnChainLocal(
                forkId,
                transactionCnt,
                participantAdr
            )
        )
            return;

        // TODO: Fix this - getChainLatestBlockTimestamp method doesn't exist in AgreementManager
        /*
        if (
            Clock.getTimeInSeconds() <
            this.agreementManager.getChainLatestBlockTimestamp(
                forkId,
                transactionCnt
            ) +
                this.getTimeoutWaitTimeSeconds()
        )
            return;
        */

        const response =
            await this.stateChannelManagerContract.getBlockCallDataCommitment(
                this.channelId,
                forkId,
                transactionCnt,
                participantAdr
            );
        if (response.found) return;
        //This should be enough since Clock should always lag behind DLT clock

        // TODO: Fix this - getLatestBlockTimestamp method doesn't exist in AgreementManager
        /*
        const delayTimeSeconds =
            this.getTimeoutWaitTimeSeconds() -
            (Clock.getTimeInSeconds() -
                this.agreementManager.getLatestBlockTimestamp(forkId));
        */

        // For now, use a simple timeout without the complex calculation
        const delayTimeSeconds = this.getTimeoutWaitTimeSeconds();

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
        scheduleTask(
            () => {
                this.tryConfirmFromQueue();
                this.tryExecuteFromQueue();
            },
            0,
            "queueProcessing"
        );

        // Identify the fork/tx counts for the next participant
        const forkId = this.forkId;
        const nextTransactionCnt =
            this.storage.blocks.getNextBlockHeight(forkId);
        const nextToWrite = await this.stateMachine.getNextToWrite();

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
        const nextToWrite = await this.stateMachine.getNextToWrite();
        return this.signerAddress === nextToWrite;
    }

    private adjustTimestampIfNeeded(tx: TransactionStruct): void {
        // TODO: Fix this - getLatestBlockTimestamp method doesn't exist in AgreementManager
        /*
        const latestBlockTimestamp =
            this.agreementManager.getLatestBlockTimestamp(this.forkId);
        if (Number(tx.header.timestamp) < latestBlockTimestamp) {
            tx.header.timestamp = latestBlockTimestamp + 1;
        }
        */
    }

    private async createStateSnapshot(
        stateMachineStateHash: Hash,
        forkId: ForkId
    ): Promise<StateSnapshot> {
        const participants = await this.stateMachine.getParticipants();

        // TODO: Fix this - getLatestJoinChannelBlockHash method doesn't exist
        /*
        const latestJoinChannelBlockHash =
            this.storage.joinChannelBlocks.getLatestJoinChannelBlockHash();
        const latestExitChannelBlockHash =
            this.storage.exitChannelBlocks.getLatestExitChannelBlockHash();
        const totalDeposits = this.storage.joinChannelBlocks.getTotalDeposits();
        const totalWithdrawals =
            this.storage.exitChannelBlocks.getTotalWithdrawals();
        */

        // For now, use placeholder values
        const latestJoinChannelBlockHash = NULL;
        const latestExitChannelBlockHash = NULL;
        const totalDeposits = { amount: 0n, data: "0x" };
        const totalWithdrawals = { amount: 0n, data: "0x" };

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
    ): Promise<Block> {
        const forkId = this.forkId;
        const transactionCnt = Number(tx.header.transactionCnt);

        // TODO: Fix this - getPreviousBlockHash method doesn't exist in BlockStorage
        /*
        const previousBlockHash = this.storage.blocks.getPreviousBlockHash(
            forkId,
            transactionCnt - 1
        );
        */

        // For now, use NULL as placeholder
        const previousBlockHash = NULL;

        const stateSnapshot = await this.createStateSnapshot(
            posteriorStateHash,
            forkId
        );

        const stateSnapshotHash = stateSnapshot.hash;

        return Block.from({
            transaction: tx,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousBlockHash
        });
    }

    private isLinked(block: Block): boolean {
        const { forkId } = block.coordinates;
        let currentHeight = block.height;
        let currentPreviousBlockHash = block.previousBlockHash;

        // Iterate backwards through the chain until we reach height 0
        while (currentHeight > 0) {
            const prevBlockEntry = this.storage.blocks.getBlockEntry(
                forkId,
                currentHeight - 1
            );
            if (!prevBlockEntry) {
                return false;
            }

            const prevBlockHash = hash(
                prevBlockEntry.blockConfirmation.signedBlock.encodedBlock
            );
            if (prevBlockHash !== currentPreviousBlockHash) {
                return false; // Chain is broken - hashes don't match
            }

            currentHeight = currentHeight - 1;
            currentPreviousBlockHash = prevBlockHash;
        }

        // currentHeight is  0 => validate against the genesis snapshot
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(forkId);
        if (!genesisSnapshot) {
            return false;
        }

        return genesisSnapshot.hash === currentPreviousBlockHash;
    }

    private isChannelOpen(): boolean {
        return this.forkId !== ethers.ZeroHash && this.forkId !== NULL;
    }
    // Assumes the previous data exists (called after isLinked check).
    private getPreviousBlockOrSnapshot(block: Block): {
        block?: SignedBlockStruct;
        stateSnapshot?: StateSnapshot;
    } {
        if (block.height > 0) {
            const prevBlockEntry = this.storage.blocks.getBlockEntry(
                block.forkId,
                block.height - 1
            )!;

            return { block: prevBlockEntry.blockConfirmation.signedBlock };
        }
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                block.forkId
            )!;

        return { stateSnapshot: genesisSnapshot };
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
        // TODO: Fix this - addDispute method doesn't exist in AgreementManager
        /*
        this.agreementManager.addDispute(dispute, timestamp);
        */

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
        // TODO: Fix this - outputStateSnapshotData property doesn't exist in StateManager
        /*
        this.outputStateSnapshotData.set(commitment, outputStateSnapshot);
        */
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
                signedDispute.signature as any // TODO: Fix type: SignatureLike
            );

        if (success) {
            // TODO: Fix this - confirmDispute method doesn't exist in AgreementManager
            /*
            this.agreementManager.confirmDispute(
                dispute,
                signedDispute.signature
            );
            */
        }

        return flag;
    }
}

export default StateManager;

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
import {
    DisputeStruct,
    SignedDisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";

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
import { Block, StateSnapshot } from "@/models";

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
    SignatureUtils,
    difference,
    decodeErrorProxy
} from "@/utils";
// Types
import {
    AgreementFlag,
    BlockValidationResult as BlockValidationResult,
    TimeConfig
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
    localDiamondContract: LocalDiamond;

    private latestForkId: ForkId = NULL;
    private dispatcher = new Map([
        [BlockValidationResult.NOT_READY, this.notReady],
        [BlockValidationResult.DISCONNECT, this.disconnect],
        [BlockValidationResult.DISPUTE, this.dispute],
        [BlockValidationResult.BROADCAST, this.broadcast],
        [BlockValidationResult.NOT_ENOUGH_TIME, this.notEnoughTime],
        [BlockValidationResult.DUPLICATE, this.duplicate]
    ]);

    constructor(
        signer: ethers.Signer,
        signerAddress: Address,
        stateChannelManagerContract: StateChannelManagerProxy,
        diamondStateMachine: ADiamondStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks,
        storage: Storage,
        localDiamondContract: LocalDiamond
    ) {
        this.signerAddress = signerAddress;
        this.diamondStateMachine = diamondStateMachine;
        this.p2pEventHooks = p2pEventHooks;
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = decodeErrorProxy(
            stateChannelManagerContract
        );
        this.storage = storage;
        this.localDiamondContract = localDiamondContract;

        this.stateChannelEventListener = new StateChannelEventListener(
            this.self,
            this.stateChannelManagerContract,
            this.p2pEventHooks,
            this.localDiamondContract
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
            () => this.forkId,
            this.localDiamondContract
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
    public async collectOnChainBlock(
        signedBlock: SignedBlockStruct,
        timestamp: Timestamp
    ) {
        const blockConfirmation: BlockConfirmationStruct = {
            signedBlock,
            signatures: []
        };

        return this.onBlockConfirmation(blockConfirmation, timestamp);
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

    // Passes the block confirmation through a verification pipeline
    // returns true if the block is valid and the state transition is successful
    // returns false -> the calling context should disconnect from the peer
    public async onBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        onChainTimestamp?: Timestamp
    ): Promise<boolean> {
        // the try/catch is to ensure that the mutex is unlocked in case of an error
        // no error is actually expected to happen, and the catch block just re-throws the error
        try {
            await this.mutex.lock();

            const validationResult =
                await this.validationService.validateBlockConfirmation(
                    blockConfirmation,
                    onChainTimestamp
                );

            if (validationResult !== BlockValidationResult.SUCCESS) {
                // handle all non-success actions
                await this.dispatcher.get(validationResult)!(blockConfirmation);
            }

            // SUCCESS action: perform state transition validation
            const block = Block.fromSignedBlock(blockConfirmation.signedBlock);

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
                // disconnect
                return false;
            }

            const stateChanged = this.isValidStateTransition(
                encodedState as string,
                previousStateHash
            );

            if (!stateChanged) {
                this.fraudProofService.createInvalidStateTransitionProof(block);
                await this.dispute(blockConfirmation);
                // disconnect
                return false;
            }

            // Validate state snapshot hash
            const { stateSnapshot, exitChannelBlock, totalWithdrawals } =
                await this.createStateSnapshot(
                    hash(encodedState),
                    block,
                    exitChannels
                );

            if (stateSnapshot.hash !== block.stateSnapshotHash) {
                this.fraudProofService.createInvalidStateTransitionProof(block);
                await this.dispute(blockConfirmation);
                return false;
            }

            // All validations passed - proceed with success action
            this.success(
                block,
                stateSnapshot,
                successCallback,
                totalWithdrawals,
                exitChannelBlock
            );

            // success - no disconnect
            return true;
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

            this.storage.blocks.storeBlock(block);

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
        const participants = this.storage.getParticipants(block.coordinates);

        if (!block.didEveryoneSign(participants)) {
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

    /**
     * Updates the state snapshot when the fork is the same
     */
    public async updateSnapshotSameFork(forkId: ForkId): Promise<void> {
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
                    this.agreementManager.getSnapshot(milestoneProof);

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
                return;
            }

            const latestSnapshot =
                milestoneSnapshots[milestoneSnapshots.length - 1];

            // Latest snapshot is the same as current on-chain
            if (
                latestSnapshot.blockHeight ===
                currentOnChainSnapshot.blockHeight
            ) {
                console.log("State is already up to date");
                return;
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

            const txResponse =
                await this.stateChannelManagerContract.updateStateSnapshotSameFork(
                    this.channelId,
                    milestoneProofs,
                    milestoneSnapshots.map((snapshot) => snapshot.toStruct()),
                    exitChannelBlocks
                );

            await txResponse.wait();

            console.log(
                `Successfully updated state snapshot for fork ${forkId}`
            );
        } catch (error) {
            console.error("Error updating snapshot for the same fork:", error);
            throw error;
        }
    }

    /**
     * Updates the state snapshot when the fork is different
     */
    public async updateSnapshotFork(): Promise<void> {
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

                // Get the dispute window creation timestamp from the on-chain contract
                const creationTimestamp =
                    await this.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                        this.channelId,
                        currentForkId
                    );

                // Use proxy view to compute reduced output cheaply (no tx)
                const reducedOutput =
                    await this.stateChannelManagerContract.reduceProxyView(
                        disputes,
                        creationTimestamp
                    );

                // Derive latest snapshot and encoded state from reduced output's latest block
                const latestSnapshotHash =
                    reducedOutput.latestBlock.stateSnapshotHash;
                const latestSnapshot =
                    this.storage.stateSnapshots.getStateSnapshotByHash(
                        latestSnapshotHash
                    );
                if (!latestSnapshot) {
                    throw new Error(
                        "Latest snapshot for reduced output not found in local storage"
                    );
                }
                const stateHash =
                    latestSnapshot.snapshotData.stateMachineStateHash;
                const encodedStateForReduce =
                    this.storage.stateMachineStates.getStateMachineState(
                        stateHash
                    );
                if (!encodedStateForReduce) {
                    throw new Error(
                        "Encoded state for reduced output not found in local storage"
                    );
                }

                // Build join channel blocks
                let currentJoinChannelBlockHash: Hash =
                    reducedOutput.latestJoinChannelBlockHash;
                let joinChannelBlocks: JoinChannelBlockStruct[] = [];
                let currentJoinChannelBlock =
                    this.storage.joinChannelBlocks.getJoinChannelBlockEntry(
                        currentJoinChannelBlockHash
                    );

                while (
                    currentJoinChannelBlock &&
                    currentJoinChannelBlockHash !==
                        genesisSnapshot.snapshotData.latestJoinChannelBlockHash
                ) {
                    joinChannelBlocks.unshift(currentJoinChannelBlock.block);
                    currentJoinChannelBlockHash =
                        currentJoinChannelBlock.block.previousBlockHash;
                    currentJoinChannelBlock =
                        this.storage.joinChannelBlocks.getJoinChannelBlockEntry(
                            currentJoinChannelBlock.block.previousBlockHash
                        );
                }

                // Reduce and finalize on-chain to obtain the reduced fork id
                try {
                    const txResponse =
                        await this.stateChannelManagerContract.reduceAndFinalize(
                            disputes,
                            creationTimestamp,
                            latestSnapshot.toStruct(),
                            encodedStateForReduce,
                            joinChannelBlocks
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
            let currentOnChainExitBlockHash =
                currentOnChainSnapshot.snapshotData.latestExitChannelBlockHash;
            let exitBlocks: ExitChannelBlockStruct[] = [];
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

            // Update snapshot
            const txResponse =
                await this.stateChannelManagerContract.updateStateSnapshotFork(
                    this.channelId,
                    genesisSnapshot.toStruct(),
                    exitBlocks
                );
            await txResponse.wait();
            console.log(
                `Updated to genesis snapshot for fork ${currentForkId}`
            );
        } catch (error) {
            console.error("Error updating snapshot for fork:", error);
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
        participantAdr: Address
    ) {
        if (participantAdr == this.signerAddress) return;

        const blockEntry = this.storage.blocks.getBlockEntry(
            forkId,
            blockHeight
        );
        if (blockEntry) {
            const block = blockEntry.block;
            const participants = this.storage.getParticipants(
                block.coordinates
            );

            if (block.didEveryoneSign(participants)) return;

            if (blockEntry.onChainTimestamp !== undefined) return;
        }

        const response =
            await this.stateChannelManagerContract.getBlockCallDataCommitment(
                this.channelId,
                forkId,
                blockHeight,
                participantAdr
            );
        if (response.found) return;

        // we have a "block" hash, but we need to make sure it is a commitment to a real block
        // can re-use fetchOnChainTimestamp to get the real block and time stamp (underlying commitment)
        // if the block commited is junk the we force timeout (see bool isForced on Timeout struct)

        // after getting the block we feed it to the event handler that was suppose to fire when the block data was posted

        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            {
                forkId,
                height: blockHeight
            }
        );

        // if block use getRelevantTimestamp
        // if snapshot use the snapshot timestamp

        const expectedBlockTime =
            latestBlockEntry.block.getRelevantTimestamp(participantAdr);

        if (
            Clock.getTimeInSeconds() <
            expectedBlockTime + this.getTimeoutWaitTimeSeconds()
        )
            return;

        const delayTimeSeconds =
            this.getTimeoutWaitTimeSeconds() -
            (Clock.getTimeInSeconds() - expectedBlockTime);

        if (delayTimeSeconds < 0) {
            this.disputeHandler.createDispute(
                forkId,
                participantAdr,
                blockHeight,
                []
            );
            console.log("Timeout participant!");
        } else {
            // should re-call tryTimeoutParticipant again, not create dispute
            scheduleTask(
                async () => {
                    this.disputeHandler.createDispute(
                        forkId,
                        participantAdr,
                        blockHeight,
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
        const latestBlockTimestamp = this.storage.blocks.getLatestBlockEntry(
            this.forkId
        )!.block.timestamp;

        if (Number(tx.header.timestamp) < latestBlockTimestamp) {
            tx.header.timestamp = latestBlockTimestamp + 1;
        }
    }

    private async createStateSnapshot(
        stateMachineStateHash: Hash,
        block: Block,
        exitChannels?: ExitChannelStruct[]
    ): Promise<{
        stateSnapshot: StateSnapshot;
        exitChannelBlock?: ExitChannelBlockStruct;
        totalWithdrawals: BalanceStruct;
    }> {
        const previousStateSnapshot = this.storage.getPreviousStateSnapshot(
            block.coordinates
        )!;
        const genesisStateSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                block.forkId
            )!;

        const latestJoinChannelBlockHash =
            genesisStateSnapshot.snapshotData.latestJoinChannelBlockHash;
        const totalDeposits = genesisStateSnapshot.snapshotData.totalDeposits;

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
            forkId: block.coordinates.forkId,
            blockHeight: BigInt(block.coordinates.height),
            timestamp: block.timestamp,
            snapshotData: {
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
        posteriorStateHash: Hash
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

        const stateSnapshot = await this.createStateSnapshot(
            posteriorStateHash,
            forkId,
            blockHeight
        );

        const stateSnapshotHash = stateSnapshot.hash;

        const blockStruct: BlockStruct = {
            transaction: tx,
            stateSnapshotHash: stateSnapshotHash,
            previousBlockHash: previousHash
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
        block: Block,
        stateSnapshot: StateSnapshot,
        successCallback: () => void,
        totalWithdrawals: BalanceStruct,
        exitChannelBlock?: ExitChannelBlockStruct
    ): Promise<void> {
        // this function is still incomplete and should be considered as TODO
        // will be done in follow up PRs (after https://github.com/peer3to/state-channels-plus/pull/130)

        // Store the block confirmation
        this.storage.blocks.storeBlock(block);
        this.storage.stateSnapshots.storeStateSnapshot(stateSnapshot);

        // Store exit channel blocks if present
        if (exitChannelBlock) {
            this.storage.exitChannelBlocks.storeExitChannelBlock(
                exitChannelBlock,
                totalWithdrawals
            );
        }

        successCallback();
        await this.onSuccessCommon();
    }

    private async notReady(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // TODO
        throw new Error("Not implemented");
    }

    private async disconnect(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // TODO
        throw new Error("Not implemented");
    }

    private async dispute(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // The fraud proof has already been stored by ValidationService
        // rest is left as TODO for now
        throw new Error("Not implemented");
    }

    private async broadcast(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // The block has already been stored by ValidationService with merged signatures
        // We would trigger P2P broadcast here: this.p2pManager.broadcastBlockConfirmation(blockConfirmation);
        // For now, this is left as TODO
        throw new Error("Not implemented");
    }

    private async notEnoughTime(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // No-op - abstain from applying/signing
        throw new Error("Not implemented");
    }

    private async duplicate(
        _blockConfirmation: BlockConfirmationStruct
    ): Promise<void> {
        // TODO
        throw new Error("Not implemented");
    }

    private shouldDisconnect(validationResult: BlockValidationResult): boolean {
        switch (validationResult) {
            case BlockValidationResult.SUCCESS:
                return false;
            case BlockValidationResult.NOT_READY:
                return false;
            case BlockValidationResult.DISCONNECT:
                return true;
            case BlockValidationResult.DISPUTE:
                return true;
            case BlockValidationResult.BROADCAST:
                return false;
            case BlockValidationResult.NOT_ENOUGH_TIME:
                return false;
            case BlockValidationResult.DUPLICATE:
                return false;
            default:
                return false;
        }
    }

    // ----- Event handlers -----
    public async onDisputeCommitted(
        dispute: DisputeStruct,
        timestamp: Timestamp
    ) {
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

import {
    TransactionStruct,
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import {
    AddressLike,
    BigNumberish,
    BytesLike,
    SignatureLike,
    ethers
} from "ethers";
import AgreementManager, { AgreementFlag } from "../AgreementManager";
import { AStateChannelManagerProxy } from "@typechain-types";
import {
    ProofStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/DisputeTypes";
import Clock from "@/Clock";
import DisputeHandler from "@/DisputeHandler";
import P2PManager from "@/P2PManager";

import AStateMachine from "@/AStateMachine";
import EvmUtils from "@/utils/EvmUtils";
import { ExecutionFlags, TimeConfig } from "@/DataTypes";
import StateChannelEventListener from "@/StateChannelEventListener";
import Mutex from "@/utils/Mutex";

import DebugProxy from "@/utils/DebugProxy";
import P2pEventHooks from "@/P2pEventHooks";
import * as validators from "@/utils/validators";
import {
    DecisionContext,
    processExecutionDecision
} from "./processExecutionDecisionHandlers";
import {
    ConfirmationDecisionContext,
    processConfirmationDecision
} from "./processConfirmationDecisionHandlers";

let DEBUG_STATE_MANAGER = false;
class StateManager {
    stateMachine: AStateMachine;
    p2pEventHooks: P2pEventHooks;
    signerAddress: AddressLike;
    agreementManager: AgreementManager;
    stateChannelEventListener: StateChannelEventListener;
    disputeHandler: DisputeHandler;
    stateChannelManagerContract: AStateChannelManagerProxy;
    p2pManager: P2PManager;
    timeConfig: TimeConfig;
    channelId: BytesLike = "0x00";
    mutex: Mutex = new Mutex();
    self = DEBUG_STATE_MANAGER ? DebugProxy.createProxy(this) : this;
    isDisposed: boolean = false;
    constructor(
        signer: ethers.Signer,
        signerAddress: AddressLike,
        stateChannelManagerContract: AStateChannelManagerProxy,
        stateMachine: AStateMachine,
        timeConfig: TimeConfig,
        p2pEventHooks: P2pEventHooks
    ) {
        this.signerAddress = signerAddress;
        this.stateMachine = stateMachine;
        this.p2pEventHooks = p2pEventHooks;
        this.timeConfig = timeConfig;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.stateChannelEventListener = new StateChannelEventListener(
            this.self,
            this.stateChannelManagerContract,
            this.p2pEventHooks
        );
        this.agreementManager = new AgreementManager();
        this.disputeHandler = new DisputeHandler(
            this.channelId,
            signer,
            signerAddress,
            this.agreementManager,
            this.stateChannelManagerContract,
            this.p2pEventHooks
        );
        this.p2pManager = new P2PManager(this.self, signer);
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
    public setChannelId(channelId: BytesLike) {
        this.channelId = channelId;
        this.disputeHandler.setChannelId(channelId);
        this.stateChannelEventListener.setChannelId(channelId);
    }
    public getChannelId(): BytesLike {
        return this.channelId;
    }
    public getSignerAddress(): AddressLike {
        return this.signerAddress;
    }
    public getParticipantsCurrent(): Promise<AddressLike[]> {
        //TODO? this can be done through the AgreementManager for the given fork or thought the stateMachine
        return this.stateMachine.getParticipants();
    }
    public getForkCnt(): number {
        return this.agreementManager.getLatestForkCnt();
    }
    public getNextTransactionCnt(): number {
        return this.agreementManager.getNextTransactionCnt();
    }
    //Triggered by the On-chain Event Listener when a dispute is emitted on-chain
    public onDisputeUpdate(dispute: DisputeStruct) {
        this.disputeHandler.onDispute(dispute);
        this.p2pEventHooks.onDisputeUpdate?.(dispute);
    }
    //Triggered by the On-chain Event Listener when block calldata is posted on-chain
    public collectOnChainBlock(
        signedBlock: SignedBlockStruct,
        timestamp: BigNumberish
    ) {
        console.log("StateManager - collectOnChainBlock");
        let flag = this.agreementManager.collectOnChainBlock(
            signedBlock,
            Number(timestamp)
        );
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        let disputeProof: ProofStruct;
        if (flag == AgreementFlag.DOUBLE_SIGN) {
            console.log("StateManager - collectOnChainBlock - double sign");
            disputeProof = this.disputeHandler.createDoubleSignProof([
                signedBlock
            ]);
            this.disputeHandler.createDispute(
                block.transaction.header.forkCnt,
                "0x00",
                0,
                [disputeProof]
            );
        } else if (flag == AgreementFlag.INCORRECT_DATA) {
            console.log("StateManager - collectOnChainBlock - incorrect data");
            disputeProof =
                this.disputeHandler.createIncorrectDataProof(signedBlock);
            this.disputeHandler.createDispute(
                block.transaction.header.forkCnt,
                "0x00",
                0,
                [disputeProof]
            );
        }
        console.log("StateManager - collectOnChainBlock - done");
        this.onSuccessCommon();
    }
    private async tryExecuteFromQueue() {
        let signedBlocks = this.agreementManager.tryDequeueBlocks(
            Number(this.getForkCnt()),
            Number(this.getNextTransactionCnt())
        );

        for (const signedBlock of signedBlocks) {
            console.log("tryExecuteFromQueue - executing");
            if (await this.onSignedBlock(signedBlock)) {
                break;
            }
        }
    }
    private async tryConfirmFromQueue(): Promise<void> {
        //TODO! race condition and skipping a txCount
        let confirmations = this.agreementManager.tryDequeueConfirmations(
            Number(this.getForkCnt()),
            Number(this.getNextTransactionCnt())
        );

        for (const confirmation of confirmations) {
            if (
                await this.onBlockConfirmation(
                    confirmation.originalSignedBlock,
                    confirmation.confirmationSignature as string
                )
            ) {
                break;
            }
        }
    }
    /**
     * Triggered by the On-chain Event Listener when a new state is set on-chain
     * @param encodedState - Encoded state of the state machine
     * @param _forkCnt - new fork count
     * @param _timestamp - on-chain timestamp
     */
    public async setState(
        encodedState: string,
        _forkCnt: BigNumberish,
        _timestamp: BigNumberish
    ): Promise<void> {
        console.log("StateManager - SetState", _forkCnt, _timestamp);
        await this.stateMachine.setState(encodedState);
        this.agreementManager.newFork(
            encodedState,
            await this.stateMachine.getParticipants(),
            Number(_forkCnt),
            Number(_timestamp)
        );

        //Try timeout next participant
        this.p2pEventHooks.onSetState?.();
        return this.onSuccessCommon();
    }

    // Passes the signedBlock through a verification pipeline and returns an execution flag based on the outcome
    public async onSignedBlock(
        signedBlock: SignedBlockStruct
    ): Promise<ExecutionFlags> {
        // Default everything to SUCCESS + no AgreementFlag
        let finalExecutionFlag: ExecutionFlags = ExecutionFlags.SUCCESS;
        let finalAgreementFlag: AgreementFlag | undefined = undefined;

        try {
            await this.mutex.lock();
            const result = await this.validateSignedBlock(signedBlock);

            finalExecutionFlag = result.flag;
            finalAgreementFlag = result.agreementFlag;

            return finalExecutionFlag;
        } finally {
            // Safety check: must have an execution flag
            if (finalExecutionFlag === undefined) {
                throw new Error(
                    "StateManager - onSignedBlock - Internal Error - flag undefined"
                );
            }

            // Process the final decision
            await this.processExecutionDecision(
                signedBlock,
                finalExecutionFlag,
                finalAgreementFlag
            );
            this.mutex.unlock();
        }
    }

    // Passes the block confirmation through a verification pipeline and returns an execution flag
    public async onBlockConfirmation(
        signedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ): Promise<ExecutionFlags> {
        let finalExecutionFlag: ExecutionFlags = ExecutionFlags.SUCCESS; // Default to SUCCESS

        try {
            const result = await this.validateBlockConfirmation(
                signedBlock,
                confirmationSignature
            );
            finalExecutionFlag = result.flag;

            if (result.success) {
                const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
                this.agreementManager.confirmBlock(
                    block,
                    confirmationSignature as SignatureLike
                );
            }

            return finalExecutionFlag;
        } finally {
            if (finalExecutionFlag === undefined) {
                throw new Error(
                    "StateManager - onBlockConfirmation - Internal Error - flag undefined"
                );
            }

            await this.processConfirmationDecision(
                signedBlock,
                confirmationSignature as SignatureLike,
                finalExecutionFlag
            );
        }
    }

    //Aplies a transaction to the state machine and returns the encoded state with a success callback
    public async applyTransaction(transaction: TransactionStruct): Promise<{
        success: boolean;
        encodedState: string;
        successCallback: () => void;
    }> {
        let { success, successCallback } =
            await this.stateMachine.stateTransition(transaction);
        return {
            success,
            encodedState: await this.stateMachine.getState(),
            successCallback
        };
    }

    // Used when authoring a block - Executes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<SignedBlockStruct> {
        await this.mutex.lock();

        try {
            console.log("Play Transaction", this.getForkCnt());
            this.ensureChannelIsOpen();
            await this.ensureItIsMyTurn();
            this.adjustTimestampIfNeeded(tx);

            const { previousStateHash, encodedState, successCallback } =
                await this.applyTransactionOrThrow(tx);

            const block = await this.createBlock(tx, previousStateHash);
            const signedBlock = await this.signBlock(block);

            this.agreementManager.addBlock(
                block,
                signedBlock.signature as SignatureLike,
                encodedState
            );

            successCallback();
            await this.onSuccessCommon();

            this.scheduleTask(
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
        block: BlockStruct,
        signedBlock: SignedBlockStruct
    ): Promise<void> {
        // If not everyone has signed, do the on-chain post
        if (!this.agreementManager.didEveryoneSignBlock(block)) {
            console.log("Posting calldata on chain!");
            this.p2pEventHooks.onPostingCalldata?.();
            this.stateChannelManagerContract
                .postBlockCalldata(signedBlock)
                .then((txResponse) => txResponse.wait())
                .catch((error) => {
                    console.log("Error posting block on chain", error);
                });
        }
    }

    // returns participants who haven't signed the block
    public async getParticipantsWhoHaventSignedBlock(
        block: BlockStruct
    ): Promise<AddressLike[]> {
        const signatures = this.agreementManager.getSigantures(block);
        const retrievedAddresses = signatures.map((signature) =>
            EvmUtils.retrieveSignerAddressBlock(block, signature)
        );
        const playerAddresses = await this.stateMachine.getParticipants();
        return playerAddresses.filter(
            (address) => !retrievedAddresses.includes(address.toString())
        );
    }

    public async getEncodedState(): Promise<string> {
        return await this.stateMachine.getState();
    }

    public async getEncodedStateKecak256(): Promise<string> {
        let encodedState = await this.getEncodedState();
        return ethers.keccak256(encodedState);
    }

    public async isValidBlock(
        signedBlock: SignedBlockStruct
    ): Promise<boolean> {
        let block: BlockStruct;
        //DECODE - CHECK
        try {
            block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

            if (block.transaction.header.channelId != this.getChannelId())
                return false;

            //SIGNATURE - CHECK
            let blockHash = ethers.keccak256(signedBlock.encodedBlock);
            let retrievedAddress = ethers.verifyMessage(
                ethers.getBytes(blockHash),
                signedBlock.signature as SignatureLike
            );
            if (retrievedAddress != block.transaction.header.participant)
                return false;

            return true;
        } catch (e) {
            return false;
        }
    }

    private checkSubjectiveBlockTiming(block: BlockStruct): ExecutionFlags {
        const myTime = BigInt(Clock.getTimeInSeconds());
        const blockTimestamp = BigInt(block.transaction.header.timestamp);

        // If the block is more than 5 seconds in the past (relative to local clock)
        if (blockTimestamp + BigInt(5) < myTime) {
            return ExecutionFlags.NOT_ENOUGH_TIME;
        }

        // If the block is more than 10 seconds in the future
        if (blockTimestamp - BigInt(10) > myTime) {
            // Create a dispute for a future timestamp
            return ExecutionFlags.DISPUTE;
        }

        // Otherwise, all good
        return ExecutionFlags.SUCCESS;
    }

    // Doesn't have to take into account chain time - since this is subjective
    // If chain time is triggered -> it becomes objective and goes through a different execution path
    public async isEnoughTimeToPlayMyTransactionSubjective(
        signedBlock: SignedBlockStruct
    ): Promise<ExecutionFlags> {
        //Has to use SignedBlock instead of Block - since Block may not be in agreement to fetch signature
        if (!(await this.isMyTurn())) return ExecutionFlags.SUCCESS;

        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        const flag = this.checkSubjectiveBlockTiming(block);
        if (flag == ExecutionFlags.DISPUTE) {
            const disputeProof =
                this.disputeHandler.createBlockTooFarInFutureProof(signedBlock);
            this.disputeHandler.createDispute(this.getForkCnt(), "0x00", 0, [
                disputeProof
            ]);
        }
        return flag;
    }
    // Checks does the block timestamp satisfy the invariant by taking into account on-chain calldata posted. This is used for the grant, but we have a better solution for the full feature set.
    public async isGoodTimestampNonDeterministic(
        block: BlockStruct
    ): Promise<boolean> {
        let timestamp = Number(block.transaction.header.timestamp);
        let lastTransactionTimestamp =
            this.agreementManager.getLatestBlockTimestamp(this.getForkCnt());

        let referenceTime = this.agreementManager.getLatestTimestamp(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (timestamp < lastTransactionTimestamp) {
            throw new Error("Not implemented");
        }
        if (timestamp > referenceTime + this.timeConfig.p2pTime) {
            let chainTimestamp = Number(
                await this.stateChannelManagerContract.getChainLatestBlockTimestamp(
                    this.channelId,
                    this.getForkCnt(),
                    block.transaction.header.transactionCnt
                )
            );
            if (chainTimestamp > referenceTime) referenceTime = chainTimestamp;

            if (timestamp > referenceTime + this.timeConfig.p2pTime) {
                return false; // Not Valid Timestamp - This subjective (non-deterministic) - may fail due to race condition on chain
            }
            return true;
        }
        return true;
    }

    // Tries to timeout a participant by checking did the participant fail to transition the state within time - if successful -> creates a dispute
    private async tryTimeoutParticipant(
        forkCnt: BigNumberish,
        transactionCnt: BigNumberish,
        participantAdr: AddressLike
    ) {
        if (participantAdr == this.signerAddress) return;
        let block = this.agreementManager.getBlock(
            Number(forkCnt),
            Number(transactionCnt)
        );
        if (block) {
            if (this.agreementManager.didEveryoneSignBlock(block)) return;
        }
        //if there is no block -> check if player posted on chain and try timeout
        if (
            this.agreementManager.didParticipantPostOnChain(
                Number(forkCnt),
                Number(transactionCnt),
                participantAdr
            )
        )
            return;
        if (
            Clock.getTimeInSeconds() <
            this.agreementManager.getChainLatestBlockTimestamp(
                Number(forkCnt),
                Number(transactionCnt)
            ) +
                this.getTimeoutWaitTimeSeconds()
        )
            return;
        let response = await this.stateChannelManagerContract.getBlockCallData(
            this.channelId,
            forkCnt,
            transactionCnt,
            participantAdr
        );
        if (response.found) return;
        //This should be enough since Clock should always lag behind DLT clock
        let delayTimeSeconds =
            this.getTimeoutWaitTimeSeconds() -
            (Clock.getTimeInSeconds() -
                this.agreementManager.getLatestBlockTimestamp(Number(forkCnt)));
        if (delayTimeSeconds < 0) {
            this.disputeHandler.createDispute(
                forkCnt,
                participantAdr,
                transactionCnt,
                []
            );
            console.log("Timeout participant!");
        } else {
            setTimeout(async () => {
                this.disputeHandler.createDispute(
                    forkCnt,
                    participantAdr,
                    transactionCnt,
                    []
                );
                console.log("Timeout participant! - delayed", delayTimeSeconds);
            }, delayTimeSeconds * 1000);
        }
    }

    private async onSuccessCommon() {
        // Immediately schedule a confirm/execute from queue on next tick
        this.scheduleTask(
            () => {
                this.tryConfirmFromQueue();
                this.tryExecuteFromQueue();
            },
            0,
            "queueProcessing"
        );

        // Identify the fork/tx counts for the next participant
        const forkCnt = this.getForkCnt();
        const nextTransactionCnt = this.getNextTransactionCnt();
        const nextToWrite = await this.stateMachine.getNextToWrite();

        // Notify any event hooks
        this.p2pEventHooks.onTurn?.(nextToWrite);

        // Schedule a timeout check for the next participant
        this.scheduleTask(
            () =>
                this.tryTimeoutParticipant(
                    forkCnt,
                    nextTransactionCnt,
                    nextToWrite
                ),
            this.getTimeoutWaitTimeSeconds() * 1000,
            "participantTimeout"
        );
    }
    // Helper function that takes appropriate action on the signed block based on the execution flag and agreement flag
    private async processExecutionDecision(
        signedBlock: SignedBlockStruct,
        executionFlag: ExecutionFlags,
        agreementFlag?: AgreementFlag
    ) {
        const context: DecisionContext = {
            p2pManager: this.p2pManager,
            agreementManager: this.agreementManager,
            disputeHandler: this.disputeHandler,
            onSuccessCb: this.onSuccessCommon.bind(this),
            forkCount: this.getForkCnt()
        };

        return processExecutionDecision(
            signedBlock,
            executionFlag,
            agreementFlag,
            context
        );
    }

    // Helper function that takes appropriate action on the block confirmation based on the execution flag and agreement flag
    private async processConfirmationDecision(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: SignatureLike,
        executionFlag: ExecutionFlags
    ) {
        // Build the context for the decision
        const ctx: ConfirmationDecisionContext = {
            isDisposed: this.isDisposed,
            tryConfirmFromQueue: this.tryConfirmFromQueue.bind(this),
            queueConfirmation:
                this.agreementManager.queueConfirmation.bind(this)
        };

        await processConfirmationDecision(
            originalSignedBlock,
            confirmationSignature,
            executionFlag,
            ctx
        );
    }

    private getTimeoutWaitTimeSeconds() {
        return (
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime
        );
    }

    private ensureChannelIsOpen(): void {
        if (this.getForkCnt() === -1) {
            throw new Error("Channel not opened");
        }
    }

    private async isMyTurn(): Promise<boolean> {
        const nextToWrite = await this.stateMachine.getNextToWrite();
        return this.signerAddress === nextToWrite;
    }

    private async ensureItIsMyTurn(): Promise<void> {
        const nextToWrite = await this.stateMachine.getNextToWrite();
        if (this.signerAddress !== nextToWrite) {
            throw new Error(
                `Not player turn - myAddress: ${this.signerAddress} - nextToWrite: ${nextToWrite}`
            );
        }
    }

    private adjustTimestampIfNeeded(tx: TransactionStruct): void {
        const latestBlockTimestamp =
            this.agreementManager.getLatestBlockTimestamp(this.getForkCnt());
        if (Number(tx.header.timestamp) < latestBlockTimestamp) {
            tx.header.timestamp = latestBlockTimestamp + 1;
        }
    }

    private async applyTransactionOrThrow(tx: TransactionStruct): Promise<{
        previousStateHash: string;
        encodedState: string;
        successCallback: () => void;
    }> {
        const previousStateHash = await this.getEncodedStateKecak256();
        const { success, encodedState, successCallback } =
            await this.applyTransaction(tx);

        if (!success) {
            throw new Error(
                "CreateAndApplyTransaction - Internal error - Transaction not successful"
            );
        }

        return { previousStateHash, encodedState, successCallback };
    }

    private async createBlock(
        tx: TransactionStruct,
        previousStateHash: string
    ): Promise<BlockStruct> {
        const currentStateHash = await this.getEncodedStateKecak256();

        return {
            transaction: tx,
            stateHash: currentStateHash,
            previousStateHash
        };
    }

    private async signBlock(block: BlockStruct): Promise<SignedBlockStruct> {
        return EvmUtils.signBlock(block, this.p2pManager.p2pSigner);
    }

    private scheduleTask(
        task: () => void | Promise<void>,
        delayMs: number,
        taskName: string = "unnamed"
    ): void {
        setTimeout(async () => {
            if (this.isDisposed) {
                console.log(
                    `Skipping ${taskName} task because StateManager is disposed`
                );
                return;
            }

            try {
                const result = task();
                if (result instanceof Promise) {
                    await result;
                }
            } catch (error) {
                console.error(
                    `Error executing scheduled task '${taskName}':`,
                    error
                );
            }
        }, delayMs);
    }

    private async validateSignedBlock(
        signedBlock: SignedBlockStruct
    ): Promise<validators.ValidationResult> {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        const readinessResult = await validators.isManagerReady(this);
        if (!readinessResult.success) return readinessResult;

        const blockValidityResult = await validators.isBlockValid(
            this,
            signedBlock
        );
        if (!blockValidityResult.success) return blockValidityResult;

        // Fork status checks
        const forkStatusResult = await validators.isBlockInCurrentFork(
            this,
            block
        );
        if (!forkStatusResult.success) return forkStatusResult;

        const forkDisputeResult = await validators.isForkDisputed(this, block);
        if (!forkDisputeResult.success) return forkDisputeResult;

        // Block checks
        const duplicateResult = await validators.isDuplicateBlock(this, block);
        if (!duplicateResult.success) return duplicateResult;

        const futureBlockResult = await validators.isBlockFuture(this, block);
        if (!futureBlockResult.success) return futureBlockResult;

        const participantResult = await validators.isParticipantInFork(
            this,
            block
        );
        if (!participantResult.success) return participantResult;

        const pastBlockResult = await validators.validatePastBlockInCurrentFork(
            this,
            signedBlock,
            block
        );
        if (!pastBlockResult.success) return pastBlockResult;

        // Timing and producer checks
        const timestampResult = await validators.isTimestampValid(this, block);
        if (!timestampResult.success) return timestampResult;

        const timePassedResult = await validators.hasEnoughTimePassed(
            this,
            signedBlock
        );
        if (!timePassedResult.success) return timePassedResult;

        const producerResult = await validators.isCorrectBlockProducer(
            this,
            block
        );
        if (!producerResult.success) return producerResult;

        // Finally, process the state transition
        return validators.processStateTransition(this, block, signedBlock);
    }

    private async validateBlockConfirmation(
        signedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ): Promise<validators.ValidationResult> {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        const readinessResult = await validators.isManagerReady(this);
        if (!readinessResult.success) return readinessResult;

        const blockValidityResult = await validators.isBlockValid(
            this,
            signedBlock
        );
        if (!blockValidityResult.success) return blockValidityResult;

        const forkStatusResult = await validators.isBlockInCurrentFork(
            this,
            block
        );
        if (!forkStatusResult.success) return forkStatusResult;

        const blockInChainResult = await validators.ensureBlockInChain(
            this,
            signedBlock,
            block
        );
        if (!blockInChainResult.success) return blockInChainResult;

        const confirmerResult = await validators.isConfirmerInFork(
            this,
            block,
            confirmationSignature
        );
        if (!confirmerResult.success) return confirmerResult;

        const duplicateSignatureResult =
            await validators.isDuplicateConfirmationSignature(
                this,
                block,
                confirmationSignature
            );
        if (!duplicateSignatureResult.success) return duplicateSignatureResult;

        return validators.success();
    }
}

export default StateManager;

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
import AgreementManager, { AgreementFlag } from "./AgreementManager";
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
// import dotenv from "dotenv";
import P2pEventHooks from "@/P2pEventHooks";

let DEBUG_STATE_MANAGER = false;
// dotenv.config();
// DEBUG_STATE_MANAGER = process.env.DEBUG_STATE_MANAGER === "true";
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
        return this.self;
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
    public async getParticipantsCurrent(): Promise<AddressLike[]> {
        //TODO? this can be done through the AgreementManager for the given fork or thought the stateMachine
        return await this.stateMachine.getParticipants();
    }
    public getForkCnt(): number {
        return this.agreementManager.getLatestForkCnt();
    }
    public getNextTransactionCnt(): number {
        return this.agreementManager.getNextTransactionCnt();
    }
    //Triggered by the On-chain Event Listener when a dispute is emitted on-chain
    public async onDisputeUpdate(dispute: DisputeStruct) {
        // console.log("StateManager - onDisputeUpdate", dispute);
        this.disputeHandler.onDispute(dispute);
        this.p2pEventHooks.onDisputeUpdate?.(dispute);
    }
    //Triggered by the On-chain Event Listener when block calldata is posted on-chain
    public async collectOnChainBlock(
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
        if (signedBlocks.length == 0) return;
        for (let signedBlock of signedBlocks) {
            console.log("tryExecuteFromQueue - executing");
            let flag = await this.onSignedBlock(signedBlock);
            if (flag == ExecutionFlags.DISPUTE) break; //will create new fork
        }
    }
    private async tryConfirmFromQueue() {
        //TODO! race condition and skipping a txCount
        let confirmations = this.agreementManager.tryDequeueConfirmations(
            Number(this.getForkCnt()),
            Number(this.getNextTransactionCnt())
        );
        if (confirmations.length == 0) return;
        for (let confirmation of confirmations) {
            let flag = await this.onBlockConfirmation(
                confirmation.originalSignedBlock,
                confirmation.confirmationSignature as string
            );
            if (flag == ExecutionFlags.DISPUTE) break; //TODO! - think about this
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
    ) {
        console.log("StateManager - SetState", _forkCnt, _timestamp);
        await this.stateMachine.setState(encodedState);
        this.agreementManager.newFork(
            encodedState,
            await this.stateMachine.getParticipants(),
            Number(_forkCnt),
            Number(_timestamp)
        );
        // let d = await this.stateChannelManagerContract.getDispute(
        //     this.channelId
        // );
        // console.log("SET STATE - Dispute:", d);
        //Try timeout next participant
        this.p2pEventHooks.onSetState?.();
        await this.onSuccessCommon();
    }

    // Passes the signedBlock through a verification pipeline and returns an execution flag based on the outcome
    public async onSignedBlock(
        signedBlock: SignedBlockStruct
    ): Promise<ExecutionFlags> {
        let executionFlag: ExecutionFlags | undefined;
        let agreementFlag: AgreementFlag | undefined;
        try {
            await this.mutex.lock();

            //Try and go down the happy path, if anything fails, final decision executed in the 'finaly' block of the try-catch

            if (this.getForkCnt() == -1) {
                executionFlag = ExecutionFlags.NOT_READY;
                return executionFlag;
            }
            //is a valid block
            if (!(await this.isValidBlock(signedBlock))) {
                executionFlag = ExecutionFlags.DISCONNECT;
                return executionFlag;
            }

            let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

            //Is past fork
            if (Number(block.transaction.header.forkCnt) < this.getForkCnt()) {
                executionFlag = ExecutionFlags.PAST_FORK;
                return executionFlag;
            }
            if (
                this.disputeHandler.isForkDisputed(
                    Number(block.transaction.header.forkCnt)
                )
            ) {
                executionFlag = ExecutionFlags.PAST_FORK; //Will be past fork -> no need to process it
                return executionFlag;
            }

            if (this.agreementManager.isBlockDuplicate(block)) {
                executionFlag = ExecutionFlags.DUPLICATE; //no error, just ignore
                return executionFlag;
            }

            //APPLY TO CURRENT STATE - CHECK
            //Is in the future
            if (
                Number(block.transaction.header.forkCnt) > this.getForkCnt() ||
                Number(block.transaction.header.transactionCnt) >
                this.getNextTransactionCnt()
            ) {
                //TODO! - fetch latest forkCnt from DLT to double check - this can be async since it's stored in the queue
                executionFlag = ExecutionFlags.NOT_READY;
                return executionFlag;
            }

            //Is participant part of the current fork
            if (
                !this.agreementManager.isParticipantInLatestFork(
                    block.transaction.header.participant
                )
            ) {
                executionFlag = ExecutionFlags.DISCONNECT;
                return executionFlag;
            }

            //Is in the past - current fork
            if (
                Number(block.transaction.header.transactionCnt) <
                this.getNextTransactionCnt()
            ) {
                agreementFlag = this.agreementManager.checkBlock(signedBlock);
                if (
                    agreementFlag == AgreementFlag.DOUBLE_SIGN ||
                    agreementFlag == AgreementFlag.INCORRECT_DATA
                ) {
                    executionFlag = ExecutionFlags.DISPUTE;
                    return executionFlag;
                }
                throw new Error(
                    "StateManager - OnSignedBlock - current fork in the past - INTERNAL ERROR"
                );
            }

            //TIMESTAMP - CHECK
            if (!this.isGoodTimestampNonDeterministic(block)) {
                //TODO! - think - this dispute is non deterministic - race condition can happen on-chain
                agreementFlag = AgreementFlag.INCORRECT_DATA; //timestamp
                executionFlag = ExecutionFlags.DISPUTE;
                return executionFlag;
            }

            executionFlag =
                await this.isEnoughTimeToPlayMyTransactionSubjective(
                    signedBlock
                );
            if (executionFlag != ExecutionFlags.SUCCESS) return executionFlag;

            //Is correct block producer
            if (
                block.transaction.header.participant !=
                (await this.stateMachine.getNextToWrite())
            ) {
                agreementFlag = AgreementFlag.INCORRECT_DATA;
                return ExecutionFlags.DISPUTE;
            }

            //CORRECT STATE TRANISITON - CHECK
            let previousStateHash = await this.getEncodedStateKecak256();
            let { success, encodedState, successCallback } =
                await this.applyTransaction(block.transaction);

            //Check execution and virtual vote
            if (
                !success ||
                ethers.keccak256(encodedState) != block.stateHash ||
                previousStateHash != block.previousStateHash
            ) {
                agreementFlag = AgreementFlag.INCORRECT_DATA;
                return ExecutionFlags.DISPUTE;
            }
            this.agreementManager.addBlock(
                block,
                signedBlock.signature as SignatureLike,
                encodedState
            );

            //If here - the happy path (SUCCESS) will fully execute
            setTimeout(async () => {
                if (this.isDisposed) return;
                successCallback();
            }, 0);
            return executionFlag;
        } catch (e) {
            throw e;
        } finally {
            if (executionFlag == undefined)
                throw new Error(
                    "StateManager - onSignedBlock - Internal Error - flag undefined"
                );
            // All execution paths eventually end up here for final processing on the action to take
            await this.processExecutionDecision(
                signedBlock,
                executionFlag,
                agreementFlag
            );
            this.mutex.unlock();
        }
    }
    // Passes the block confirmation through a verification pipeline and returns an execution flag based on the outcome
    public async onBlockConfirmation(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ): Promise<ExecutionFlags> {
        let executionFlag: ExecutionFlags | undefined;
        try {
            if (this.getForkCnt() == -1) {
                executionFlag = ExecutionFlags.NOT_READY;
                return ExecutionFlags.NOT_READY;
            }

            //Is a valid block or duplicate
            if (!(await this.isValidBlock(originalSignedBlock))) {
                executionFlag = ExecutionFlags.DISCONNECT;
                return executionFlag;
            }

            let block = EvmUtils.decodeBlock(originalSignedBlock.encodedBlock);

            //Is past fork
            if (Number(block.transaction.header.forkCnt) < this.getForkCnt()) {
                executionFlag = ExecutionFlags.PAST_FORK;
                return executionFlag;
            }

            if (!this.agreementManager.isBlockInChain(block)) {
                executionFlag = await this.onSignedBlock(originalSignedBlock);
                if (executionFlag == ExecutionFlags.DUPLICATE) {
                    if (this.agreementManager.isBlockInChain(block)) {
                        executionFlag = ExecutionFlags.SUCCESS;
                    } else {
                        executionFlag = ExecutionFlags.NOT_READY;
                    }
                }
                if (executionFlag != ExecutionFlags.SUCCESS)
                    return executionFlag;
            }
            //Block exists in canonical chain

            //Is confirmer part of the current fork
            let retrievedAddress = EvmUtils.retrieveSignerAddressBlock(
                block,
                confirmationSignature as SignatureLike
            );
            if (
                !this.agreementManager.isParticipantInLatestFork(
                    retrievedAddress
                )
            ) {
                executionFlag = ExecutionFlags.DISCONNECT;
                return executionFlag;
            }

            //DUPLICATE signature - CHECK
            if (
                this.agreementManager.doesSignatureExist(
                    block,
                    confirmationSignature as SignatureLike
                )
            ) {
                executionFlag = ExecutionFlags.DUPLICATE;
                return executionFlag;
            }
            this.agreementManager.confirmBlock(
                block,
                confirmationSignature as SignatureLike
            );
            executionFlag = ExecutionFlags.SUCCESS;
            return executionFlag;
        } catch (e) {
            throw e;
        } finally {
            if (executionFlag == undefined)
                throw new Error(
                    "StateManager - onBlockConfirmation - Internal Error - flag undefined"
                );
            this.processConfirmationDecision(
                originalSignedBlock,
                confirmationSignature as SignatureLike,
                executionFlag
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

    // Used when authoring a block - Ecxecutes the transaction and returns a signed block
    public async playTransaction(
        tx: TransactionStruct
    ): Promise<SignedBlockStruct> {
        try {
            await this.mutex.lock();
            console.log("Play Transaction", this.getForkCnt());
            if (this.getForkCnt() == -1) throw new Error("Channel not opened");
            let nextToWrite = await this.stateMachine.getNextToWrite();
            if (this.signerAddress != nextToWrite) {
                throw new Error(
                    `Not player turn - myAddress: ${this.signerAddress} - nextToWrite: ${nextToWrite}`
                );
            }

            let timestamp = Number(tx.header.timestamp);
            let latestBlockTimestamp =
                this.agreementManager.getLatestBlockTimestamp(
                    this.getForkCnt()
                );

            if (timestamp < latestBlockTimestamp)
                tx.header.timestamp = latestBlockTimestamp + 1;

            //Apply transaction
            let previousStateEncodedHash = await this.getEncodedStateKecak256();
            let { success, encodedState, successCallback } =
                await this.applyTransaction(tx);
            if (!success)
                throw new Error(
                    "CreateAndApplyTransaction - Internal error - Transaction not successful"
                );
            let block: BlockStruct = {
                transaction: tx,
                stateHash: await this.getEncodedStateKecak256(),
                previousStateHash: previousStateEncodedHash
            };
            let signedBlock = await EvmUtils.signBlock(
                block,
                this.p2pManager.p2pSigner
            );
            this.agreementManager.addBlock(
                block,
                signedBlock.signature as SignatureLike,
                encodedState
            );
            successCallback();
            await this.onSuccessCommon();
            //Set check if everyone signed my block
            setTimeout(async () => {
                if (this.isDisposed) return;
                if (!this.agreementManager.didEveryoneSignBlock(block)) {
                    //TODO! calculate who didn't sign so we stop signing their blocks
                    console.log("Posting calldata on chain!");
                    this.p2pEventHooks.onPostingCalldata?.();
                    try {
                        let txResponse =
                            await this.stateChannelManagerContract.postBlockCalldata(
                                signedBlock
                            );
                        let txReceipt = await txResponse.wait();
                    } catch (e) {
                        console.log("Error posting block on chain", e);
                    }
                    // console.log("Posted block on chain");
                }
                // console.log("Checking did others sign my block!");
            }, this.timeConfig.agreementTime * 1000);
            return signedBlock;
        } catch (e) {
            throw e;
        } finally {
            this.mutex.unlock();
        }
    }

    // returns participants who haven't signed the block
    public async getPlayersWhoHaventSignedBlock(
        block: BlockStruct
    ): Promise<AddressLike[]> {
        let signatures = this.agreementManager.getSigantures(block);
        let retrievedAddresses = signatures.map((signature) => {
            return EvmUtils.retrieveSignerAddressBlock(block, signature);
        });
        let playerAddresses = await this.stateMachine.getParticipants();
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

    private async isValidBlock(
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

    // Doesn't have to take into account chain time - since this is subjective
    // If chain time is triggered -> it becomes objective and goes through a different execution path
    private async isEnoughTimeToPlayMyTransactionSubjective(
        signedBlock: SignedBlockStruct
    ): Promise<ExecutionFlags> {
        //Has to use SignedBlock instead of Block - since Block may not be in agreement to fetch signature
        if (this.signerAddress != (await this.stateMachine.getNextToWrite()))
            return ExecutionFlags.SUCCESS;
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        let myTime = BigInt(Clock.getTimeInSeconds());
        let blockTimestamp = BigInt(block.transaction.header.timestamp);
        //agreementTime
        if (blockTimestamp + BigInt(5) < myTime)
            return ExecutionFlags.NOT_ENOUGH_TIME;
        //2*avgBlockTime
        if (blockTimestamp - BigInt(10) > myTime) {
            //TODO! - Dispute future timestamp
            //TODO! - Change this to executionFlags?
            let disputeProof =
                this.disputeHandler.createBlockTooFarInFutureProof(signedBlock);
            this.disputeHandler.createDispute(this.getForkCnt(), "0x00", 0, [
                disputeProof
                //TODO!!! - if this fails -> revert dispute side effects
            ]);
            return ExecutionFlags.DISPUTE;
        }
        return ExecutionFlags.SUCCESS;
    }
    // Checks does the block timestamp satisfy the invariant by taking into account on-chain calldata posted. This is used for the grant, but we have a better solution for the full feature set.
    private async isGoodTimestampNonDeterministic(
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
            return false; //Timestamp must be strictly increasing - Dispute BLOCK data not good
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
    private getTimeoutWaitTimeSeconds() {
        return (
            this.timeConfig.p2pTime +
            this.timeConfig.agreementTime +
            this.timeConfig.chainFallbackTime
        );
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
        setTimeout(async () => {
            if (this.isDisposed) return;
            this.tryConfirmFromQueue();
            this.tryExecuteFromQueue();
        }, 0);
        //Set try timeout next block
        let forkCnt = this.getForkCnt();
        let nextTransactionCnt = this.getNextTransactionCnt();
        let nextToWrite = await this.stateMachine.getNextToWrite();
        this.p2pEventHooks.onTurn?.(nextToWrite);
        setTimeout(async () => {
            if (this.isDisposed) return;
            this.tryTimeoutParticipant(
                forkCnt,
                nextTransactionCnt,
                nextToWrite
            );
        }, this.getTimeoutWaitTimeSeconds() * 1000);
    }
    // Helper function that takes appropriate action on the signed block based on the execution flag and agreement flag
    private async processExecutionDecision(
        signedBlock: SignedBlockStruct,
        executionFlag: ExecutionFlags,
        agreementFlag?: AgreementFlag
    ) {
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        switch (executionFlag) {
            case ExecutionFlags.SUCCESS:
                await this.p2pManager.p2pSigner.confirmBlock(signedBlock);
                await this.onSuccessCommon();
                break;
            case ExecutionFlags.NOT_READY:
                this.agreementManager.queueBlock(signedBlock);
                break;
            case ExecutionFlags.DUPLICATE:
                //nothing
                break;
            case ExecutionFlags.DISCONNECT:
                //TODO! - signal p2pManager (response)
                break;
            case ExecutionFlags.DISPUTE:
                switch (agreementFlag) {
                    case AgreementFlag.DOUBLE_SIGN:
                        this.disputeHandler.disputeDoubleSign([signedBlock]);
                        break;
                    case AgreementFlag.INCORRECT_DATA:
                        this.disputeHandler.disputeIncorrectData(signedBlock);
                        break;
                    default:
                        //None of the other cases should happen in this case
                        throw new Error(
                            `StateManager - processDecision - AgreementFlag ${agreementFlag} - Internal Error`
                        );
                }
                break;
            case ExecutionFlags.TIMESTAMP_IN_FUTURE:
                //TODO - try dispute?
                break;
            case ExecutionFlags.NOT_ENOUGH_TIME:
                //nothing - success path of previous block already initiated tryTimeout for this block
                break;
            case ExecutionFlags.PAST_FORK:
                //TODO - think about this - should this be a dispute or just ignore?
                break;
            default:
                throw new Error(
                    "StateManager - processDecision - Internal Error"
                );
        }
    }
    // Helper function that takes appropriate action on the block condirmation based on the execution flag and agreement flag
    private async processConfirmationDecision(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: SignatureLike,
        executionFlag: ExecutionFlags,
        agreementFlag?: AgreementFlag
    ) {
        let block = EvmUtils.decodeBlock(originalSignedBlock.encodedBlock);
        switch (executionFlag) {
            case ExecutionFlags.SUCCESS:
                setTimeout(async () => {
                    if (this.isDisposed) return;
                    this.tryConfirmFromQueue();
                }, 0);
                break;
            case ExecutionFlags.NOT_READY:
                this.agreementManager.queueConfirmation({
                    originalSignedBlock,
                    confirmationSignature
                });
                break;
            case ExecutionFlags.DUPLICATE:
                //nothing
                break;
            case ExecutionFlags.DISCONNECT:
                //TODO! - signal p2pManager (response)
                break;
            case ExecutionFlags.DISPUTE:
                //Nothing - done on the onSignedBlock level - no need to dispute confirmations
                break;
            case ExecutionFlags.TIMESTAMP_IN_FUTURE:
                //Nothing - done on the onSignedBlock level - no need to potentially dispute future timestamps here
                break;
            case ExecutionFlags.NOT_ENOUGH_TIME:
                //Nothing - done on the onSignedBlock level - no need to take any action here
                break;
            case ExecutionFlags.PAST_FORK:
                //TODO - think about this - should this be a dispute or just ignore?
                break;
            default:
                throw new Error(
                    "StateManager - processDecision - Internal Error"
                );
        }
    }
}

export default StateManager;

import { AddressLike, BigNumberish, BytesLike, ethers } from "ethers";
import AgreementManager from "./AgreementManager";
import { AStateChannelManagerProxy } from "@typechain-types";
import {
    ProofStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/DisputeTypes";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "@/utils/EvmUtils";
import DebugProxy from "@/utils/DebugProxy";
import P2pEventHooks from "@/P2pEventHooks";
import { retry } from "@/utils/retry";
import ProofManager from "./ProofManager";

let DEBUG_DISPUTE_HANDLER = true;

// Constants for commonly used values
const NO_PARTICIPANT_TO_FOLD = "0x00";
const INITIAL_TRANSACTION_COUNT = 0;

type ForkCnt = number;
class DisputeHandler {
    signer: ethers.Signer;
    signerAddress: AddressLike;
    agreementManager: AgreementManager;
    stateChannelManagerContract: AStateChannelManagerProxy;
    channelId: BytesLike;
    localProofs: Map<ForkCnt, ProofStruct[]> = new Map();
    disputes: Map<ForkCnt, DisputeStruct> = new Map();
    disputedForks: Map<ForkCnt, boolean> = new Map();
    p2pEventHooks: P2pEventHooks;
    self = DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    proofManager: ProofManager;

    constructor(
        channelId: BytesLike,
        signer: ethers.Signer,
        signerAddress: AddressLike,
        agreementManager: AgreementManager,
        stateChannelManagerContract: AStateChannelManagerProxy,
        p2pEventHooks: P2pEventHooks
    ) {
        this.channelId = channelId;
        this.signer = signer;
        this.signerAddress = signerAddress;
        this.agreementManager = agreementManager;
        this.stateChannelManagerContract = stateChannelManagerContract;
        this.p2pEventHooks = p2pEventHooks;
        this.proofManager = new ProofManager(agreementManager);
        return this.self;
    }

    public setP2pEventHooks(p2pEventHooks: P2pEventHooks): void {
        this.p2pEventHooks = p2pEventHooks;
    }

    public setChannelId(channelId: BytesLike): void {
        this.channelId = channelId;
    }
    public async disputeFoldRechallenge(
        forkCnt: BigNumberish,
        transactionCnt: BigNumberish
    ): Promise<void> {
        const proof = this.proofManager.createFoldRechallengeProof(
            forkCnt,
            transactionCnt
        );
        return proof
            ? this.createDispute(
                  forkCnt,
                  NO_PARTICIPANT_TO_FOLD,
                  INITIAL_TRANSACTION_COUNT,
                  [proof]
              )
            : undefined;
    }
    public async disputeDoubleSign(
        conflictingBlocks: SignedBlockStruct[]
    ): Promise<void> {
        const proof =
            this.proofManager.createDoubleSignProof(conflictingBlocks);
        const _firstBlock = EvmUtils.decodeBlock(
            conflictingBlocks[0].encodedBlock
        );
        return this.createDispute(
            _firstBlock.transaction.header.forkCnt,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    public async disputeIncorrectData(
        incorrectBlockSigned: SignedBlockStruct
    ): Promise<void> {
        const proof =
            this.proofManager.createIncorrectDataProof(incorrectBlockSigned);
        const _block = EvmUtils.decodeBlock(incorrectBlockSigned.encodedBlock);
        return this.createDispute(
            _block.transaction.header.forkCnt,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    // Not needed publicly - just internaly
    // public async disputeNewerState(
    //     forkCnt: number,
    //     participantAdr: AddressLike
    // ): Promise<void> {
    //     let proof = this.createNewerStateProof(forkCnt, participantAdr, );
    //     if (!proof) return;
    //     await this.createDispute(forkCnt, participantAdr, 0, [proof]);
    // }

    public async disputeFoldPriorBlock(
        forkCnt: BigNumberish,
        transactionCnt: number
    ): Promise<void> {
        const proof = ProofManager.createFoldPriorBlockProof(transactionCnt);
        return this.createDispute(
            forkCnt,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    public async disputeBlockTooFarInFuture(
        BlockSigned: SignedBlockStruct
    ): Promise<void> {
        const proof = ProofManager.createBlockTooFarInFutureProof(BlockSigned);
        const block = EvmUtils.decodeBlock(BlockSigned.encodedBlock);
        return this.createDispute(
            block.transaction.header.forkCnt,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    public onDispute(dispute: DisputeStruct): Promise<void> {
        this.setForkDisputed(Number(dispute.forkCnt));
        return this.rechallengeRecursive(dispute);
    }

    //Creates a dispute based on the generated proofs or optimistically timeouts (folds) the provided participant
    public async createDispute(
        forkCnt: BigNumberish,
        foldedParticipant: AddressLike,
        foldedTransactionCnt: BigNumberish,
        proofs: ProofStruct[]
    ): Promise<void> {
        if (foldedParticipant != NO_PARTICIPANT_TO_FOLD) {
            console.log("DisputeHandler - createDispute - Timeout");
        }

        const forkCntNumber = Number(forkCnt);
        //TODO! stop signing for the current fork
        this.setForkDisputed(forkCntNumber);
        proofs.forEach((proof) => this.addProof(forkCntNumber, proof));
        const _dispute = this.disputes.get(forkCntNumber);
        if (!_dispute) {
            await this.createNewDispute(
                forkCnt,
                foldedParticipant,
                foldedTransactionCnt,
                proofs
            );
        }

        const newDispute = await this.stateChannelManagerContract.getDispute(
            this.channelId
        );
        //TODO! check newDispute 0000 bytes
        if (newDispute.channelId == ethers.ZeroHash) {
            throw new Error(
                "DisputeHandler - createDispute - no dispute created"
            );
        }
        await this.rechallengeRecursive(newDispute);
    }

    private async createNewDispute(
        forkCnt: BigNumberish,
        foldedParticipant: AddressLike,
        foldedTransactionCnt: BigNumberish,
        proofs: ProofStruct[]
    ): Promise<void> {
        const {
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
            virtualVotingBlocks
        } = this.agreementManager.getFinalizedAndLatestWithVotes(
            forkCnt,
            this.signerAddress
        );

        this.p2pEventHooks.onInitiatingDispute?.();
        await retry(
            async () => {
                const txResponse =
                    await this.stateChannelManagerContract.createDispute(
                        this.channelId,
                        forkCnt,
                        encodedLatestFinalizedState,
                        encodedLatestCorrectState,
                        virtualVotingBlocks,
                        foldedParticipant,
                        foldedTransactionCnt,
                        proofs,
                        { gasLimit: 4000000 } //TODO! - gas limit
                    );
                console.log("TX HASH ##", txResponse.hash);
                const txReceipt = await txResponse.wait();
                console.log("DISPUTE CREATED ##", txReceipt);
                return txReceipt;
            },
            {
                maxRetries: 1, // Current implementation retries once
                onRetry: (attempt, error) => {
                    console.log("ERROR - DISPUTE CATCH ##", error);
                    console.log(
                        `Retrying dispute creation, attempt ${attempt}`
                    );
                }
            }
        );
    }

    public setForkDisputed(forkCnt: number): void {
        this.disputedForks.set(forkCnt, true);
    }
    public isForkDisputed(forkCnt: number): boolean {
        return this.disputedForks.get(forkCnt) ?? false;
    }
    private addProof(forkCnt: number, proof: ProofStruct): void {
        const proofs = this.localProofs.get(forkCnt) || [];
        proofs.push(proof);
        this.localProofs.set(forkCnt, proofs);
    }

    private shouldUpdateDispute(dispute: DisputeStruct): boolean {
        const forkCnt = Number(dispute.forkCnt);
        const existingDispute = this.disputes.get(forkCnt);

        return (
            !existingDispute ||
            dispute.challengeCnt > existingDispute.challengeCnt
        );
    }

    private updateDisputeIfNewer(dispute: DisputeStruct): boolean {
        if (this.shouldUpdateDispute(dispute)) {
            const forkCnt = Number(dispute.forkCnt);
            this.disputes.set(forkCnt, dispute);
            return true;
        }

        return false;
    }

    private async rechallengeRecursive(dispute: DisputeStruct): Promise<void> {
        if (!this.updateDisputeIfNewer(dispute)) {
            return; // Early return if we already have a newer dispute
        }

        //proofs
        const proofs = this.extractProofs(dispute);
        if (proofs.length == 0) return; //no proofs - no need to rechallenge
        try {
            const {
                encodedLatestFinalizedState,
                encodedLatestCorrectState,
                virtualVotingBlocks
            } = this.agreementManager.getFinalizedAndLatestWithVotes(
                dispute.forkCnt,
                this.signerAddress
            );
            this.p2pEventHooks.onInitiatingDispute?.();
            const _txReceipt = await this.stateChannelManagerContract
                .challengeDispute(
                    this.channelId,
                    dispute.forkCnt,
                    Number(dispute.challengeCnt) + 1,
                    proofs,
                    virtualVotingBlocks,
                    encodedLatestFinalizedState,
                    encodedLatestCorrectState,
                    { gasLimit: 2000000 } //TODO! - gas limit
                )
                .then((txResponse) => txResponse.wait());
        } catch (e) {
            // TODO! - in hardhat test network (unlike production networks) - on revert - there is no txReceipt -> it will throw and be caught here
        }
        const newDispute = await this.stateChannelManagerContract.getDispute(
            dispute.channelId
        );
        if (newDispute.challengeCnt == dispute.challengeCnt) {
            throw new Error(
                "DisputeHandler - rechallengeRecursive - challenge failed"
            );
        }
        return this.rechallengeRecursive(newDispute);
    }

    // Extracts dispute proofs to be tracked locally
    private extractProofs(dispute: DisputeStruct): ProofStruct[] {
        const forkCnt = Number(dispute.forkCnt);
        const transactionCnt = Number(dispute.foldedTransactionCnt);

        // Can challenge timeout?
        if (dispute.timedoutParticipant !== ethers.ZeroAddress) {
            const timeoutProof = this.proofManager.createFoldRechallengeProof(
                forkCnt,
                transactionCnt
            );
            if (timeoutProof) {
                this.addProof(forkCnt, timeoutProof);
            }
        }
        // Handle newer state proof
        const lastTransactionCnt = this.getLastTransactionCount(dispute);
        const newerStateProof = this.proofManager.createNewerStateProof(
            forkCnt,
            dispute.postedStateDisputer,
            lastTransactionCnt
        );

        if (newerStateProof) this.addProof(forkCnt, newerStateProof);

        // Return filtered proofs
        return this.filterProofs(dispute);
    }

    private getLastTransactionCount(dispute: DisputeStruct): number {
        if (dispute.virtualVotingBlocks.length === 0) return 0;

        // Extract from the last block
        const lastBlock = EvmUtils.decodeBlock(
            dispute.virtualVotingBlocks.at(-1)!.encodedBlock
        );
        return Number(lastBlock.transaction.header.transactionCnt);
    }

    // Filters valid proofs
    private filterProofs(dispute: DisputeStruct): ProofStruct[] {
        return ProofManager.filterValidProofs(
            dispute,
            this.localProofs.get(Number(dispute.forkCnt))
        );
    }
}

export default DisputeHandler;

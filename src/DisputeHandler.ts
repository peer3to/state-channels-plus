import { ethers } from "ethers";
import AgreementManager from "./agreementManager";
import { AStateChannelManagerProxy } from "@typechain-types";
import {
    ProofStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { DebugProxy, retry } from "@/utils";
import P2pEventHooks from "@/P2pEventHooks";
import ProofManager from "./ProofManager";
import { Address, BlockHeight, ChannelId, ForkId } from "./types/types";
import { Block } from "./models";

let DEBUG_DISPUTE_HANDLER = true;

// Constants for commonly used values
const NO_PARTICIPANT_TO_FOLD = "0x00";
const INITIAL_TRANSACTION_COUNT = 0;
class DisputeHandler {
    signer: ethers.Signer;
    signerAddress: Address;
    agreementManager: AgreementManager;
    stateChannelManagerContract: AStateChannelManagerProxy;
    channelId: ChannelId;
    localProofs: Map<ForkId, ProofStruct[]> = new Map();
    disputes: Map<ForkId, DisputeStruct> = new Map();
    disputedForks: Map<ForkId, boolean> = new Map();
    p2pEventHooks: P2pEventHooks;
    self = DEBUG_DISPUTE_HANDLER ? DebugProxy.createProxy(this) : this;
    proofManager: ProofManager;

    constructor(
        channelId: ChannelId,
        signer: ethers.Signer,
        signerAddress: Address,
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

    public setChannelId(channelId: ChannelId): void {
        this.channelId = channelId;
    }
    public async disputeFoldRechallenge(
        forkId: ForkId,
        transactionCnt: BlockHeight
    ): Promise<void> {
        const proof = this.proofManager.createFoldRechallengeProof(
            forkId,
            transactionCnt
        );
        return proof
            ? this.createDispute(
                  forkId,
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
        const _firstBlock = Block.decode(conflictingBlocks[0].encodedBlock);
        return this.createDispute(
            _firstBlock.forkId,
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
        const _block = Block.decode(incorrectBlockSigned.encodedBlock);
        return this.createDispute(
            _block.forkId,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    public async disputeFoldPriorBlock(
        forkId: ForkId,
        transactionCnt: BlockHeight
    ): Promise<void> {
        const proof = ProofManager.createFoldPriorBlockProof(transactionCnt);
        return this.createDispute(
            forkId,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    public async disputeBlockTooFarInFuture(
        BlockSigned: SignedBlockStruct
    ): Promise<void> {
        const proof = ProofManager.createBlockTooFarInFutureProof(BlockSigned);
        const block = Block.decode(BlockSigned.encodedBlock);
        return this.createDispute(
            block.forkId,
            NO_PARTICIPANT_TO_FOLD,
            INITIAL_TRANSACTION_COUNT,
            [proof]
        );
    }

    public onDispute(dispute: DisputeStruct): Promise<void> {
        this.setForkDisputed(dispute.forkId);
        return this.rechallengeRecursive(dispute);
    }

    //Creates a dispute based on the generated proofs or optimistically timeouts (folds) the provided participant
    public async createDispute(
        forkId: ForkId,
        foldedParticipant: Address,
        foldedTransactionCnt: BlockHeight,
        proofs: ProofStruct[]
    ): Promise<void> {
        if (foldedParticipant != NO_PARTICIPANT_TO_FOLD) {
            console.log("DisputeHandler - createDispute - Timeout");
        }

        //TODO! stop signing for the current fork
        this.setForkDisputed(forkId);
        proofs.forEach((proof) => this.addProof(forkId, proof));
        const _dispute = this.disputes.get(forkId);
        if (!_dispute) {
            await this.createNewDispute(
                forkId,
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
        forkId: ForkId,
        foldedParticipant: Address,
        foldedTransactionCnt: BlockHeight,
        proofs: ProofStruct[]
    ): Promise<void> {
        const {
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
            virtualVotingBlocks,
            milestoneProofs,
            milestoneSnapshots
        } = this.agreementManager.getFinalizedAndLatestWithMilestones(
            forkId,
            this.signerAddress
        );

        this.p2pEventHooks.onInitiatingDispute?.();
        await retry(
            async () => {
                const txResponse =
                    await this.stateChannelManagerContract.createDispute(
                        this.channelId,
                        forkId,
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

    public setForkDisputed(forkId: ForkId): void {
        this.disputedForks.set(forkId, true);
    }
    public isForkDisputed(forkId: ForkId): boolean {
        return this.disputedForks.get(forkId) ?? false;
    }
    private addProof(forkId: ForkId, proof: ProofStruct): void {
        const proofs = this.localProofs.get(forkId) || [];
        proofs.push(proof);
        this.localProofs.set(forkId, proofs);
    }

    private shouldUpdateDispute(dispute: DisputeStruct): boolean {
        const forkId = dispute.forkId;
        const existingDispute = this.disputes.get(forkId);

        return (
            !existingDispute ||
            dispute.challengeCnt > existingDispute.challengeCnt
        );
    }

    private updateDisputeIfNewer(dispute: DisputeStruct): boolean {
        if (this.shouldUpdateDispute(dispute)) {
            const forkId = dispute.forkId;
            this.disputes.set(forkId, dispute);
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
                virtualVotingBlocks,
                milestoneProofs,
                milestoneSnapshots
            } = this.agreementManager.getFinalizedAndLatestWithMilestones(
                dispute.forkId,
                this.signerAddress
            );
            this.p2pEventHooks.onInitiatingDispute?.();
            const _txReceipt = await this.stateChannelManagerContract
                .challengeDispute(
                    this.channelId,
                    dispute.forkId,
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
        const forkId = dispute.forkId;
        const transactionCnt = Number(dispute.foldedTransactionCnt);

        // Can challenge timeout?
        if (dispute.timedoutParticipant !== ethers.ZeroAddress) {
            const timeoutProof = this.proofManager.createFoldRechallengeProof(
                forkId,
                transactionCnt
            );
            if (timeoutProof) {
                this.addProof(forkId, timeoutProof);
            }
        }
        // Handle newer state proof
        const lastTransactionCnt = this.getLastTransactionCount(dispute);
        const newerStateProof = this.proofManager.createNewerStateProof(
            forkId,
            dispute.postedStateDisputer,
            lastTransactionCnt
        );

        if (newerStateProof) this.addProof(forkId, newerStateProof);

        // Return filtered proofs
        return this.filterProofs(dispute);
    }

    private getLastTransactionCount(dispute: DisputeStruct): BlockHeight {
        if (dispute.virtualVotingBlocks.length === 0) return 0;

        // Extract from the last block
        const lastBlock = Block.decode(
            dispute.virtualVotingBlocks.at(-1)!.encodedBlock
        );
        return lastBlock.height;
    }

    // Filters valid proofs
    private filterProofs(dispute: DisputeStruct): ProofStruct[] {
        return ProofManager.filterValidProofs(
            dispute,
            this.localProofs.get(dispute.forkId)
        );
    }
}

export default DisputeHandler;

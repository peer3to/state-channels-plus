import { AddressLike, SignatureLike } from "ethers";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockConfirmationStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { AgreementFlag } from "@/types";
import { Agreement, BlockConfirmation } from "./types";
import * as SetUtils from "@/utils/set";
import SignatureService from "./SignatureService";
import ForkService, { Direction } from "./ForkService";
import QueueService from "./QueueService";
import OnChainTracker from "./OnChainTracker";
import BlockValidator from "./BlockValidator";
import { Address, ForkId } from "@/types/types";
import { Block } from "@/Block";

class AgreementManager {
    forks = new ForkService();
    queues = new QueueService();
    chain = new OnChainTracker(
        this.forks,
        this.queues,
        /* temp stub - replaced in the constructor */ () => AgreementFlag.READY
    );
    validator = new BlockValidator(this.forks, this.queues, this.chain);

    constructor() {
        const blockChecker = this.validator.check.bind(this.validator);
        this.chain.setChecker(blockChecker);
    }

    // ************************************************
    // ***** Canonical chain operations - public ******
    // ************************************************
    public newFork(
        forkGenesisStateEncoded: string,
        addressesInThreshold: AddressLike[],
        forkId: ForkId,
        genesisTimestamp: number
    ) {
        this.forks.newFork(
            forkGenesisStateEncoded,
            addressesInThreshold,
            forkId,
            genesisTimestamp
        );
    }
    //After succesfull verification and execution
    public addBlock(
        block: Block,
        originalSignature: SignatureLike,
        encodedState: string
    ) {
        this.forks.addBlock(block, originalSignature, encodedState);
    }
    //Doesn't check signature - just stores it
    public confirmBlock(block: Block, confirmationSignature: SignatureLike) {
        const agreement = this.forks.agreementByBlock(block);
        if (!agreement)
            //should never trigger because of checks before confirming
            throw new Error(
                "AgreementManager - confirmBlock - block doesn't exist"
            );

        if (agreement.block.equals(block))
            throw new Error("AgreementManager - confirmBlock - conflict");

        if (
            SignatureService.doesSignatureExist(
                agreement,
                confirmationSignature
            )
        )
            throw new Error(
                "AgreementManager - confirmBlock - block already confirmed"
            );

        agreement.blockSignatures.push(confirmationSignature);
    }
    public getLatestforkId(): ForkId {
        return this.forks.latestforkId();
    }
    public getNextBlockHeight(): number {
        return this.forks.nextBlockHeight();
    }
    public getBlock(forkId: ForkId, transactionCnt: number): Block | undefined {
        return this.forks.agreement(forkId, transactionCnt)?.block;
    }
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        const block = Block.decode(signedBlock.encodedBlock);

        const agreement = this.forks.agreementByBlock(block);
        if (
            !agreement ||
            agreement.block.equals(block) ||
            agreement.block.author !== block.author
        ) {
            return undefined;
        }

        const { didSign, signature } = SignatureService.getParticipantSignature(
            agreement,
            block.author
        );

        return didSign
            ? {
                  encodedBlock: agreement.block.encode(),
                  signature: signature!.toString()
              }
            : undefined;
    }

    public getLatestSignedBlockByParticipant(
        forkId: ForkId,
        participantAdr: AddressLike
    ): { block: Block; signature: SignatureLike } | undefined {
        if (!this.forks.isValidforkId(forkId)) return undefined;

        for (const agreement of this.forks.agreementsIterator(
            forkId,
            Direction.BACKWARD
        )) {
            const { didSign, signature } =
                SignatureService.getParticipantSignature(
                    agreement,
                    participantAdr
                );

            if (didSign)
                return {
                    block: agreement.block,
                    signature: signature!
                };
        }
        return undefined;
    }
    public didEveryoneSignBlock(block: Block): boolean {
        const forkId = block.forkId;
        const fork = this.forks.forkAt(forkId);
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement || !fork || !agreement.block.equals(block)) return false;

        // Check if all threshold addresses have signed
        const signersSet = agreement.block.getSignersSet(
            agreement.blockSignatures
        );

        const addressesSet = SetUtils.stringSetFromArray(
            fork.addressesInThreshold
        );
        // All threshold addresses must be in the signers set
        return SetUtils.isSubset(addressesSet, signersSet);
    }
    public getSigantures(block: Block): SignatureLike[] {
        return this.forks.agreementByBlock(block)?.blockSignatures || [];
    }
    // Returns the signature of the block author
    public getOriginalSignature(block: Block): SignatureLike | undefined {
        const participant = block.author;

        const agreement = this.forks.agreementByBlock(block);
        if (!agreement) return undefined;

        const { didSign: _, signature } =
            SignatureService.getParticipantSignature(agreement, participant);

        return signature;
    }
    //Probably return boolean, error flag -> dipute
    public doesSignatureExist(block: Block, signature: SignatureLike): boolean {
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement) return false;

        if (!agreement.block.equals(block))
            throw new Error("AgreementManager - doesSignatureExist - conflict");

        return SignatureService.doesSignatureExist(agreement, signature);
    }

    public didParticipantSign(
        block: Block,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement || !agreement.block.equals(block))
            return { didSign: false, signature: undefined };

        return SignatureService.getParticipantSignature(agreement, participant);
    }

    public getParticipantsWhoHaventSignedBlock(block: Block): AddressLike[] {
        const forkId = block.forkId;
        const agreement = this.forks.agreementByBlock(block);
        const fork = this.forks.forkAt(forkId);
        if (!fork || !agreement) return [];

        return SignatureService.getParticipantsWhoDidntSign(fork, agreement);
    }

    public isParticipantInLatestFork(participant: AddressLike): boolean {
        const fork = this.forks.latestFork();
        if (!fork) return false;
        return new Set(fork.addressesInThreshold).has(participant);
    }

    public getEncodedState(
        forkId: ForkId,
        transactionCnt: number
    ): string | undefined {
        const agreement = this.forks.agreement(forkId, transactionCnt);
        return agreement?.encodedState;
    }
    public getForkGenesisStateEncoded(forkId: ForkId): string | undefined {
        const fork = this.forks.forkAt(forkId);
        return fork?.forkGenesisStateEncoded;
    }
    /**
     * Gets the latest finalized state (ecnoded) and the latest signed/confirmed state (encoded) from the signer with virtual votes proving it
     * @param forkId
     * @param signerAddress
     * @returns
     */
    public getFinalizedAndLatestWithVotes(
        forkId: ForkId,
        signerAddress: AddressLike
    ): {
        encodedLatestFinalizedState: string;
        encodedLatestCorrectState: string;
        virtualVotingBlocks: BlockConfirmationStruct[];
    } {
        const fork = this.forks.forkAt(forkId);
        if (!fork)
            throw new Error(
                "AgreementManager - getFinalizedAndLatestWithVotes - fork not found"
            );
        let encodedLatestFinalizedState: string | undefined;
        let encodedLatestCorrectState: string | undefined;
        let virtualVotingBlocks: BlockConfirmationStruct[] = [];
        let requiredSignatures = SetUtils.fromArray(fork.addressesInThreshold);

        for (const agreement of this.forks.agreementsIterator(
            forkId,
            Direction.BACKWARD
        )) {
            const signersAddresses = agreement.block.getSignersSet(
                agreement.blockSignatures
            );

            // Check if this block is signed by our target signer
            if (
                !encodedLatestCorrectState &&
                signersAddresses.has(signerAddress as Address)
            ) {
                encodedLatestCorrectState = agreement.encodedState;
            }

            if (!encodedLatestCorrectState) continue;

            const { originalSignature, confirmationSignatures } =
                this.separateSignatures(agreement);

            virtualVotingBlocks.unshift({
                signedBlock: {
                    encodedBlock: agreement.block.encode(),
                    signature: originalSignature as string
                },
                signatures: confirmationSignatures as string[]
            });

            // Remove the signers we found from required signatures
            requiredSignatures = SetUtils.difference(
                requiredSignatures,
                signersAddresses
            );

            // Check if we found a finalized state
            if (requiredSignatures.size === 0) {
                encodedLatestFinalizedState = agreement.encodedState;
                // found a finalized state - break the loop
                break;
            }
        }

        return {
            encodedLatestFinalizedState:
                encodedLatestFinalizedState ?? fork.forkGenesisStateEncoded,
            encodedLatestCorrectState:
                encodedLatestCorrectState ?? fork.forkGenesisStateEncoded,
            virtualVotingBlocks
        };
    }

    // *************************************************
    // * On-chain block collection operations - public *
    // *************************************************
    public collectOnChainBlock(
        signedBlock: SignedBlockStruct,
        timestamp: number
    ): AgreementFlag {
        return this.chain.collect(signedBlock, timestamp);
    }

    public getChainLatestBlockTimestamp(
        forkId: ForkId,
        maxTransactionCnt: number
    ): number {
        return this.chain.latestTimestamp(forkId, maxTransactionCnt);
    }

    public didParticipantPostOnChain(
        forkId: ForkId,
        transactionCnt: number,
        participantAddres: AddressLike
    ): boolean {
        return this.chain.hasPosted(forkId, transactionCnt, participantAddres);
    }

    public queueBlock(signedBlock: SignedBlockStruct) {
        this.queues.queueBlock(signedBlock);
    }
    public tryDequeueBlocks(
        forkId: ForkId,
        transactionCnt: number
    ): SignedBlockStruct[] {
        return this.queues.tryDequeueBlocks(forkId, transactionCnt);
    }

    public queueConfirmation(blockConfirmation: BlockConfirmation) {
        this.queues.queueConfirmation(blockConfirmation);
    }
    public tryDequeueConfirmations(
        forkId: ForkId,
        transactionCnt: number
    ): BlockConfirmation[] {
        return this.queues.tryDequeueConfirmations(forkId, transactionCnt);
    }

    // ************************************************
    // *************** Common helpers *****************
    // ************************************************

    /**
     * Separates the original author signature from confirmation signatures.
     * This works but isn't pretty - ideally agreement.block (or later, from storage module)
     * should be a SignedBlockStruct to allow clear separation between original/author signature
     * and the confirmation signatures.
     */
    private separateSignatures(agreement: Agreement): {
        originalSignature: SignatureLike;
        confirmationSignatures: SignatureLike[];
    } {
        const originalSignature = this.getOriginalSignature(agreement.block);
        if (!originalSignature) {
            throw new Error(
                "AgreementManager - separateSignatures - original signature not found"
            );
        }

        // Get all signatures except the author's signature
        const confirmationSignatures = agreement.blockSignatures.filter(
            (sig: SignatureLike) => {
                const { didSign } = agreement.block.getParticipantSignature(
                    agreement.block.author,
                    [sig]
                );
                return !didSign;
            }
        );

        return {
            originalSignature,
            confirmationSignatures
        };
    }

    //both canonical chain and future queue
    //both canonical chain and future queue
    public isBlockInChain(block: Block): boolean {
        return this.validator.isBlockInChain(block);
    }
    public isBlockDuplicate(block: Block): boolean {
        return this.validator.isBlockDuplicate(block);
    }
    public checkBlock(signedBlock: SignedBlockStruct): AgreementFlag {
        return this.validator.check(signedBlock);
    }
    public getLatestBlockTimestamp(forkId: ForkId): number {
        return this.validator.latestBlockTimestamp(forkId);
    }
    public getLatestTimestamp(forkId: ForkId, maxTxCnt: number): number {
        return this.validator.latestRelevantTimestamp(forkId, maxTxCnt);
    }

    public addDispute(dispute: DisputeStruct, timestamp: number): void {
        this.forks.addDispute(dispute, timestamp);
    }

    public confirmDispute(
        dispute: DisputeStruct,
        confirmationSignature: SignatureLike
    ): void {
        this.forks.addDisputeSignature(dispute, confirmationSignature);
    }

    public isDisputeKnown(dispute: DisputeStruct): boolean {
        return this.forks.isDisputeKnown(dispute);
    }

    public getDisputeSignatures(dispute: DisputeStruct): SignatureLike[] {
        return this.forks.getDisputeSignatures(dispute);
    }

    public hasParticipantSignedDispute(
        dispute: DisputeStruct,
        participant: AddressLike
    ): boolean {
        return this.forks.hasParticipantSignedDispute(dispute, participant);
    }
}

export default AgreementManager;

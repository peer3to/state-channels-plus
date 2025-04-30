import { AddressLike, BigNumberish, SignatureLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct,
    ConfirmedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockUtils, EvmUtils } from "@/utils";
import { AgreementFlag } from "@/types";
import { BlockConfirmation } from "./types";
import * as SetUtils from "@/utils/set";
import SignatureService from "./SignatureService";
import ForkService, { Direction } from "./ForkService";
import QueueService from "./QueueService";
import OnChainTracker from "./OnChainTracker";
import BlockValidator from "./BlockValidator";

class AgreementManager {
    forkService = new ForkService();
    queueService = new QueueService();
    chainTracker = new OnChainTracker(
        this.forkService,
        this.queueService,
        /* temp stub - replaced in the constructor */ () => AgreementFlag.READY
    );
    blockValidator = new BlockValidator(
        this.forkService,
        this.queueService,
        this.chainTracker
    );

    constructor() {
        const blockChecker = this.blockValidator.check.bind(
            this.blockValidator
        );
        this.chainTracker.setChecker(blockChecker);
    }

    // ************************************************
    // ***** Canonical chain operations - public ******
    // ************************************************
    public newFork(
        forkGenesisStateEncoded: string,
        addressesInThreshold: AddressLike[],
        forkCnt: number,
        genesisTimestamp: number
    ) {
        this.forkService.newFork(
            forkGenesisStateEncoded,
            addressesInThreshold,
            forkCnt,
            genesisTimestamp
        );
    }
    //After succesfull verification and execution
    public addBlock(
        block: BlockStruct,
        originalSignature: SignatureLike,
        encodedState: string
    ) {
        this.forkService.addBlock(block, originalSignature, encodedState);
    }
    //Doesn't check signature - just stores it
    public confirmBlock(
        block: BlockStruct,
        confirmationSignature: SignatureLike
    ) {
        const agreement = this.forkService.getAgreementByBlock(block);
        if (!agreement)
            //should never trigger because of checks before confirming
            throw new Error(
                "AgreementManager - confirmBlock - block doesn't exist"
            );

        if (!BlockUtils.areBlocksEqual(agreement.block, block))
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
    public getLatestForkCnt(): number {
        return this.forkService.getLatestForkCnt();
    }
    public getNextBlockHeight(): number {
        return this.forkService.getNextBlockHeight();
    }
    public getBlock(
        forkCnt: number,
        transactionCnt: number
    ): BlockStruct | undefined {
        return this.forkService.getAgreement(forkCnt, transactionCnt)?.block;
    }
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        const agreement = this.forkService.getAgreementByBlock(block);
        if (
            !agreement ||
            BlockUtils.areBlocksEqual(agreement.block, block) ||
            BlockUtils.getBlockAuthor(agreement.block) !==
                BlockUtils.getBlockAuthor(block)
        ) {
            return undefined;
        }

        const { didSign, signature } = BlockUtils.getParticipantSignature(
            agreement.block,
            agreement.blockSignatures,
            BlockUtils.getBlockAuthor(block)
        );

        return didSign
            ? {
                  encodedBlock: EvmUtils.encodeBlock(agreement.block),
                  signature: signature!.toString()
              }
            : undefined;
    }

    public getLatestSignedBlockByParticipant(
        forkCnt: number,
        participantAdr: AddressLike
    ): { block: BlockStruct; signature: SignatureLike } | undefined {
        if (!this.forkService.isValidForkCnt(forkCnt)) return undefined;

        for (const agreement of this.forkService.agreementsIterator(
            forkCnt,
            Direction.BACKWARD
        )) {
            const { didSign, signature } = BlockUtils.getParticipantSignature(
                agreement.block,
                agreement.blockSignatures,
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
    public didEveryoneSignBlock(block: BlockStruct): boolean {
        const forkCnt = BlockUtils.getFork(block);
        const fork = this.forkService.getFork(forkCnt);
        const agreement = this.forkService.getAgreementByBlock(block);

        if (
            !agreement ||
            !fork ||
            !BlockUtils.areBlocksEqual(agreement.block, block)
        )
            return false;

        // Check if all threshold addresses have signed
        const signersSet = BlockUtils.getSignerAddresses(
            block,
            agreement.blockSignatures
        );

        const addressesSet = SetUtils.stringSetFromArray(
            fork.addressesInThreshold
        );
        // All threshold addresses must be in the signers set
        return SetUtils.isSubset(addressesSet, signersSet);
    }
    public getSigantures(block: BlockStruct): SignatureLike[] {
        return (
            this.forkService.getAgreementByBlock(block)?.blockSignatures || []
        );
    }
    // Returns the signature of the block author
    public getOriginalSignature(block: BlockStruct): SignatureLike | undefined {
        const participant = BlockUtils.getBlockAuthor(block);

        const agreement = this.forkService.getAgreementByBlock(block);
        if (!agreement) return undefined;

        const { didSign: _, signature } = BlockUtils.getParticipantSignature(
            agreement.block,
            agreement.blockSignatures,
            participant
        );

        return signature;
    }
    //Probably return boolean, error flag -> dipute
    public doesSignatureExist(
        block: BlockStruct,
        signature: SignatureLike
    ): boolean {
        const agreement = this.forkService.getAgreementByBlock(block);

        if (!agreement) return false;

        if (!BlockUtils.areBlocksEqual(agreement.block, block))
            throw new Error("AgreementManager - doesSignatureExist - conflict");

        return SignatureService.doesSignatureExist(agreement, signature);
    }

    public didParticipantSign(
        block: BlockStruct,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const agreement = this.forkService.getAgreementByBlock(block);

        if (!agreement || !BlockUtils.areBlocksEqual(agreement.block, block))
            return { didSign: false, signature: undefined };

        return BlockUtils.getParticipantSignature(
            agreement.block,
            agreement.blockSignatures,
            participant
        );
    }

    public getParticipantsWhoHaventSignedBlock(
        block: BlockStruct
    ): AddressLike[] {
        const forkCnt = BlockUtils.getFork(block);
        const agreement = this.forkService.getAgreementByBlock(block);
        const fork = this.forkService.getFork(forkCnt);
        if (!fork || !agreement) return [];

        return SignatureService.getParticipantsWhoDidntSign(fork, agreement);
    }

    public isParticipantInLatestFork(participant: AddressLike): boolean {
        const fork = this.forkService.getLatestFork();
        if (!fork) return false;
        return new Set(fork.addressesInThreshold).has(participant);
    }

    public getEncodedState(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        const agreement = this.forkService.getAgreement(
            forkCnt,
            transactionCnt
        );
        return agreement?.encodedState;
    }
    public getForkGenesisStateEncoded(forkCnt: number): string | undefined {
        const fork = this.forkService.getFork(forkCnt);
        return fork?.forkGenesisStateEncoded;
    }
    /**
     * Gets the latest finalized state (ecnoded) and the latest signed/confirmed state (encoded) from the signer with virtual votes proving it
     * @param forkCnt
     * @param signerAddress
     * @returns
     */
    public getFinalizedAndLatestWithVotes(
        forkCnt: BigNumberish,
        signerAddress: AddressLike
    ): {
        encodedLatestFinalizedState: string;
        encodedLatestCorrectState: string;
        virtualVotingBlocks: ConfirmedBlockStruct[];
    } {
        const fork = this.forkService.getFork(Number(forkCnt));
        if (!fork)
            throw new Error(
                "AgreementManager - getFinalizedAndLatestWithVotes - fork not found"
            );
        let encodedLatestFinalizedState: string | undefined;
        let encodedLatestCorrectState: string | undefined;
        let virtualVotingBlocks: ConfirmedBlockStruct[] = [];
        let requiredSignatures = SetUtils.fromArray(fork.addressesInThreshold);

        for (const agreement of this.forkService.agreementsIterator(
            forkCnt as number,
            Direction.BACKWARD
        )) {
            const signersAddresses = BlockUtils.getSignerAddresses(
                agreement.block,
                agreement.blockSignatures
            ) as Set<AddressLike>;

            // Check if this block is signed by our target signer
            if (
                !encodedLatestCorrectState &&
                signersAddresses.has(signerAddress)
            ) {
                encodedLatestCorrectState = agreement.encodedState;
            }

            if (!encodedLatestCorrectState) continue;

            virtualVotingBlocks.unshift({
                encodedBlock: EvmUtils.encodeBlock(agreement.block),
                signatures: agreement.blockSignatures as string[]
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
        return this.chainTracker.collect(signedBlock, timestamp);
    }

    public getChainLatestBlockTimestamp(
        forkCnt: number,
        maxTransactionCnt: number
    ): number {
        return this.chainTracker.latestTimestamp(forkCnt, maxTransactionCnt);
    }

    public didParticipantPostOnChain(
        forkCnt: number,
        transactionCnt: number,
        participantAddres: AddressLike
    ): boolean {
        return this.chainTracker.hasPosted(
            forkCnt,
            transactionCnt,
            participantAddres
        );
    }

    public queueBlock(signedBlock: SignedBlockStruct) {
        this.queueService.queueBlock(signedBlock);
    }
    public tryDequeueBlocks(
        forkCnt: number,
        transactionCnt: number
    ): SignedBlockStruct[] {
        return this.queueService.tryDequeueBlocks(forkCnt, transactionCnt);
    }

    public queueConfirmation(blockConfirmation: BlockConfirmation) {
        this.queueService.queueConfirmation(blockConfirmation);
    }
    public tryDequeueConfirmations(
        forkCnt: number,
        transactionCnt: number
    ): BlockConfirmation[] {
        return this.queueService.tryDequeueConfirmations(
            forkCnt,
            transactionCnt
        );
    }

    // ************************************************
    // *************** Common helpers *****************
    // ************************************************

    //both canonical chain and future queue
    //both canonical chain and future queue
    public isBlockInChain(block: BlockStruct): boolean {
        return this.blockValidator.isBlockInChain(block);
    }
    public isBlockDuplicate(block: BlockStruct): boolean {
        return this.blockValidator.isBlockDuplicate(block);
    }
    public checkBlock(signedBlock: SignedBlockStruct): AgreementFlag {
        return this.blockValidator.check(signedBlock);
    }
    public getLatestBlockTimestamp(forkCnt: number): number {
        return this.blockValidator.latestBlockTimestamp(forkCnt);
    }
    public getLatestTimestamp(forkCnt: number, maxTxCnt: number): number {
        return this.blockValidator.latestRelevantTimestamp(forkCnt, maxTxCnt);
    }
}

export default AgreementManager;

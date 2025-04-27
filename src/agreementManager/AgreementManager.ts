import { AddressLike, BigNumberish, SignatureLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct,
    ConfirmedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "../utils/EvmUtils";
import {
    forkOf,
    participantOf,
    getParticipantSignature,
    getSignerAddresses,
    isSameBlock
} from "@/utils";
import { AgreementFlag } from "@/types";
import { BlockConfirmation } from "./types";
import * as SetUtils from "@/utils/set";
import SignatureService from "./SignatureService";
import ForkService, { Direction } from "./ForkService";
import QueueService from "./QueueService";
import OnChainTracker from "./OnChainTracker";
import BlockValidator from "./BlockValidator";

class AgreementManager {
    forks = new ForkService();
    queues = new QueueService();
    chain = new OnChainTracker(
        this.forks,
        this.queues,
        /* temp stub */ () => AgreementFlag.READY
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
        forkCnt: number,
        genesisTimestamp: number
    ) {
        this.forks.newFork(
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
        this.forks.addBlock(block, originalSignature, encodedState);
    }
    //Doesn't check signature - just stores it
    public confirmBlock(
        block: BlockStruct,
        confirmationSignature: SignatureLike
    ) {
        const agreement = this.forks.agreementByBlock(block);
        if (!agreement)
            //should never trigger because of checks before confirming
            throw new Error(
                "AgreementManager - confirmBlock - block doesn't exist"
            );

        if (!isSameBlock(agreement.block, block))
            throw new Error("AgreementManager - confirmBlock - conflict");

        if (SignatureService.signatureExists(agreement, confirmationSignature))
            throw new Error(
                "AgreementManager - confirmBlock - block already confirmed"
            );

        agreement.blockSignatures.push(confirmationSignature);
    }
    public getLatestForkCnt(): number {
        return this.forks.latestForkCnt();
    }
    public getNextBlockHeight(): number {
        return this.forks.nextBlockHeight();
    }
    public getBlock(
        forkCnt: number,
        transactionCnt: number
    ): BlockStruct | undefined {
        return this.forks.agreement(forkCnt, transactionCnt)?.block;
    }
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        const agreement = this.forks.agreementByBlock(block);
        if (
            !agreement ||
            isSameBlock(agreement.block, block) ||
            participantOf(agreement.block) !== participantOf(block)
        ) {
            return undefined;
        }

        const { didSign, signature } = getParticipantSignature(
            agreement.block,
            agreement.blockSignatures,
            participantOf(block)
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
        if (!this.forks.isValidForkCnt(forkCnt)) return undefined;

        for (const agreement of this.forks.agreementsIterator(
            forkCnt,
            Direction.BACKWARD
        )) {
            const { didSign, signature } = getParticipantSignature(
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
        const forkCnt = forkOf(block);
        const fork = this.forks.forkAt(forkCnt);
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement || !fork || !isSameBlock(agreement.block, block))
            return false;

        // Check if all threshold addresses have signed
        const signersSet = getSignerAddresses(block, agreement.blockSignatures);

        const addressesSet = SetUtils.stringSetFromArray(
            fork.addressesInThreshold
        );
        // All threshold addresses must be in the signers set
        return SetUtils.isSubset(addressesSet, signersSet);
    }
    public getSigantures(block: BlockStruct): SignatureLike[] {
        return this.forks.agreementByBlock(block)?.blockSignatures || [];
    }
    // Returns the signature of the block author
    public getOriginalSignature(block: BlockStruct): SignatureLike | undefined {
        const participant = participantOf(block);

        const agreement = this.forks.agreementByBlock(block);
        if (!agreement) return undefined;

        const { didSign: _, signature } = getParticipantSignature(
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
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement) return false;

        if (!isSameBlock(agreement.block, block))
            throw new Error("AgreementManager - doesSignatureExist - conflict");

        return SignatureService.signatureExists(agreement, signature);
    }

    public didParticipantSign(
        block: BlockStruct,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement || !isSameBlock(agreement.block, block))
            return { didSign: false, signature: undefined };

        return getParticipantSignature(
            agreement.block,
            agreement.blockSignatures,
            participant
        );
    }

    public getParticipantsWhoHaventSignedBlock(
        block: BlockStruct
    ): AddressLike[] {
        const forkCnt = forkOf(block);
        const agreement = this.forks.agreementByBlock(block);
        const fork = this.forks.forkAt(forkCnt);
        if (!fork || !agreement) return [];

        return SignatureService.missingParticipants(fork, agreement);
    }

    public isParticipantInLatestFork(participant: AddressLike): boolean {
        const fork = this.forks.latestFork();
        if (!fork) return false;
        return new Set(fork.addressesInThreshold).has(participant);
    }

    public getEncodedState(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        const agreement = this.forks.agreement(forkCnt, transactionCnt);
        return agreement?.encodedState;
    }
    public getForkGenesisStateEncoded(forkCnt: number): string | undefined {
        const fork = this.forks.forkAt(forkCnt);
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
        const fork = this.forks.forkAt(Number(forkCnt));
        if (!fork)
            throw new Error(
                "AgreementManager - getFinalizedAndLatestWithVotes - fork not found"
            );
        let encodedLatestFinalizedState: string | undefined;
        let encodedLatestCorrectState: string | undefined;
        let virtualVotingBlocks: ConfirmedBlockStruct[] = [];
        let requiredSignatures = SetUtils.fromArray(fork.addressesInThreshold);

        for (const agreement of this.forks.agreementsIterator(
            forkCnt as number,
            Direction.BACKWARD
        )) {
            const signersAddresses = getSignerAddresses(
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
        return this.chain.collect(signedBlock, timestamp);
    }

    public getChainLatestBlockTimestamp(
        forkCnt: number,
        maxTransactionCnt: number
    ): number {
        return this.chain.latestTimestamp(forkCnt, maxTransactionCnt);
    }

    public didParticipantPostOnChain(
        forkCnt: number,
        transactionCnt: number,
        participantAddres: AddressLike
    ): boolean {
        return this.chain.hasPosted(forkCnt, transactionCnt, participantAddres);
    }

    public queueBlock(signedBlock: SignedBlockStruct) {
        this.queues.queueBlock(signedBlock);
    }
    public tryDequeueBlocks(
        forkCnt: number,
        transactionCnt: number
    ): SignedBlockStruct[] {
        return this.queues.tryDequeueBlocks(forkCnt, transactionCnt);
    }

    public queueConfirmation(blockConfirmation: BlockConfirmation) {
        this.queues.queueConfirmation(blockConfirmation);
    }
    public tryDequeueConfirmations(
        forkCnt: number,
        transactionCnt: number
    ): BlockConfirmation[] {
        return this.queues.tryDequeueConfirmations(forkCnt, transactionCnt);
    }

    // ************************************************
    // *************** Common helpers *****************
    // ************************************************

    //both canonical chain and future queue
    //both canonical chain and future queue
    public isBlockInChain(block: BlockStruct): boolean {
        return this.validator.isBlockInChain(block);
    }
    public isBlockDuplicate(block: BlockStruct): boolean {
        return this.validator.isBlockDuplicate(block);
    }
    public checkBlock(signedBlock: SignedBlockStruct): AgreementFlag {
        return this.validator.check(signedBlock);
    }
    public getLatestBlockTimestamp(forkCnt: number): number {
        return this.validator.latestBlockTimestamp(forkCnt);
    }
    public getLatestTimestamp(forkCnt: number, maxTxCnt: number): number {
        return this.validator.latestRelevantTimestamp(forkCnt, maxTxCnt);
    }
}

export default AgreementManager;

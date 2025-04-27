import { AddressLike, BigNumberish, SignatureLike, ethers } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct,
    ConfirmedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "../utils/EvmUtils";
import {
    coordinatesOf,
    forkOf,
    participantOf,
    timestampOf
} from "../utils/BlockUtils";
import { AgreementFlag } from "@/types";
import { AgreementFork, Agreement, BlockConfirmation } from "./types";
import * as SetUtils from "@/utils/set";
import { getParticipantSignature, getSignerAddresses } from "@/utils/signature";
import SignatureService from "./SignatureService";
import ForkService, { Direction } from "./ForkService";

type ForkCnt = number;
type TransactionCnt = number;
type ParticipantAdr = string;
class AgreementManager {
    forks = new ForkService();
    blockNotReadyMap: Map<
        ForkCnt,
        Map<TransactionCnt, Map<ParticipantAdr, SignedBlockStruct>>
    > = new Map(); //map[forkCnt][transactionCnt][participantAdr] = SignedBlockStruct
    confirmationNotReadyMap: Map<
        ForkCnt,
        Map<TransactionCnt, Map<ParticipantAdr, BlockConfirmation>>
    > = new Map(); //map[forkCnt][transactionCnt][confirmationSigner] = BlockConfirmation

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

        if (!this.areBlocksEqual(agreement.block, block))
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
            this.areBlocksEqual(agreement.block, block) ||
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

        if (!agreement || !fork || !this.areBlocksEqual(agreement.block, block))
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

        if (!this.areBlocksEqual(agreement.block, block))
            throw new Error("AgreementManager - doesSignatureExist - conflict");

        return SignatureService.signatureExists(agreement, signature);
    }

    public didParticipantSign(
        block: BlockStruct,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const agreement = this.forks.agreementByBlock(block);

        if (!agreement || !this.areBlocksEqual(agreement.block, block))
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
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        const { forkCnt, height } = coordinatesOf(block);
        const participant = participantOf(block);

        //Resolved? -  also have to prevent duplicates in queue(map) - queue map can't have duplicates, it can only be overwritten wtih a different block for the same [forkCnt,transactionCnt,participantAdr] - in that case checkBlock returns a dispute flag
        const flag = this.checkBlock(signedBlock);
        if (
            flag === AgreementFlag.INVALID_SIGNATURE ||
            flag === AgreementFlag.INCORRECT_DATA ||
            flag === AgreementFlag.DOUBLE_SIGN
        )
            return flag;

        if (flag === AgreementFlag.READY || flag === AgreementFlag.NOT_READY)
            this.queueBlock(signedBlock);

        //Resolved - duplicates can be added - can bloat state
        if (this.didParticipantPostOnChain(forkCnt, height, participant))
            return flag;

        this.forks.addChainBlock(forkCnt, height, participant, timestamp);

        return flag;
    }
    public getChainLatestBlockTimestamp(
        forkCnt: number,
        maxTransactionCnt: number
    ): number {
        const fork = this.forks.forkAt(forkCnt);
        if (!fork)
            throw new Error(
                "AgreementManager - getChainLatestBlockTimestamp - fork not found"
            );
        let latestTimestamp = 0;
        for (let chainBlock of fork.chainBlocks) {
            if (chainBlock.transactionCnt > maxTransactionCnt) continue;
            if (chainBlock.timestamp > latestTimestamp)
                latestTimestamp = chainBlock.timestamp;
        }
        return latestTimestamp;
    }
    public didParticipantPostOnChain(
        forkCnt: number,
        transactionCnt: number,
        participantAddres: AddressLike
    ): boolean {
        const fork = this.forks.forkAt(forkCnt);
        if (!fork)
            throw new Error(
                "AgreementManager - didParticipantPostOnChain - fork not found"
            );
        for (let block of fork.chainBlocks) {
            if (
                block.transactionCnt == transactionCnt &&
                block.participantAdr == participantAddres
            )
                return true;
        }
        return false;
    }

    // ************************************************
    // **** Future blocks queue (map) operations - ****
    // ************************************************

    public queueBlock(signedBlock: SignedBlockStruct) {
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        let forkCnt = Number(block.transaction.header.forkCnt);
        let transactionCnt = Number(block.transaction.header.transactionCnt);
        let participantAdr = block.transaction.header.participant;
        if (!this.blockNotReadyMap.has(forkCnt))
            this.blockNotReadyMap.set(forkCnt, new Map());
        if (!this.blockNotReadyMap.get(forkCnt)!.has(transactionCnt))
            this.blockNotReadyMap.get(forkCnt)!.set(transactionCnt, new Map());
        this.blockNotReadyMap
            .get(forkCnt)!
            .get(transactionCnt)!
            .set(participantAdr as string, signedBlock);
    }
    public tryDequeueBlocks(
        forkCnt: number,
        transactionCnt: number
    ): SignedBlockStruct[] {
        if (!this.blockNotReadyMap.has(forkCnt)) return [];
        if (!this.blockNotReadyMap.get(forkCnt)!.has(transactionCnt)) return [];
        let blocks = this.blockNotReadyMap.get(forkCnt)!.get(transactionCnt)!;
        let signedBlocks: SignedBlockStruct[] = [];
        for (let block of blocks.values()) {
            signedBlocks.push(block);
        }
        this.blockNotReadyMap.get(forkCnt)!.delete(transactionCnt);
        return signedBlocks;
    }

    public queueConfirmation(blockConfirmation: BlockConfirmation) {
        let block = EvmUtils.decodeBlock(
            blockConfirmation.originalSignedBlock.encodedBlock
        );
        let forkCnt = Number(block.transaction.header.forkCnt);
        let transactionCnt = Number(block.transaction.header.transactionCnt);
        let confirmationSigner = EvmUtils.retrieveSignerAddressBlock(
            block,
            blockConfirmation.confirmationSignature
        );
        //TODO!!! - since this is in the future, we can't know who's part of the channel - somone can bloat state, so spam has to be handeled in the p2pManager
        if (!this.confirmationNotReadyMap.has(forkCnt))
            this.confirmationNotReadyMap.set(forkCnt, new Map());
        if (!this.confirmationNotReadyMap.get(forkCnt)!.has(transactionCnt))
            this.confirmationNotReadyMap
                .get(forkCnt)!
                .set(transactionCnt, new Map());
        this.confirmationNotReadyMap
            .get(forkCnt)!
            .get(transactionCnt)!
            .set(confirmationSigner as string, blockConfirmation);
    }
    public tryDequeueConfirmations(
        forkCnt: number,
        transactionCnt: number
    ): BlockConfirmation[] {
        if (!this.confirmationNotReadyMap.has(forkCnt)) return [];
        if (!this.confirmationNotReadyMap.get(forkCnt)!.has(transactionCnt))
            return [];
        let confirmations = this.confirmationNotReadyMap
            .get(forkCnt)!
            .get(transactionCnt)!;
        let blockConfirmations: BlockConfirmation[] = [];
        for (let confirmation of confirmations.values()) {
            blockConfirmations.push(confirmation);
        }
        this.confirmationNotReadyMap.get(forkCnt)!.delete(transactionCnt);
        return blockConfirmations;
    }

    // ************************************************
    // *************** Common helpers *****************
    // ************************************************

    //both canonical chain and future queue
    public isBlockInChain(block: BlockStruct): boolean {
        const agreement = this.forks.agreementByBlock(block);
        return (
            (agreement || false) && this.areBlocksEqual(agreement.block, block)
        );
    }
    public isBlockDuplicate(block: BlockStruct): boolean {
        if (this.isBlockInChain(block)) return true;

        let forkCnt = Number(block.transaction.header.forkCnt);
        let transactionCnt = Number(block.transaction.header.transactionCnt);
        let participantAdr = block.transaction.header.participant as string;
        if (
            this.blockNotReadyMap.has(forkCnt) &&
            this.blockNotReadyMap.get(forkCnt)!.has(transactionCnt) &&
            this.blockNotReadyMap
                .get(forkCnt)!
                .get(transactionCnt)!
                .has(participantAdr)
        ) {
            if (
                EvmUtils.encodeBlock(block) ==
                this.blockNotReadyMap
                    .get(forkCnt)!
                    .get(transactionCnt)!
                    .get(participantAdr)!.encodedBlock
            )
                return true;
        }
        return false;
    }
    public checkBlock(signedBlock: SignedBlockStruct): AgreementFlag {
        // Decode block and validate basic properties
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        const retrievedAddress = EvmUtils.retrieveSignerAddressBlock(
            block,
            signedBlock.signature as SignatureLike
        );
        const { forkCnt, height } = coordinatesOf(block);
        const participantAdr = block.transaction.header.participant;

        // Check if the signature is valid
        if (retrievedAddress != participantAdr) {
            return AgreementFlag.INVALID_SIGNATURE;
        }

        // Check if the block is a duplicate
        if (this.isBlockDuplicate(block)) {
            return AgreementFlag.DUPLICATE;
        }

        // Check if the fork count is valid
        if (!this.forks.isValidForkCnt(forkCnt)) {
            return AgreementFlag.NOT_READY;
        }

        // Check if this block already exists
        const existingBlock = this.getBlock(forkCnt, height);
        if (existingBlock) {
            // Check for double signing or conflict with existing block
            return existingBlock.transaction.header.participant ===
                participantAdr
                ? AgreementFlag.DOUBLE_SIGN
                : AgreementFlag.INCORRECT_DATA;
        }

        // Special case for the first block in a fork
        if (height === 0) {
            const expectedPreviousHash = ethers.keccak256(
                this.forks.forkAt(forkCnt)?.forkGenesisStateEncoded ?? ""
            );
            return block.previousStateHash === expectedPreviousHash
                ? AgreementFlag.READY
                : AgreementFlag.INCORRECT_DATA;
        }

        // For non-first blocks, check if the previous block exists and hash matches
        const previousBlock = this.getBlock(forkCnt, height - 1);
        if (previousBlock) {
            return previousBlock.stateHash === block.previousStateHash
                ? AgreementFlag.READY
                : AgreementFlag.INCORRECT_DATA;
        }

        // If no previous block exists but we expect one, the block is not ready
        return AgreementFlag.NOT_READY;
    }
    public getLatestBlockTimestamp(forkCnt: number): number {
        const fork = this.forks.forkAt(forkCnt);
        if (!fork)
            throw new Error(
                "AgreementManager - getLatestBlockTimestamp - fork not found"
            );
        let genesisTimestamp = fork.genesisTimestamp;
        let latestBlockTimestamp = Number(
            this.forks.latestAgreement(forkCnt)?.block.transaction.header
                .timestamp ?? 0
        );
        return Math.max(genesisTimestamp, latestBlockTimestamp);
    }
    public getLatestTimestamp(forkCnt: number, maxTxCnt: number): number {
        let latestBlockTimestamp = this.getLatestBlockTimestamp(forkCnt);
        let latestChainTimestamp = this.getChainLatestBlockTimestamp(
            forkCnt,
            maxTxCnt
        );
        return Math.max(latestBlockTimestamp, latestChainTimestamp);
    }

    // ************************************************
    // ********** Private validation helpers **********
    // ************************************************

    private areBlocksEqual(block1: BlockStruct, block2: BlockStruct): boolean {
        return EvmUtils.encodeBlock(block1) === EvmUtils.encodeBlock(block2);
    }
}

export default AgreementManager;

import { AddressLike, BigNumberish, SignatureLike, ethers } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct,
    ConfirmedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "../utils/EvmUtils";
import { coordinatesOf, forkOf } from "../utils/BlockUtils";
import { AgreementFlag } from "@/types";
import { AgreementFork, Agreement, BlockConfirmation } from "./types";
import * as SetUtils from "@/utils/set";

type ForkCnt = number;
type TransactionCnt = number;
type ParticipantAdr = string;
class AgreementManager {
    forks: AgreementFork[] = [];
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
        if (this.forks.length != forkCnt) return;
        this.forks.push({
            forkGenesisStateEncoded: forkGenesisStateEncoded,
            addressesInThreshold,
            genesisTimestamp: genesisTimestamp,
            chainBlocks: [],
            agreements: []
        });
    }
    //After succesfull verification and execution
    public addBlock(
        block: BlockStruct,
        originalSignature: SignatureLike,
        encodedState: string
    ) {
        const forkCnt = forkOf(block);

        if (!this.isValidForkCnt(forkCnt))
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - forkCnt is not correct"
            );

        const agreement = this.getAgreementByBlock(block);
        if (agreement)
            // this should never happen since checks are done before
            throw new Error(
                "AgreementManager - addBlock - double sign or incorrect data"
            );

        this.forks[forkCnt].agreements.push({
            block: block,
            blockSignatures: [originalSignature],
            encodedState: encodedState
        });
    }
    //Doesn't check signature - just stores it
    public confirmBlock(
        block: BlockStruct,
        confirmationSignature: SignatureLike
    ) {
        const agreement = this.getAgreementByBlock(block);
        if (!agreement)
            //should never trigger because of checks before confirming
            throw new Error(
                "AgreementManager - confirmBlock - block doesn't exist"
            );

        if (!this.areBlocksEqual(agreement.block, block))
            throw new Error("AgreementManager - confirmBlock - conflict");

        if (this.signatureExistsInAgreement(agreement, confirmationSignature))
            throw new Error(
                "AgreementManager - confirmBlock - block already confirmed"
            );

        agreement.blockSignatures.push(confirmationSignature);
    }
    public getLatestForkCnt(): number {
        return this.forks.length - 1;
    }
    public getNextBlockHeight(): number {
        if (this.forks.length == 0) return 0;
        return this.forks[this.forks.length - 1].agreements.length;
    }
    public getBlock(
        forkCnt: number,
        transactionCnt: number
    ): BlockStruct | undefined {
        return this.getAgreement(forkCnt, transactionCnt)?.block;
    }
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        const participant = block.transaction.header.participant;

        const agreement = this.getAgreementByBlock(block);
        if (
            !agreement ||
            this.areBlocksEqual(agreement.block, block) ||
            agreement.block.transaction.header.participant !== participant
        ) {
            return undefined;
        }

        const { didSign, signature } = this.getParticipantSignature(
            agreement,
            participant
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
        if (!this.isValidForkCnt(forkCnt)) return undefined;

        for (let i = this.forks[forkCnt].agreements.length - 1; i >= 0; i--) {
            const agreement = this.forks[forkCnt].agreements[i];
            const { didSign, signature } = this.getParticipantSignature(
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
    public didEveryoneSignBlock(block: BlockStruct): boolean {
        const forkCnt = forkOf(block);

        if (!this.isValidForkCnt(forkCnt)) return false;

        const fork = this.forks[forkCnt];
        const agreement = this.getAgreementByBlock(block);

        if (!agreement || !this.areBlocksEqual(agreement.block, block))
            return false;

        // Check if all threshold addresses have signed
        const signerAddresses = agreement.blockSignatures.map((signature) =>
            EvmUtils.retrieveSignerAddressBlock(block, signature).toString()
        );
        const signersSet = SetUtils.fromArray(signerAddresses);
        const addressesSet = SetUtils.stringSetFromArray(
            fork.addressesInThreshold
        );
        // All threshold addresses must be in the signers set
        return SetUtils.isSubset(addressesSet, signersSet);
    }
    public getSigantures(block: BlockStruct): SignatureLike[] {
        return this.getAgreementByBlock(block)?.blockSignatures || [];
    }
    // Returns the signature of the block author
    public getOriginalSignature(block: BlockStruct): SignatureLike | undefined {
        const participant = block.transaction.header.participant;

        const agreement = this.getAgreementByBlock(block);
        if (!agreement) return undefined;

        const { didSign: _, signature } = this.getParticipantSignature(
            agreement,
            participant
        );

        return signature;
    }
    //Probably return boolean, error flag -> dipute
    public doesSignatureExist(
        block: BlockStruct,
        signature: SignatureLike
    ): boolean {
        const agreement = this.getAgreementByBlock(block);

        if (!agreement) return false;

        if (!this.areBlocksEqual(agreement.block, block))
            throw new Error("AgreementManager - doesSignatureExist - conflict");

        return this.signatureExistsInAgreement(agreement, signature);
    }

    public didParticipantSign(
        block: BlockStruct,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const agreement = this.getAgreementByBlock(block);

        if (!agreement || !this.areBlocksEqual(agreement.block, block))
            return { didSign: false, signature: undefined };

        return this.getParticipantSignature(agreement, participant);
    }

    public getParticipantsWhoHaventSignedBlock(
        block: BlockStruct
    ): AddressLike[] {
        const forkCnt = forkOf(block);
        if (!this.isValidForkCnt(forkCnt)) return [];

        const signatures = this.getSigantures(block);
        const signersSet = SetUtils.stringSetFromArray(
            signatures.map((signature) =>
                EvmUtils.retrieveSignerAddressBlock(block, signature)
            )
        );

        const fork = this.forks[forkCnt];
        return SetUtils.excludeFromArray(fork.addressesInThreshold, signersSet);
    }

    public isParticipantInLatestFork(participant: AddressLike): boolean {
        const fork = this.forks[this.forks.length - 1];
        return new Set(fork.addressesInThreshold).has(participant);
    }

    public getEncodedState(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        return this.getAgreement(forkCnt, transactionCnt)?.encodedState;
    }
    public getForkGenesisStateEncoded(forkCnt: number): string | undefined {
        if (!this.isValidForkCnt(forkCnt)) return undefined;
        return this.forks[forkCnt].forkGenesisStateEncoded;
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
        const fork = this.forks[Number(forkCnt)];

        let encodedLatestFinalizedState: string | undefined;
        let encodedLatestCorrectState: string | undefined;
        let virtualVotingBlocks: ConfirmedBlockStruct[] = [];
        let requiredSignatures = SetUtils.fromArray(fork.addressesInThreshold);

        for (let i = fork.agreements.length - 1; i >= 0; i--) {
            const agreement = fork.agreements[i];
            const signersAddresses = this.extractSignerAddresses(agreement);

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

    private extractSignerAddresses(agreement: Agreement): Set<AddressLike> {
        return new Set(
            agreement.blockSignatures.map(
                (signature) =>
                    EvmUtils.retrieveSignerAddressBlock(
                        agreement.block,
                        signature
                    ) as AddressLike
            )
        );
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
        if (
            this.didParticipantPostOnChain(
                forkCnt,
                height,
                block.transaction.header.participant
            )
        )
            return flag;

        const fork = this.forks[forkCnt];
        fork.chainBlocks.push({
            transactionCnt: height,
            participantAdr: block.transaction.header.participant,
            timestamp
        });

        return flag;
    }
    public getChainLatestBlockTimestamp(
        forkCnt: number,
        maxTransactionCnt: number
    ): number {
        let fork = this.forks[Number(forkCnt)];
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
        if (forkCnt >= this.forks.length) return false;
        for (let block of this.forks[forkCnt].chainBlocks) {
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

    private getLatestAgreement(forkCnt: number): Agreement | undefined {
        if (forkCnt >= this.forks.length) return undefined;
        return this.forks[forkCnt].agreements[
            this.forks[forkCnt].agreements.length - 1
        ];
    }
    //both canonical chain and future queue
    public isBlockInChain(block: BlockStruct): boolean {
        const agreement = this.getAgreementByBlock(block);
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
        if (!this.isValidForkCnt(forkCnt)) {
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
                this.forks[forkCnt].forkGenesisStateEncoded
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
        let fork = this.forks[Number(forkCnt)];
        let genesisTimestamp = fork.genesisTimestamp;
        let latestBlockTimestamp = Number(
            this.getLatestAgreement(forkCnt)?.block.transaction.header
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

    private isValidForkCnt(forkCnt: number): boolean {
        return forkCnt < this.forks.length;
    }

    private getAgreement(
        forkCnt: number,
        transactionCnt: number
    ): Agreement | undefined {
        if (!this.isValidForkCnt(forkCnt)) return undefined;

        const fork = this.forks[forkCnt];
        if (transactionCnt >= fork.agreements.length) return undefined;

        return fork.agreements[transactionCnt];
    }

    private getAgreementByBlock(block: BlockStruct): Agreement | undefined {
        const { forkCnt, height } = coordinatesOf(block);
        return this.getAgreement(forkCnt, height);
    }

    private areBlocksEqual(block1: BlockStruct, block2: BlockStruct): boolean {
        return EvmUtils.encodeBlock(block1) === EvmUtils.encodeBlock(block2);
    }

    private signatureExistsInAgreement(
        agreement: Agreement,
        signature: SignatureLike
    ): boolean {
        return agreement.blockSignatures.includes(signature);
    }

    private getParticipantSignature(
        agreement: Agreement,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        for (const signature of agreement.blockSignatures) {
            if (
                EvmUtils.retrieveSignerAddressBlock(
                    agreement.block,
                    signature
                ) == participant
            ) {
                return { didSign: true, signature };
            }
        }
        return { didSign: false, signature: undefined };
    }
}

export default AgreementManager;

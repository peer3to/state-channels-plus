import { AddressLike, BigNumberish, SignatureLike, ethers } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct,
    ConfirmedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "./utils/EvmUtils";
// A fork is created by a DLT by disputing someone or asking the DLT to enforce a state.
// The user initiating the process submits:
// 1) Last known state with full threshold signatures
// 2) The signed transactions starting from 1) up until the last known transaction which response the participant signed
// 3) What they're disputing or enforcing

export enum AgreementFlag {
    INVALID_SIGNATURE,
    READY,
    DUPLICATE,
    INCORRECT_DATA,
    DOUBLE_SIGN,
    NOT_READY
}

//The DLT can set any reality and those realites are forks - the users follow the state machine set by the latest fork
type AgreementFork = {
    forkGenesisStateEncoded: string; //genesis state (encoded) of the fork
    addressesInThreshold: AddressLike[]; //The addresses that are in the threshold
    genesisTimestamp: number; //timestamp of the first block in the fork
    chainBlocks: ChainBlocks[]; //Blocks that are posted on chain for the fork
    agreements: Agreement[]; //The agreements that are part of the fork - total order
};

type Agreement = {
    block: BlockStruct;
    blockSignatures: SignatureLike[];
    encodedState: string;
};
type ChainBlocks = {
    transactionCnt: number;
    participantAdr: AddressLike;
    timestamp: number;
};
type BlockConfirmation = {
    originalSignedBlock: SignedBlockStruct;
    confirmationSignature: SignatureLike;
};
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
        if (Number(block.transaction.header.forkCnt) >= this.forks.length)
            throw new Error(
                "AgreementManager - addBlock - forkCnt is not correct"
            ); // this should never happen since checks are done before
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (agreement)
            throw new Error(
                "AgreementManager - addBlock - double sign or incorrect data"
            ); // this should never happen since checks are done before

        this.forks[Number(block.transaction.header.forkCnt)].agreements.push({
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
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement)
            throw new Error(
                "AgreementManager - confirmBlock - block doesn't exist"
            ); //should never trigger because of checks before confirming
        if (
            EvmUtils.encodeBlock(agreement.block) != EvmUtils.encodeBlock(block)
        )
            throw new Error("AgreementManager - confirmBlock - conflict"); //should never trigger because of checks before confirming

        if (this.doesSignatureExist(block, confirmationSignature))
            throw new Error(
                "AgreementManager - confirmBlock - block already confirmed"
            ); //should never trigger because of checks before confirming
        agreement.blockSignatures.push(confirmationSignature);
    }
    public getLatestForkCnt(): number {
        return this.forks.length - 1;
    }
    public getNextTransactionCnt(): number {
        if (this.forks.length == 0) return 0;
        return this.forks[this.forks.length - 1].agreements.length;
    }
    public getBlock(
        forkCnt: number,
        transactionCnt: number
    ): BlockStruct | undefined {
        let agreement = this.getAgreement(forkCnt, transactionCnt);
        if (!agreement) return undefined;
        return agreement.block;
    }
    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement) return undefined;
        if (
            EvmUtils.encodeBlock(agreement.block) !=
            EvmUtils.encodeBlock(block) &&
            agreement.block.transaction.header.participant ==
            block.transaction.header.participant
        ) {
            let { didSign, siganture } = this.didParticipantSign(
                agreement.block,
                block.transaction.header.participant
            );
            if (didSign)
                return {
                    encodedBlock: EvmUtils.encodeBlock(agreement.block),
                    signature: siganture!.toString()
                };
        }
        return undefined;
    }
    public getLatestSignedBlockByParticipant(
        forkCnt: number,
        participantAdr: AddressLike
    ): { block: BlockStruct; signature: SignatureLike } | undefined {
        if (forkCnt >= this.forks.length) return undefined;
        for (let i = this.forks[forkCnt].agreements.length - 1; i >= 0; i--) {
            let agreement = this.forks[forkCnt].agreements[i];
            let didSign = this.didParticipantSign(
                agreement.block,
                participantAdr
            );
            if (didSign.didSign)
                return {
                    block: agreement.block,
                    signature: didSign.siganture!
                };
        }
        return undefined;
    }
    public didEveryoneSignBlock(block: BlockStruct): boolean {
        let fork = this.forks[Number(block.transaction.header.forkCnt)];
        let set = new Set(fork.addressesInThreshold);
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement) return false;
        if (
            EvmUtils.encodeBlock(agreement.block) != EvmUtils.encodeBlock(block)
        )
            return false;
        for (let signature of agreement.blockSignatures) {
            set.delete(
                EvmUtils.retrieveSignerAddressBlock(agreement.block, signature)
            );
        }
        if (set.size == 0) return true;
        return false;
    }
    public getSigantures(block: BlockStruct): SignatureLike[] {
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement) return [];
        return agreement.blockSignatures;
    }
    // Returns the signature of the block author
    public getOriginalSignature(block: BlockStruct): SignatureLike | undefined {
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement) return undefined;
        for (let signature of agreement.blockSignatures) {
            if (
                EvmUtils.retrieveSignerAddressBlock(
                    agreement.block,
                    signature
                ) == block.transaction.header.participant
            ) {
                return signature;
            }
        }
        return undefined;
    }
    //Probably return boolean, error flag -> dipute
    public doesSignatureExist(
        block: BlockStruct,
        signature: SignatureLike
    ): boolean {
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement) return false;
        if (
            EvmUtils.encodeBlock(agreement.block) != EvmUtils.encodeBlock(block)
        )
            throw new Error("AgreementManager - doesSignatureExist - conflict"); //should never trigger because of checks before confirming

        if (!agreement.blockSignatures.includes(signature)) return false;
        return true;
    }

    public didParticipantSign(
        block: BlockStruct,
        participant: AddressLike
    ): { didSign: boolean; siganture: SignatureLike | undefined } {
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (!agreement) return { didSign: false, siganture: undefined };
        if (
            EvmUtils.encodeBlock(agreement.block) != EvmUtils.encodeBlock(block)
        )
            return { didSign: false, siganture: undefined };
        for (let signature of agreement.blockSignatures) {
            if (
                EvmUtils.retrieveSignerAddressBlock(
                    agreement.block,
                    signature
                ) == participant
            ) {
                return { didSign: true, siganture: signature };
            }
        }
        return { didSign: false, siganture: undefined };
    }

    public isParticipantInLatestFork(participant: AddressLike): boolean {
        let fork = this.forks[this.forks.length - 1];
        return fork.addressesInThreshold.includes(participant);
    }

    public getEncodedState(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        let agreement = this.getAgreement(forkCnt, transactionCnt);
        if (!agreement) return undefined;
        return agreement.encodedState;
    }
    public getForkGenesisStateEncoded(forkCnt: number): string | undefined {
        if (forkCnt >= this.forks.length) return undefined;
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
        let fork = this.forks[Number(forkCnt)];
        let encodedLatestFinalizedState: string | undefined;
        let encodedLatestCorrectState: string | undefined;
        let virtualVotingBlocks: ConfirmedBlockStruct[] = [];
        let set = new Set(fork.addressesInThreshold);
        for (let i = fork.agreements.length - 1; i >= 0; i--) {
            let agreement = fork.agreements[i];
            let signerAddresses: AddressLike[] = [];
            for (let signature of agreement.blockSignatures) {
                let adr = EvmUtils.retrieveSignerAddressBlock(
                    agreement.block,
                    signature
                );
                if (!encodedLatestCorrectState && adr == signerAddress) {
                    encodedLatestCorrectState = agreement.encodedState;
                }
                signerAddresses.push(adr);
            }
            if (encodedLatestCorrectState) {
                virtualVotingBlocks.unshift({
                    encodedBlock: EvmUtils.encodeBlock(agreement.block),
                    signatures: agreement.blockSignatures as string[]
                });
                for (let signer of signerAddresses) {
                    set.delete(signer);
                }
                if (set.size == 0) {
                    encodedLatestFinalizedState = agreement.encodedState;
                    return {
                        encodedLatestFinalizedState,
                        encodedLatestCorrectState,
                        virtualVotingBlocks: virtualVotingBlocks
                    };
                }
            }
        }
        //If here => fork[0] is finalized
        return {
            encodedLatestFinalizedState: fork.forkGenesisStateEncoded,
            encodedLatestCorrectState: encodedLatestCorrectState
                ? encodedLatestCorrectState
                : fork.forkGenesisStateEncoded,
            virtualVotingBlocks: virtualVotingBlocks
        };
    }

    // *************************************************
    // * On-chain block collection operations - public *
    // *************************************************
    public collectOnChainBlock(
        signedBlock: SignedBlockStruct,
        timestamp: number
    ): AgreementFlag {
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        //Resolved? -  also have to prevent duplicates in queue(map) - queue map can't have duplicates, it can only be overwritten wtih a different block for the same [forkCnt,transactionCnt,participantAdr] - in that case checkBlock returns a dispute flag
        let flag = this.checkBlock(signedBlock);
        if (
            flag == AgreementFlag.INVALID_SIGNATURE ||
            flag == AgreementFlag.INCORRECT_DATA ||
            flag == AgreementFlag.DOUBLE_SIGN
        )
            return flag;
        if (flag == AgreementFlag.READY || flag == AgreementFlag.NOT_READY)
            this.queueBlock(signedBlock); // if ready - will be consumed to tryDequeueBlocks

        //Resolved - duplicates can be added - can bloat state
        if (
            this.didParticipantPostOnChain(
                Number(block.transaction.header.forkCnt),
                Number(block.transaction.header.transactionCnt),
                block.transaction.header.participant
            )
        )
            return flag;
        let fork = this.forks[Number(block.transaction.header.forkCnt)];
        fork.chainBlocks.push({
            transactionCnt: Number(block.transaction.header.transactionCnt),
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
    private getAgreement(
        forkCnt: number,
        transactionCnt: number
    ): Agreement | undefined {
        if (Number(forkCnt) >= this.forks.length) return undefined;
        let fork = this.forks[forkCnt];
        if (transactionCnt >= fork.agreements.length) return undefined;
        return fork.agreements[transactionCnt];
    }
    //both canonical chain and future queue
    public isBlockInChain(block: BlockStruct): boolean {
        let agreement = this.getAgreement(
            Number(block.transaction.header.forkCnt),
            Number(block.transaction.header.transactionCnt)
        );
        if (
            agreement &&
            EvmUtils.encodeBlock(agreement.block) == EvmUtils.encodeBlock(block)
        )
            return true;
        return false;
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
        let block = EvmUtils.decodeBlock(signedBlock.encodedBlock);
        let retrivedAddress = EvmUtils.retrieveSignerAddressBlock(
            block,
            signedBlock.signature as SignatureLike
        );
        if (retrivedAddress != block.transaction.header.participant)
            return AgreementFlag.INVALID_SIGNATURE;

        if (this.isBlockDuplicate(block)) return AgreementFlag.DUPLICATE;

        let forkCnt = Number(block.transaction.header.forkCnt);
        if (Number(forkCnt) >= this.forks.length)
            return AgreementFlag.NOT_READY;

        let transactionCnt = Number(block.transaction.header.transactionCnt);
        let participantAdr = block.transaction.header.participant;

        //Check for conflict on existing block
        let _block = this.getBlock(forkCnt, transactionCnt);
        if (_block) {
            if (_block.transaction.header.participant == participantAdr)
                return AgreementFlag.DOUBLE_SIGN;
            else return AgreementFlag.INCORRECT_DATA;
        }

        //Check virtual vote
        _block = this.getBlock(forkCnt, transactionCnt - 1);
        if (_block) {
            if (_block.stateHash != block.previousStateHash)
                return AgreementFlag.INCORRECT_DATA;
            return AgreementFlag.READY; // this is deducted since there is a previous block and there is no conflict
        }
        if (transactionCnt < 0) return AgreementFlag.INCORRECT_DATA; // TODO! DLT doesn't handle this
        if (transactionCnt == 0) {
            //first BLOCK in the fork
            if (
                block.previousStateHash !=
                ethers.keccak256(this.forks[forkCnt].forkGenesisStateEncoded) //TODO! - link with SM and not use ethers here but call function from SM
            )
                return AgreementFlag.INCORRECT_DATA; // TODO! DLT doesn't handle this
            return AgreementFlag.READY;
        }
        return AgreementFlag.NOT_READY; //transactionCnt in the future
    }
    public getLatestBlockTimestamp(forkCnt: number): number {
        let fork = this.forks[Number(forkCnt)];
        let genesisTimestamp = fork.genesisTimestamp;
        let latestBlockTimestamp = Number(
            this.getLatestAgreement(forkCnt)?.block.transaction.header
                .timestamp || 0
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
}

export default AgreementManager;

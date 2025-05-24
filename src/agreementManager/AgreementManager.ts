import { AddressLike, BigNumberish, SignatureLike, BytesLike } from "ethers";
import {
    SignedBlockStruct,
    BlockStruct,
    BlockConfirmationStruct,
    StateSnapshotStruct,
    BalanceStruct,
    JoinChannelBlockStruct,
    ExitChannelBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/DisputeTypes";
import { BlockUtils, EvmUtils } from "@/utils";
import { AgreementFlag } from "@/types";
import * as SetUtils from "@/utils/set";
import SignatureService from "./SignatureService";
import ForkService, { Direction } from "./ForkService";
import QueueService from "./QueueService";
import OnChainTracker from "./OnChainTracker";
import BlockValidator from "./BlockValidator";
import { ethers } from "hardhat";

class AgreementManager {
    // blockHash -> JoinChannelBlock
    joinChannelBlocks: Map<BytesLike, JoinChannelBlockStruct> = new Map();
    exitChannelBlocks: Map<BytesLike, ExitChannelBlockStruct> = new Map();

    // latestBlockHash
    latestJoinChannelBlockHash: BytesLike = ethers.ZeroHash;
    latestExitChannelBlockHash: BytesLike = ethers.ZeroHash;
    totalDeposits: BalanceStruct = {
        amount: 0,
        data: ethers.toUtf8Bytes("")
    };
    totalWithdrawals: BalanceStruct = {
        amount: 0,
        data: ethers.toUtf8Bytes("")
    };
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
        signedBlock: SignedBlockStruct,
        encodedState: string,
        snapShot: StateSnapshotStruct
    ) {
        this.forkService.addBlock(signedBlock, encodedState, snapShot);
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

        if (
            !BlockUtils.areBlocksEqual(
                EvmUtils.decodeBlock(
                    agreement.blockConfirmation.signedBlock.encodedBlock
                ),
                block
            )
        )
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
        agreement.blockConfirmation.signatures.push(
            confirmationSignature as BytesLike
        );
    }

    public confirmDispute(dispute: DisputeStruct, signature: SignatureLike) {}

    public getForkGenesisSnapshot(
        forkCnt: number,
        deposit: BalanceStruct
    ): StateSnapshotStruct | undefined {
        // TODO:
        return undefined;
    }

    public getJoinChannelChain(): JoinChannelBlockStruct[] {
        const blocks: JoinChannelBlockStruct[] = [];
        const channelBlocks = this.joinChannelBlocks;

        if (!channelBlocks) return blocks;

        let currentHash = this.latestJoinChannelBlockHash;
        if (!currentHash) return blocks;

        while (true) {
            const block = channelBlocks.get(currentHash);
            if (!block) {
                throw new Error(`Chain is broken at hash ${currentHash}`);
            }

            blocks.unshift(block);

            // Check if this is the genesis block (block's hash equals its previousBlockHash)
            const blockHash = ethers.keccak256(
                EvmUtils.encodeJoinChannelBlock(block)
            );

            if (blockHash === block.previousBlockHash) {
                // We've reached the genesis block
                break;
            }

            currentHash = block.previousBlockHash;
        }

        return blocks;
    }

    public getLatestJoinChannelBlockHash(): BytesLike {
        return this.latestJoinChannelBlockHash;
    }

    public getExitChannelChain(): ExitChannelBlockStruct[] {
        const blocks: ExitChannelBlockStruct[] = [];
        const channelBlocks = this.exitChannelBlocks;

        if (!channelBlocks) return blocks;

        let currentHash = this.latestExitChannelBlockHash;
        if (!currentHash) return blocks;

        while (true) {
            const block = channelBlocks.get(currentHash);
            if (!block) {
                throw new Error(`Chain is broken at hash ${currentHash}`);
            }

            blocks.unshift(block);

            // Check if this is the genesis block (block's hash equals its previousBlockHash)
            const blockHash = ethers.keccak256(
                EvmUtils.encodeExitChannelBlock(block)
            );

            if (blockHash === block.previousBlockHash) {
                // We've reached the genesis block
                break;
            }

            currentHash = block.previousBlockHash;
        }

        return blocks;
    }

    public getLatestExitChannelBlockHash(): BytesLike {
        return this.latestExitChannelBlockHash;
    }

    public getStateMachineState(
        forkCnt: number,
        transactionCnt: number
    ): BytesLike | undefined {
        return this.forkService.getAgreement(forkCnt, transactionCnt)
            ?.encodedState;
    }

    public getForkProofSignedBlocks(forkCnt: number): SignedBlockStruct[] {
        const lastMilestoneBlock = EvmUtils.decodeBlock(
            this.forkService.getForkProof(forkCnt)!.forkMilestoneProofs[-1]
                .blockConfirmations[-1].signedBlock.encodedBlock
        );
        const lastMilestoneBlockHeight = lastMilestoneBlock.transaction.header
            .transactionCnt as number;
        let signedBlocks: SignedBlockStruct[] = [];
        for (
            let i = lastMilestoneBlockHeight + 1;
            i < this.forkService.getFork(forkCnt)!.agreements.length;
            i++
        ) {
            const signedBlock = this.forkService.getAgreement(forkCnt, i)
                ?.blockConfirmation.signedBlock;
            if (!signedBlock) {
                throw new Error(
                    `AgreementManager - getForkProofSignedBlocks - signedBlock not found: ${i}`
                );
            }
            signedBlocks.push(signedBlock);
        }

        return signedBlocks;
    }

    public getLatestForkCnt(): number {
        return this.forkService.getLatestForkCnt();
    }

    public getNextBlockHeight(): number {
        return this.forkService.getNextBlockHeight();
    }

    public getBlockConfirmation(
        forkCnt: number,
        transactionCnt: number
    ): BlockConfirmationStruct | undefined {
        return this.forkService.getAgreement(forkCnt, transactionCnt)
            ?.blockConfirmation;
    }

    public getDoubleSignedBlock(
        signedBlock: SignedBlockStruct
    ): SignedBlockStruct | undefined {
        const block = EvmUtils.decodeBlock(signedBlock.encodedBlock);

        const agreement = this.forkService.getAgreementByBlock(block);
        if (
            !agreement ||
            BlockUtils.areBlocksEqual(
                EvmUtils.decodeBlock(
                    agreement.blockConfirmation.signedBlock.encodedBlock
                ),
                block
            ) ||
            BlockUtils.getBlockAuthor(
                agreement.blockConfirmation.signedBlock
            ) !== BlockUtils.getBlockAuthor(signedBlock)
        ) {
            return undefined;
        }

        let signatures = agreement.blockConfirmation.signatures;
        signatures.push(signedBlock.signature as BytesLike);
        const { didSign, signature } = BlockUtils.getParticipantSignature(
            EvmUtils.decodeBlock(
                agreement.blockConfirmation.signedBlock.encodedBlock
            ),
            signatures as SignatureLike[],
            BlockUtils.getBlockAuthor(signedBlock)
        );

        return didSign ? signedBlock : undefined;
    }

    public getLatestSignedBlockByParticipant(
        forkCnt: number,
        participantAdr: AddressLike
    ): SignedBlockStruct | undefined {
        if (!this.forkService.isValidForkCnt(forkCnt)) return undefined;

        for (const agreement of this.forkService.agreementsIterator(
            forkCnt,
            Direction.BACKWARD
        )) {
            let signatures = agreement.blockConfirmation.signatures;
            signatures.push(
                agreement.blockConfirmation.signedBlock.signature as BytesLike
            );
            const { didSign, signature } = BlockUtils.getParticipantSignature(
                EvmUtils.decodeBlock(
                    agreement.blockConfirmation.signedBlock.encodedBlock
                ),
                signatures as SignatureLike[],
                participantAdr
            );

            if (didSign) return agreement.blockConfirmation.signedBlock;
        }
        return undefined;
    }

    public didEveryoneSignBlock(signedBlock: SignedBlockStruct): boolean {
        const agreement = this.forkService.getAgreementByBlock(
            EvmUtils.decodeBlock(signedBlock.encodedBlock)
        );

        if (
            !agreement ||
            !BlockUtils.areBlocksEqual(
                EvmUtils.decodeBlock(
                    agreement.blockConfirmation.signedBlock.encodedBlock
                ),
                EvmUtils.decodeBlock(signedBlock.encodedBlock)
            )
        )
            return false;

        // Check if all threshold addresses have signed
        let totalSignatures = agreement.blockConfirmation.signatures;
        totalSignatures.push(signedBlock.signature as BytesLike);

        const signersSet = BlockUtils.getSignerAddresses(
            EvmUtils.decodeBlock(
                agreement.blockConfirmation.signedBlock.encodedBlock
            ),
            totalSignatures as SignatureLike[]
        );
        const addressesSet = SetUtils.stringSetFromArray(
            agreement.addressesInThreshold
        );
        // All threshold addresses must be in the signers set
        return SetUtils.isSubset(addressesSet, signersSet);
    }

    //Probably return boolean, error flag -> dipute
    public doesSignatureExist(
        block: BlockStruct,
        signature: SignatureLike
    ): boolean {
        const agreement = this.forkService.getAgreementByBlock(block);

        if (!agreement) return false;

        if (
            !BlockUtils.areBlocksEqual(
                EvmUtils.decodeBlock(
                    agreement.blockConfirmation.signedBlock.encodedBlock
                ),
                block
            )
        )
            throw new Error("AgreementManager - doesSignatureExist - conflict");

        return SignatureService.doesSignatureExist(agreement, signature);
    }

    public didParticipantSign(
        block: BlockStruct,
        participant: AddressLike
    ): { didSign: boolean; signature: SignatureLike | undefined } {
        const agreement = this.forkService.getAgreementByBlock(block);

        if (
            !agreement ||
            !BlockUtils.areBlocksEqual(
                EvmUtils.decodeBlock(
                    agreement.blockConfirmation.signedBlock.encodedBlock
                ),
                block
            )
        )
            return { didSign: false, signature: undefined };

        let signatures = agreement.blockConfirmation.signatures;
        signatures.push(
            agreement.blockConfirmation.signedBlock.signature as BytesLike
        );
        return BlockUtils.getParticipantSignature(
            EvmUtils.decodeBlock(
                agreement.blockConfirmation.signedBlock.encodedBlock
            ),
            signatures as SignatureLike[],
            participant
        );
    }

    public getParticipantsWhoHaventSignedBlock(
        block: BlockStruct
    ): AddressLike[] {
        const forkCnt = block.transaction.header.forkCnt as number;
        const agreement = this.forkService.getAgreementByBlock(block);
        const fork = this.forkService.getFork(forkCnt);
        if (!fork || !agreement) return [];

        return SignatureService.getParticipantsWhoDidntSign(agreement);
    }

    public isParticipantInLatestFork(participant: AddressLike): boolean {
        const fork = this.forkService.getLatestFork();
        if (!fork) return false;
        const latestAgreement = fork.agreements[-1];
        return new Set(latestAgreement.addressesInThreshold).has(participant);
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

    public getSnapShot(
        forkCnt: number,
        transactionCnt: number
    ): StateSnapshotStruct | undefined {
        const agreement = this.forkService.getAgreement(
            forkCnt,
            transactionCnt
        );
        return agreement?.snapShot;
    }

    public getLatestStateSnapshot(
        forkCnt: number
    ): StateSnapshotStruct | undefined {
        const agreement = this.forkService.getLatestAgreement(forkCnt);
        return agreement?.snapShot;
    }
    /**
     * Gets the latest finalized state (ecnoded) and the latest signed/confirmed state (encoded)
     * @param forkCnt
     * @returns
     */
    public getFinalizedAndLatestWithVotes(forkCnt: BigNumberish): {
        encodedLatestFinalizedState: string;
        encodedLatestCorrectState: string;
        virtualVotingBlocks: BlockConfirmationStruct[];
    } {
        const agreementFork = this.forkService.getFork(Number(forkCnt));
        if (!agreementFork)
            throw new Error(
                "AgreementManager - getFinalizedAndLatestWithVotes - agreementFork not found"
            );

        // iterate over all agreements in the fork from backwards, check if the last agreement has all confirmations,
        // if not check how many signature are missing and that is the number of virtual votes and the depth of the virtual voting and take the state of that agreement at the depth
        let encodedLatestFinalizedState = "";
        let encodedLatestCorrectState = "";
        let virtualVotingBlocks: BlockConfirmationStruct[] = [];
        let collectedVotes = 0;

        if (agreementFork.agreements.length === 0) {
            encodedLatestCorrectState = agreementFork.forkGenesisStateEncoded;
            encodedLatestFinalizedState = agreementFork.forkGenesisStateEncoded;
        } else {
            let totalSignatures =
                agreementFork.agreements[-1].blockConfirmation.signatures;
            totalSignatures.push(
                agreementFork.agreements[-1].blockConfirmation.signedBlock
                    .signature as BytesLike
            );

            if (
                agreementFork.agreements[-1].addressesInThreshold.length ===
                totalSignatures.length
            ) {
                encodedLatestCorrectState =
                    agreementFork.agreements[-1].encodedState;
                encodedLatestFinalizedState =
                    agreementFork.agreements[-1].encodedState;
            } else {
                for (const agreement of this.forkService.agreementsIterator(
                    Number(forkCnt),
                    Direction.BACKWARD
                )) {
                    if (
                        agreement.addressesInThreshold.length === collectedVotes
                    ) {
                        encodedLatestCorrectState = agreement.encodedState;
                        encodedLatestFinalizedState = agreement.encodedState;
                        break;
                    } else {
                        collectedVotes +=
                            agreement.blockConfirmation.signatures.length === 0
                                ? 1
                                : agreement.blockConfirmation.signatures
                                      .length + 1;
                        virtualVotingBlocks.push(agreement.blockConfirmation);
                    }
                }
            }
        }

        return {
            encodedLatestFinalizedState,
            encodedLatestCorrectState,
            virtualVotingBlocks
        };
    }

    public calculateTotalDeposits(): BalanceStruct {
        const joinChannelChain = this.getJoinChannelChain();
        if (!joinChannelChain)
            throw new Error(
                "AgreementManager - calculateTotalDeposits - joinChannelChain not found"
            );
        let totalDeposits: BalanceStruct = {
            amount: 0,
            data: ethers.toUtf8Bytes("")
        };
        for (const joinChannelBlock of joinChannelChain) {
            for (const joinChannel of joinChannelBlock.joinChannels) {
                totalDeposits.amount =
                    ethers.toBigInt(totalDeposits.amount) +
                    ethers.toBigInt(joinChannel.balance.amount);
            }
        }
        return totalDeposits;
    }
    public calculateTotalWithdrawals(): BalanceStruct {
        const exitChannelChain = this.getExitChannelChain();
        if (!exitChannelChain)
            throw new Error(
                "AgreementManager - calculateTotalWithdrawals - exitChannelChain not found"
            );
        let totalWithdrawals: BalanceStruct = {
            amount: 0,
            data: ethers.toUtf8Bytes("")
        };
        for (const exitChannelBlock of exitChannelChain) {
            for (const exitChannel of exitChannelBlock.exitChannels) {
                totalWithdrawals.amount =
                    ethers.toBigInt(totalWithdrawals.amount) +
                    ethers.toBigInt(exitChannel.balance.amount);
            }
        }
        return totalWithdrawals;
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

    public queueConfirmation(blockConfirmation: BlockConfirmationStruct) {
        this.queueService.queueConfirmation(blockConfirmation);
    }
    public tryDequeueConfirmations(
        forkCnt: number,
        transactionCnt: number
    ): BlockConfirmationStruct[] {
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
    public isBlockInChain(sb: SignedBlockStruct): boolean {
        return this.blockValidator.isBlockInChain(sb);
    }
    public isBlockDuplicate(sb: SignedBlockStruct): boolean {
        return this.blockValidator.isBlockDuplicate(sb);
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

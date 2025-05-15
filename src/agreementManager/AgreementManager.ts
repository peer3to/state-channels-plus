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
    // channelId -> blockHash -> JoinChannelBlock
    joinChannelBlocks: Map<BytesLike, Map<BytesLike, JoinChannelBlockStruct>> =
        new Map();
    exitChannelBlocks: Map<BytesLike, Map<BytesLike, ExitChannelBlockStruct>> =
        new Map();

    // channelId -> latestBlockHash
    latestJoinChannelBlockHash: Map<BytesLike, BytesLike> = new Map();
    latestExitChannelBlockHash: Map<BytesLike, BytesLike> = new Map();

    // snapShotCommitment -> stateSnapshot
    stateSnapshots: Map<BytesLike, StateSnapshotStruct> = new Map();
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

    public getJoinChannelChain(channelId: BytesLike): JoinChannelBlockStruct[] {
        const blocks: JoinChannelBlockStruct[] = [];
        const channelBlocks = this.joinChannelBlocks.get(channelId);

        if (!channelBlocks) return blocks;

        let currentHash = this.latestJoinChannelBlockHash.get(channelId);
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

    public getLatestJoinChannelBlockHash(channelId: BytesLike): BytesLike {
        return (
            this.latestJoinChannelBlockHash.get(channelId) ?? ethers.ZeroHash
        );
    }

    public getExitChannelChain(channelId: BytesLike): ExitChannelBlockStruct[] {
        const blocks: ExitChannelBlockStruct[] = [];
        const channelBlocks = this.exitChannelBlocks.get(channelId);

        if (!channelBlocks) return blocks;

        let currentHash = this.latestExitChannelBlockHash.get(channelId);
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

    public getLatestExitChannelBlockHash(channelId: BytesLike): BytesLike {
        return (
            this.latestExitChannelBlockHash.get(channelId) ?? ethers.ZeroHash
        );
    }

    public getStateMachineState(
        forkCnt: number,
        transactionCnt: number
    ): BytesLike | undefined {
        return this.forkService.getAgreement(forkCnt, transactionCnt)
            ?.encodedState;
    }

    public getMilestoneSnapshots(forkCnt: number): StateSnapshotStruct[] {
        const snapShotCommitments =
            this.forkService.collectMilestoneSnapshots(forkCnt);
        const snapShots: StateSnapshotStruct[] = [];
        for (const snapShotCommitment of snapShotCommitments) {
            const snapShot = this.stateSnapshots.get(snapShotCommitment);
            if (!snapShot) {
                throw new Error(
                    `AgreementManager - getMilestoneSnapshots - snapShot not found: ${snapShotCommitment}`
                );
            }
            snapShots.push(snapShot);
        }
        return snapShots;
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
    public getBlock(
        forkCnt: number,
        transactionCnt: number
    ): BlockStruct | undefined {
        return this.forkService.getAgreement(forkCnt, transactionCnt)?.block;
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
            fork.genesisParticipants
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
        return new Set(fork.genesisParticipants).has(participant);
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

    public getForkGenesisStateSnapshot(
        forkCnt: number
    ): StateSnapshotStruct | undefined {
        const fork = this.forkService.getFork(forkCnt);
        return this.stateSnapshots.get(
            fork?.agreements[0]?.snapShotCommitment!
        );
    }
    public getSnapShot(
        forkCnt: number,
        transactionCnt: number
    ): StateSnapshotStruct | undefined {
        const agreement = this.forkService.getAgreement(
            forkCnt,
            transactionCnt
        );
        return this.stateSnapshots.get(agreement?.snapShotCommitment!);
    }

    public getLatestStateSnapshot(
        forkCnt: number
    ): StateSnapshotStruct | undefined {
        const agreement = this.forkService.getLatestAgreement(forkCnt);
        return this.stateSnapshots.get(agreement?.snapShotCommitment!);
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
        virtualVotingBlocks: BlockConfirmationStruct[];
    } {
        const fork = this.forkService.getFork(Number(forkCnt));
        if (!fork)
            throw new Error(
                "AgreementManager - getFinalizedAndLatestWithVotes - fork not found"
            );
        let encodedLatestFinalizedState: string | undefined;
        let encodedLatestCorrectState: string | undefined;
        let virtualVotingBlocks: BlockConfirmationStruct[] = [];
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
                signedBlock: {
                    encodedBlock: ethers.AbiCoder.defaultAbiCoder().encode(
                        ["bytes"],
                        [agreement.block]
                    ),
                    signature: agreement.blockSignatures[0]
                },
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

    public calculateTotalDeposits(forkCnt: number): BalanceStruct {
        const joinChannelChain =
            this.forkService.getFork(forkCnt)?.joinChannelChain;
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
    public calculateTotalWithdrawals(forkCnt: number): BalanceStruct {
        const exitChannelChain =
            this.forkService.getFork(forkCnt)?.exitChannelChain;
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

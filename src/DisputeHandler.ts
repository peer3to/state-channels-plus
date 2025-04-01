import { AddressLike, BigNumberish, BytesLike, ethers } from "ethers";
import AgreementManager from "./AgreementManager";
import { AStateChannelManagerProxy } from "@typechain-types";
import {
    DoubleSignProofStruct,
    DoubleSignStruct,
    FoldPriorBlockProofStruct,
    FoldRechallengeProofStruct,
    IncorrectDataProofStruct,
    NewerStateProofStruct,
    ProofStruct,
    BlockTooFarInFutureProofStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/DisputeTypes";
import {
    BlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { ProofType, getEthersTypeForDisputeProof } from "@/DisputeTypes";
import EvmUtils from "@/utils/EvmUtils";
import Clock from "@/Clock";
// import dotenv from "dotenv";
import DebugProxy from "@/utils/DebugProxy";
import P2pEventHooks from "@/P2pEventHooks";

let DEBUG_DISPUTE_HANDLER = true;
// dotenv.config();
// DEBUG_DISPUTE_HANDLER = process.env.DEBUG_DISPUTE_HANDLER === "true";

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
        console.log("DisputeHandler - disputeFoldRechallenge");
        let proof = this.createFoldRechallengeProof(forkCnt, transactionCnt);
        if (!proof) return;
        await this.createDispute(forkCnt, "0x00", 0, [proof]);
    }
    public async disputeDoubleSign(
        conflictingBlocks: SignedBlockStruct[]
    ): Promise<void> {
        console.log("DisputeHandler - disputeDoubleSign");
        let proof = this.createDoubleSignProof(conflictingBlocks);
        let _firstBlock = EvmUtils.decodeBlock(
            conflictingBlocks[0].encodedBlock
        );
        await this.createDispute(
            _firstBlock.transaction.header.forkCnt,
            "0x00",
            0,
            [proof]
        );
    }

    public async disputeIncorrectData(
        incorrectBlockSigned: SignedBlockStruct
    ): Promise<void> {
        console.log("DisputeHandler - disputeIncorrectData");
        let proof = this.createIncorrectDataProof(incorrectBlockSigned);
        let _block = EvmUtils.decodeBlock(incorrectBlockSigned.encodedBlock);
        await this.createDispute(_block.transaction.header.forkCnt, "0x00", 0, [
            proof
        ]);
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
        console.log("DisputeHandler - disputeFoldPriorBlock");
        let proof = this.createFoldPriorBlockProof(transactionCnt);
        await this.createDispute(forkCnt, "0x00", 0, [proof]);
    }

    public async disputeBlockTooFarInFuture(
        BlockSigned: SignedBlockStruct
    ): Promise<void> {
        console.log("DisputeHandler - disputeBlockTooFarInFuture");
        let block = EvmUtils.decodeBlock(BlockSigned.encodedBlock);
        let proof = this.createBlockTooFarInFutureProof(BlockSigned);
        await this.createDispute(block.transaction.header.forkCnt, "0x00", 0, [
            proof
        ]);
    }

    public async onDispute(dispute: DisputeStruct): Promise<void> {
        this.setForkDisputed(Number(dispute.forkCnt));
        let success = this.rechallengeRecursive(dispute);
        if (!success)
            throw new Error(
                "DisputeHandler - onDispute - rechallenge failed - internal error"
            );
    }
    //Creates a dispute based on the generated proofs or optimistically timeouts (folds) the provided participant
    public async createDispute(
        forkCnt: BigNumberish,
        foldedParticipant: AddressLike,
        foldedTransactionCnt: BigNumberish,
        proofs: ProofStruct[]
    ): Promise<void> {
        if (foldedParticipant != "0x00")
            console.log("DisputeHandler - createDispute - Timeout");
        //TODO! stop signing for the current fork
        this.setForkDisputed(Number(forkCnt));
        for (let i = 0; i < proofs.length; i++)
            this.addProof(Number(forkCnt), proofs[i]);
        let _dispute = this.disputes.get(Number(forkCnt));
        if (!_dispute) {
            let {
                encodedLatestFinalizedState,
                encodedLatestCorrectState,
                virtualVotingBlocks: virtualVotingBlocks
            } = this.agreementManager.getFinalizedAndLatestWithVotes(
                forkCnt,
                this.signerAddress
            );
            //TODO? - connect signer to the contract in constructor?
            try {
                this.p2pEventHooks.onInitiatingDispute?.();
                let txResponse =
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
                let txReceipt = await txResponse.wait();
                // await block.wait(); //not needed - will be comunicated back through the event
                console.log("DISPUTE CREATED ##", txReceipt);
            } catch (e) {
                //TODO! - in hardhat test network (unlike production networks) - on revert - there is no txReceipt -> it will throw and be caught here
                console.log("ERROR - DISPUTE CATCH ##", e);

                //TODO !!!!!!!!!!!!! - quick fix for time race condition - remove this
                let txResponse =
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
                console.log("TX HASH SECOND ##", txResponse.hash);
                let txReceipt = await txResponse.wait();
                // await block.wait(); //not needed - will be comunicated back through the event
                console.log("DISPUTE CREATED SECOND ##", txReceipt);
            }
        }
        let newDispute = await this.stateChannelManagerContract.getDispute(
            this.channelId
        );
        //TODO! check newDispute 0000 bytes
        if (newDispute.channelId == ethers.ZeroHash) {
            throw new Error(
                "DisputeHandler - createDispute - no dispute created"
            );
        }
        let success = await this.rechallengeRecursive(newDispute);
        if (!success)
            throw new Error(
                "DisputeHandler - createDispute - rechallenge failed - internal error"
            );
    }

    // Creates a FoldRechallenge proof for the provided forkCnt and transactionCnt or undefined if the block is not signed by everyone
    public createFoldRechallengeProof(
        forkCnt: BigNumberish,
        transactionCnt: BigNumberish
    ): ProofStruct | undefined {
        let block = this.agreementManager.getBlock(
            Number(forkCnt),
            Number(transactionCnt)
        );
        if (!block) return undefined;
        if (!this.agreementManager.didEveryoneSignBlock(block))
            return undefined;
        let foldRechallengeProofStruct: FoldRechallengeProofStruct = {
            encodedBlock: EvmUtils.encodeBlock(block),
            signatures: this.agreementManager.getSigantures(
                block
            ) as BytesLike[]
        };
        return {
            proofType: ProofType.FoldRechallenge,
            encodedProof: DisputeHandler.encodeProof(
                ProofType.FoldRechallenge,
                foldRechallengeProofStruct
            )!
        };
    }
    /**
     *
     * @param conflictingBlocks array of BLOCK [block1,block2...] that have conflicts in agreementManager [block1',block2'...]
     * @returns
     */
    public createDoubleSignProof(
        conflictingBlocks: SignedBlockStruct[]
    ): ProofStruct {
        let doubleSigns: DoubleSignStruct[] = [];
        for (let i = 0; i < conflictingBlocks.length; i++) {
            let signedBlock = conflictingBlocks[i];
            let conflictingBlock =
                this.agreementManager.getDoubleSignedBlock(signedBlock);
            if (conflictingBlock) {
                doubleSigns.push({
                    block1: signedBlock,
                    block2: conflictingBlock
                });
            }
        }
        let doubleSignProofStruct: DoubleSignProofStruct = {
            doubleSigns
        };
        return {
            proofType: ProofType.DoubleSign,
            encodedProof: DisputeHandler.encodeProof(
                ProofType.DoubleSign,
                doubleSignProofStruct
            )!
        };
    }

    public createIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct
    ): ProofStruct {
        let incorrectBlock = EvmUtils.decodeBlock(
            incorrectBlockSigned.encodedBlock
        );
        //if BLOCK is after genesis state
        if (Number(incorrectBlock.transaction.header.transactionCnt) <= 0) {
            let encodedGenesisState =
                this.agreementManager.getForkGenesisStateEncoded(
                    Number(incorrectBlock.transaction.header.forkCnt)
                );
            //TODO! - this only checks currecnt (disputed fork) - prior and future forks are ignored for now
            encodedGenesisState = encodedGenesisState
                ? encodedGenesisState
                : "0x";

            let incorrectDataProofStruct: IncorrectDataProofStruct = {
                block1: incorrectBlockSigned,
                block2: incorrectBlockSigned,
                encodedState: encodedGenesisState
            };
            return {
                proofType: ProofType.IncorrectData,
                encodedProof: DisputeHandler.encodeProof(
                    ProofType.IncorrectData,
                    incorrectDataProofStruct
                )!
            };
        }
        //BLOCK is not after genesis state
        let priorBlock = this.agreementManager.getBlock(
            Number(incorrectBlock.transaction.header.forkCnt),
            Number(incorrectBlock.transaction.header.transactionCnt) - 1
        );
        let encodedPriorBlock = EvmUtils.encodeBlock(priorBlock!); //TODO - this can be undefined
        let priorBlockOriginalSignature =
            this.agreementManager.getOriginalSignature(priorBlock!); //TODO - this can be undefined
        let priorEncodedState = this.agreementManager.getEncodedState(
            Number(priorBlock!.transaction.header.forkCnt),
            Number(priorBlock!.transaction.header.transactionCnt)
        );
        let incorrectDataProofStruct: IncorrectDataProofStruct = {
            block1: incorrectBlockSigned,
            block2: {
                encodedBlock: encodedPriorBlock,
                signature: priorBlockOriginalSignature! as string
            },
            encodedState: priorEncodedState!
        };

        return {
            proofType: ProofType.IncorrectData,
            encodedProof: DisputeHandler.encodeProof(
                ProofType.IncorrectData,
                incorrectDataProofStruct
            )!
        };
    }
    public createNewerStateProof(
        forkCnt: number,
        participantAdr: AddressLike,
        currentTransactionCnt: number
    ): ProofStruct | undefined {
        let _block = this.agreementManager.getLatestSignedBlockByParticipant(
            forkCnt,
            participantAdr
        );
        if (!_block) return undefined;
        if (
            currentTransactionCnt >=
            Number(_block.block.transaction.header.transactionCnt)
        )
            return undefined;
        let newerStateProofStruct: NewerStateProofStruct = {
            encodedBlock: EvmUtils.encodeBlock(_block.block),
            confirmationSignature: _block.signature as string
        };
        return {
            proofType: ProofType.NewerState,
            encodedProof: DisputeHandler.encodeProof(
                ProofType.NewerState,
                newerStateProofStruct
            )!
        };
    }

    //TODO - think more about this
    public createFoldPriorBlockProof(transactionCnt: number): ProofStruct {
        let foldPriorBlockProofStruct: FoldPriorBlockProofStruct = {
            transactionCnt
        };
        return {
            proofType: ProofType.FoldPriorBlock,
            encodedProof: DisputeHandler.encodeProof(
                ProofType.FoldPriorBlock,
                foldPriorBlockProofStruct
            )!
        };
    }

    //TODO - think
    public createBlockTooFarInFutureProof(
        BlockSigned: SignedBlockStruct
    ): ProofStruct {
        let blockTooFarInFutureProofStruct: BlockTooFarInFutureProofStruct = {
            block1: BlockSigned
        };
        return {
            proofType: ProofType.BlockTooFarInFuture,
            encodedProof: DisputeHandler.encodeProof(
                ProofType.BlockTooFarInFuture,
                blockTooFarInFutureProofStruct
            )!
        };
    }
    public setForkDisputed(forkCnt: number): void {
        this.disputedForks.set(forkCnt, true);
    }
    public isForkDisputed(forkCnt: number): boolean {
        return this.disputedForks.get(forkCnt) ? true : false;
    }
    private addProof(forkCnt: number, proof: ProofStruct): void {
        if (!this.localProofs.has(forkCnt)) {
            this.localProofs.set(forkCnt, []);
        }
        this.localProofs.get(forkCnt)!.push(proof);
    }
    private trySetDispute(dispute: DisputeStruct): boolean {
        let forkCnt = Number(dispute.forkCnt);
        let _dispute = this.disputes.get(forkCnt);
        if (_dispute && dispute.challengeCnt <= _dispute.challengeCnt)
            return false;
        this.disputes.set(forkCnt, dispute);
        return true;
    }
    private async rechallengeRecursive(
        dispute: DisputeStruct
    ): Promise<boolean> {
        let forkCnt = Number(dispute.forkCnt);

        //set forkCnt -> dispute to latest
        if (!this.trySetDispute(dispute)) return true;

        //proofs
        let proofs = this.extractProofs(dispute);
        if (proofs.length == 0) return true; //no proofs - no need to rechallenge
        try {
            let {
                encodedLatestFinalizedState,
                encodedLatestCorrectState,
                virtualVotingBlocks: virtualVotingBlocks
            } = this.agreementManager.getFinalizedAndLatestWithVotes(
                dispute.forkCnt,
                this.signerAddress
            );
            this.p2pEventHooks.onInitiatingDispute?.();
            let txResponse =
                await this.stateChannelManagerContract.challengeDispute(
                    this.channelId,
                    dispute.forkCnt,
                    Number(dispute.challengeCnt) + 1,
                    proofs,
                    virtualVotingBlocks,
                    encodedLatestFinalizedState,
                    encodedLatestCorrectState,
                    { gasLimit: 2000000 } //TODO! - gas limit
                );
            let txReceipt = await txResponse.wait();
        } catch (e) {
            // TODO! - in hardhat test network (unlike production networks) - on revert - there is no txReceipt -> it will throw and be caught here
        }
        let newDispute = await this.stateChannelManagerContract.getDispute(
            dispute.channelId
        );
        if (newDispute.challengeCnt == dispute.challengeCnt) return false;
        return await this.rechallengeRecursive(newDispute);
    }

    // Extracts dispute proofs to be tracked locally
    private extractProofs(dispute: DisputeStruct): ProofStruct[] {
        let forkCnt = Number(dispute.forkCnt);
        let transactionCnt = Number(dispute.foldedTransactionCnt);
        let proof: ProofStruct | undefined;
        // Can challenge timeout?
        if (dispute.timedoutParticipant !== ethers.ZeroAddress) {
            proof = this.createFoldRechallengeProof(forkCnt, transactionCnt);
            if (proof) this.addProof(forkCnt, proof);
        }
        // Can prove newer state? (for the disputer)
        let lastTransactionCnt = 0; //assume genessis
        if (dispute.virtualVotingBlocks.length) {
            //not genessis
            let lastBlock = EvmUtils.decodeBlock(
                dispute.virtualVotingBlocks[
                    dispute.virtualVotingBlocks.length - 1
                ].encodedBlock
            );
            lastTransactionCnt = Number(
                lastBlock.transaction.header.transactionCnt
            );
        }
        proof = this.createNewerStateProof(
            forkCnt,
            dispute.postedStateDisputer,
            lastTransactionCnt
        );
        if (proof) this.addProof(forkCnt, proof);
        return this.filterProofs(dispute);
    }
    // Filters valid proofs
    private filterProofs(dispute: DisputeStruct): ProofStruct[] {
        let filteredProofs: ProofStruct[] = [];
        let proofs = this.localProofs.get(Number(dispute.forkCnt));
        if (!proofs) return [];
        for (let proof of proofs) {
            let block: BlockStruct;
            switch (proof.proofType) {
                case ProofType.FoldRechallenge:
                    let foldRechallengeProof = DisputeHandler.decodeProof(
                        proof.proofType,
                        proof.encodedProof
                    ) as FoldRechallengeProofStruct;
                    block = EvmUtils.decodeBlock(
                        foldRechallengeProof.encodedBlock
                    );
                    if (
                        block.transaction.header.transactionCnt ===
                            dispute.foldedTransactionCnt &&
                        block.transaction.header.participant ===
                            dispute.timedoutParticipant
                    ) {
                        filteredProofs.push(proof);
                    }
                    break;
                case ProofType.DoubleSign:
                    let doubleSignProof = DisputeHandler.decodeProof(
                        proof.proofType,
                        proof.encodedProof
                    ) as DoubleSignProofStruct;
                    for (let doubleSign of doubleSignProof.doubleSigns) {
                        //checking block1 is enough
                        let block1 = EvmUtils.decodeBlock(
                            doubleSign.block1.encodedBlock
                        );
                        if (
                            !dispute.slashedParticipants.includes(
                                block1.transaction.header.participant
                            )
                        ) {
                            filteredProofs.push(proof);
                            break; //if at least one is valid - we can incldue the proof
                        }
                    }
                    break;
                case ProofType.IncorrectData:
                    let incorrectDataProof = DisputeHandler.decodeProof(
                        proof.proofType,
                        proof.encodedProof
                    ) as IncorrectDataProofStruct;
                    //checkin block2 is enough
                    let block2 = EvmUtils.decodeBlock(
                        incorrectDataProof.block2.encodedBlock
                    );
                    if (
                        !dispute.slashedParticipants.includes(
                            block2.transaction.header.participant
                        )
                    )
                        filteredProofs.push(proof);

                    break;
                case ProofType.NewerState:
                    let newerStateProof = DisputeHandler.decodeProof(
                        proof.proofType,
                        proof.encodedProof
                    ) as NewerStateProofStruct;
                    block = EvmUtils.decodeBlock(newerStateProof.encodedBlock);
                    let latestBlock = EvmUtils.decodeBlock(
                        dispute.virtualVotingBlocks[
                            dispute.virtualVotingBlocks.length - 1
                        ].encodedBlock
                    );
                    let latestTransactionCnt = Number(
                        latestBlock.transaction.header.transactionCnt
                    );
                    if (
                        !dispute.slashedParticipants.includes(
                            block.transaction.header.participant
                        ) &&
                        block.transaction.header.participant ==
                            dispute.postedStateDisputer &&
                        Number(block.transaction.header.transactionCnt) >
                            latestTransactionCnt
                    )
                        filteredProofs.push(proof);
                    break;
                case ProofType.FoldPriorBlock:
                    let foldPriorBlockProof = DisputeHandler.decodeProof(
                        proof.proofType,
                        proof.encodedProof
                    ) as FoldPriorBlockProofStruct;
                    if (
                        foldPriorBlockProof.transactionCnt <
                            dispute.foldedTransactionCnt &&
                        dispute.timedoutParticipant != ethers.ZeroAddress
                    )
                        filteredProofs.push(proof);
                    break;
                case ProofType.BlockTooFarInFuture:
                    let blockTooFarInFutureProof = DisputeHandler.decodeProof(
                        proof.proofType,
                        proof.encodedProof
                    ) as BlockTooFarInFutureProofStruct;
                    block = EvmUtils.decodeBlock(
                        blockTooFarInFutureProof.block1.encodedBlock
                    );
                    if (
                        Number(block.transaction.header.timestamp) >
                            Clock.getTimeInSeconds() &&
                        !dispute.slashedParticipants.includes(
                            block.transaction.header.participant
                        )
                    )
                        filteredProofs.push(proof);
                    break;
                default:
                    throw new Error(
                        "DisputeHandler - filterProofs - unknown proof type"
                    );
                    break;
            }
        }
        return filteredProofs;
    }

    private static encodeProof(
        proofType: ProofType,
        proofToEncode: any
    ): string | undefined {
        if (!proofToEncode) return undefined;
        let encodedProof = ethers.AbiCoder.defaultAbiCoder().encode(
            [getEthersTypeForDisputeProof(proofType)],
            [proofToEncode]
        );
        return encodedProof;
    }
    private static decodeProof(
        proofType: ProofType,
        proofEncoded: BytesLike
    ): any {
        let proofDecoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [getEthersTypeForDisputeProof(proofType)],
            proofEncoded
        );
        return EvmUtils.ethersResultToObjectRecursive(proofDecoded[0]);
    }
}

export default DisputeHandler;

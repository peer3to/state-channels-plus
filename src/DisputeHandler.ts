import { AddressLike, BigNumberish, BytesLike, ethers } from "ethers";
import AgreementManager from "./AgreementManager";
import { AStateChannelManagerProxy } from "../typechain-types";
import {
    ProofStruct,
    DisputeStruct,
    FoldRechallengeProofStruct
} from "../typechain-types/contracts/V1/DisputeTypes";
import {
    BlockStruct,
    SignedBlockStruct
} from "../typechain-types/contracts/V1/DataTypes";
import { ProofType, getEthersTypeForDisputeProof } from "./DisputeTypes";
import EvmUtils from "./utils/EvmUtils";
import Clock from "./Clock";
// import dotenv from "dotenv";
import DebugProxy from "./utils/DebugProxy";
import P2pEventHooks from "./P2pEventHooks";

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
    diputes: Map<ForkCnt, DisputeStruct> = new Map();
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

    public async onDispute(dispute: DisputeStruct): Promise<void> {
        this.setForkDisputed(Number(dispute.forkCnt));
        let success = this.rechallengeRecusrisve(dispute);
        if (!success)
            throw new Error(
                "DisputeHandler - onDispute - rechallenge failed - internal error"
            );
    }
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
        let _dispute = this.diputes.get(Number(forkCnt));
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
                console.log("DISPUTE CATCH ##", e);
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
        let success = await this.rechallengeRecusrisve(newDispute);
        if (!success)
            throw new Error(
                "DisputeHandler - createDispute - rechallenge failed - internal error"
            );
    }

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
        let _dispute = this.diputes.get(forkCnt);
        if (_dispute && dispute.challengeCnt <= _dispute.challengeCnt)
            return false;
        this.diputes.set(forkCnt, dispute);
        return true;
    }
    private async rechallengeRecusrisve(
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
        return await this.rechallengeRecusrisve(newDispute);
    }

    private extractProofs(dispute: DisputeStruct): ProofStruct[] {
        let forkCnt = Number(dispute.forkCnt);
        let transactionCnt = Number(dispute.foldedTransactionCnt);
        let proof: ProofStruct | undefined;
        // Can challenge timeout?
        if (dispute.timedoutParticipant !== ethers.ZeroAddress) {
            proof = this.createFoldRechallengeProof(forkCnt, transactionCnt);
            if (proof) this.addProof(forkCnt, proof);
        }
        return this.filterProofs(dispute);
    }

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

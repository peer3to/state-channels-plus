import { ethers, AddressLike, BigNumberish, BytesLike } from "ethers";
import * as dt from "@typechain-types/contracts/V1/DisputeTypes";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { getEthersTypeForDisputeProof, ProofType } from "@/types/disputes";
import { EvmUtils } from "@/utils";
import Clock from "@/Clock";
import AgreementManager from "@/agreementManager";

class ProofManager {
    readonly agreementManager: AgreementManager;

    constructor(agreementManager: AgreementManager) {
        this.agreementManager = agreementManager;
    }

    // ===== Static Encoding/Decoding Methods =====

    public static encodeProof(
        proofType: ProofType,
        proofToEncode: any
    ): string | undefined {
        if (!proofToEncode) return undefined;
        const ethersType = getEthersTypeForDisputeProof(proofType);
        return ethers.AbiCoder.defaultAbiCoder().encode(
            [ethersType],
            [proofToEncode]
        );
    }

    public static decodeProof(
        proofType: ProofType,
        encodedProof: BytesLike
    ): any {
        const proofDecoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [getEthersTypeForDisputeProof(proofType)],
            encodedProof
        );
        return EvmUtils.ethersResultToObjectRecursive(proofDecoded[0]);
    }

    // ===== Proof Creation Methods =====

    /**
     * @param conflictingBlocks array of BLOCK [block1,block2...] that have conflicts in agreementManager [block1',block2'...]
     *
     */
    public createDoubleSignProof(
        conflictingBlock: SignedBlockStruct
    ): dt.BlockDoubleSignProofStruct {
        const secondConflictingBlock =
            this.agreementManager.getDoubleSignedBlock(conflictingBlock);

        if (!secondConflictingBlock) {
            throw new Error("No second conflicting block found");
        }

        const doubleSignProofStruct: dt.BlockDoubleSignProofStruct = {
            block1: conflictingBlock,
            block2: secondConflictingBlock
        };

        return doubleSignProofStruct;
    }

    public createEmptyBlockProof(
        emptyBlock: SignedBlockStruct,
        forkCnt: number,
        transactionCnt: number
    ): dt.BlockEmptyProofStruct {
        const previousBlock = this.agreementManager.getBlock(
            forkCnt,
            transactionCnt - 1
        );
        let signedPreviousBlock: SignedBlockStruct;
        if (previousBlock) {
            const prevBlockSignature =
                this.agreementManager.getOriginalSignature(previousBlock);
            signedPreviousBlock = {
                encodedBlock: EvmUtils.encodeBlock(previousBlock),
                signature: prevBlockSignature as BytesLike
            };
        } else {
            signedPreviousBlock = emptyBlock;
        }
        const emptyBlockProofStruct: dt.BlockEmptyProofStruct = {
            emptyBlock,
            previousBlock: signedPreviousBlock
        };

        return emptyBlockProofStruct;
    }

    public createBlockInvalidStateTransitionProof(
        invalidBlock: SignedBlockStruct,
        forkCnt: number,
        transactionCnt: number
    ): dt.BlockInvalidStateTransitionProofStruct {
        const previousBlock = this.agreementManager.getBlock(
            forkCnt,
            transactionCnt - 1
        );
        let signedPreviousBlock: SignedBlockStruct;
        if (previousBlock) {
            const prevBlockSignature =
                this.agreementManager.getOriginalSignature(previousBlock)!;
            signedPreviousBlock = {
                encodedBlock: EvmUtils.encodeBlock(previousBlock),
                signature: prevBlockSignature as BytesLike
            };
        } else {
            signedPreviousBlock = invalidBlock;
        }
        const previousBlockStateSnapshot = this.agreementManager.getSnapShot(
            forkCnt,
            transactionCnt - 1
        )!;
        const previousStateStateMachineState =
            this.agreementManager.getEncodedState(forkCnt, transactionCnt - 1);
        const proof: dt.BlockInvalidStateTransitionProofStruct = {
            invalidBlock,
            previousBlock: signedPreviousBlock,
            previousBlockStateSnapshot,
            previousStateStateMachineState:
                previousStateStateMachineState as BytesLike
        };
        return proof;
    }

    // public createDisputeInvalidPreviousRecursiveProof(
    //     invalidRecursiveDispute: dt.DisputeStruct,
    //     originalDispute: dt.DisputeStruct,
    //     originalDisputeTimestamp: number,
    //     invalidRecursiveDisputeTimestamp: number,
    //     invalidRecursiveDisputeOutputState: BytesLike
    // ): dt.DisputeInvalidPreviousRecursiveProofStruct {

    // }

    // public createTimeoutThresholdProof(timeoutThreshold: dt.TimeoutThresholdProofStruct): dt.TimeoutThresholdProofStruct {

    // }

    // public createTimeoutPriorInvalidProof(timeoutPriorInvalid: dt.TimeoutPriorInvalidProofStruct): dt.TimeoutPriorInvalidProofStruct {
    // }

    // -------------------------------- Helper Methods --------------------------------
    public collectStateProof(): dt.StateProofStruct[] {}
}

export default ProofManager;

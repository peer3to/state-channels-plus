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
    ): dt.ProofStruct {
        const secondConflictingBlock =
            this.agreementManager.getDoubleSignedBlock(conflictingBlock);

        if (!secondConflictingBlock) {
            throw new Error("No second conflicting block found");
        }

        const doubleSignProofStruct: dt.BlockDoubleSignProofStruct = {
            block1: conflictingBlock,
            block2: secondConflictingBlock
        };

        return {
            proofType: ProofType.BlockDoubleSign,
            encodedProof: ProofManager.encodeProof(
                ProofType.BlockDoubleSign,
                doubleSignProofStruct
            )!
        };
    }

    public createEmptyBlockProof(
        emptyBlock: SignedBlockStruct
    ): dt.ProofStruct {
        const forkCnt = EvmUtils.decodeBlock(emptyBlock.encodedBlock)
            .transaction.header.forkCnt as number;
        const transactionCnt = EvmUtils.decodeBlock(emptyBlock.encodedBlock)
            .transaction.header.transactionCnt as number;

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

        return {
            proofType: ProofType.BlockEmpty,
            encodedProof: ProofManager.encodeProof(
                ProofType.BlockEmpty,
                emptyBlockProofStruct
            )!
        };
    }

    public createBlockInvalidStateTransitionProof(
        invalidBlock: SignedBlockStruct
    ): dt.ProofStruct {
        const forkCnt = EvmUtils.decodeBlock(invalidBlock.encodedBlock)
            .transaction.header.forkCnt as number;
        const transactionCnt = EvmUtils.decodeBlock(invalidBlock.encodedBlock)
            .transaction.header.transactionCnt as number;
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
        return {
            proofType: ProofType.BlockInvalidStateTransition,
            encodedProof: ProofManager.encodeProof(
                ProofType.BlockInvalidStateTransition,
                proof
            )!
        };
    }

    public createDisputeInvalidPreviousRecursiveProof(
        invalidRecursiveDispute: dt.DisputeStruct,
        originalDispute: dt.DisputeStruct,
        originalDisputeTimestamp: number,
        invalidRecursiveDisputeTimestamp: number,
        invalidRecursiveDisputeOutputState: BytesLike
    ): dt.ProofStruct {
        const proof: dt.DisputeInvalidPreviousRecursiveProofStruct = {
            invalidRecursiveDispute,
            originalDispute,
            originalDisputeTimestamp,
            invalidRecursiveDisputeTimestamp,
            invalidRecursiveDisputeOutputState
        };
        return {
            proofType: ProofType.DisputeInvalidPreviousRecursive,
            encodedProof: ProofManager.encodeProof(
                ProofType.DisputeInvalidPreviousRecursive,
                proof
            )!
        };
    }

    public createTimeoutThresholdProof(
        transactionCnt: number,
        timedOutDispute: dt.DisputeStruct,
        timedOutDisputeTimestamp: number
    ): dt.ProofStruct {
        const forkCnt = timedOutDispute.timeout.forkCnt as number;
        const height = timedOutDispute.timeout.blockHeight as number;
        const latestStateSnapshot = this.agreementManager.getSnapShot(
            forkCnt,
            transactionCnt
        )!;
        const thresholdBlock = this.agreementManager.getBlockConfirmation(
            forkCnt,
            height
        )!;
        const proof: dt.TimeoutThresholdProofStruct = {
            thresholdBlock,
            timedOutDispute,
            timedOutDisputeTimestamp,
            latestStateSnapshot:
                EvmUtils.encodeStateSnapshot(latestStateSnapshot)
        };

        return {
            proofType: ProofType.TimeoutThreshold,
            encodedProof: ProofManager.encodeProof(
                ProofType.TimeoutThreshold,
                proof
            )!
        };
    }

    public createTimeoutPriorInvalidProof(
        originalDispute: dt.DisputeStruct,
        recursiveDispute: dt.DisputeStruct,
        originalDisputeTimestamp: number,
        recursiveDisputeTimestamp: number
    ): dt.ProofStruct {
        const proof: dt.TimeoutPriorInvalidProofStruct = {
            originalDispute,
            recursiveDispute,
            originalDisputeTimestamp,
            recursiveDisputeTimestamp
        };
        return {
            proofType: ProofType.TimeoutPriorInvalid,
            encodedProof: ProofManager.encodeProof(
                ProofType.TimeoutPriorInvalid,
                proof
            )!
        };
    }
}

export default ProofManager;

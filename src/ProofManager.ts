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
        const emptyBlockProofStruct: dt.BlockEmptyProofStruct = {
            emptyBlock,
            latestStateSnapshot: this.agreementManager.buildStateSnapshot(
                forkCnt,
                transactionCnt
            ),
            previousStateSnapshotHash: ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["bytes32"],
                    [
                        this.agreementManager.buildStateSnapshot(
                            forkCnt,
                            transactionCnt - 1
                        )
                    ]
                )
            ),
            previousStateMachineState: ethers.toUtf8Bytes(
                this.agreementManager.getEncodedState(
                    forkCnt,
                    transactionCnt - 1
                ) ?? ""
            )
        };
        return emptyBlockProofStruct;
    }

    public createBlockOutOfGasProof(
        block: SignedBlockStruct,
        forkCnt: number,
        transactionCnt: number
    ): dt.BlockOutOfGasProofStruct {
        const blockOutOfGasProofStruct: dt.BlockOutOfGasProofStruct = {
            invalidBlock: block,
            latestStateStateMachineState: ethers.toUtf8Bytes(
                this.agreementManager.getEncodedState(
                    forkCnt,
                    transactionCnt
                ) ?? ""
            )
        };
        return blockOutOfGasProofStruct;
    }

    // public createTimeoutThresholdProof(timeoutThreshold: dt.TimeoutThresholdProofStruct): dt.TimeoutThresholdProofStruct {

    // }

    // public createTimeoutPriorInvalidProof(timeoutPriorInvalid: dt.TimeoutPriorInvalidProofStruct): dt.TimeoutPriorInvalidProofStruct {
    // }
}

export default ProofManager;

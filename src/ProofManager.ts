import { ethers, AddressLike, BigNumberish, BytesLike } from "ethers";
import * as dt from "@typechain-types/contracts/V1/DisputeTypes";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { getEthersTypeForDisputeProof, ProofType } from "@/DisputeTypes";
import EvmUtils from "@/utils/EvmUtils";
import Clock from "@/Clock";
import AgreementManager from "./AgreementManager";

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

    public createFoldRechallengeProof(
        forkCnt: BigNumberish,
        transactionCnt: BigNumberish
    ): dt.ProofStruct | undefined {
        const block = this.agreementManager.getBlock(
            Number(forkCnt),
            Number(transactionCnt)
        );
        if (!block) return undefined;
        if (!this.agreementManager.didEveryoneSignBlock(block))
            return undefined;

        const foldRechallengeProofStruct: dt.FoldRechallengeProofStruct = {
            encodedBlock: EvmUtils.encodeBlock(block),
            signatures: this.agreementManager.getSigantures(
                block
            ) as BytesLike[]
        };

        return {
            proofType: ProofType.FoldRechallenge,
            encodedProof: ProofManager.encodeProof(
                ProofType.FoldRechallenge,
                foldRechallengeProofStruct
            )!
        };
    }

    /**
     * @param conflictingBlocks array of BLOCK [block1,block2...] that have conflicts in agreementManager [block1',block2'...]
     *
     */
    public createDoubleSignProof(
        conflictingBlocks: SignedBlockStruct[]
    ): dt.ProofStruct {
        const doubleSigns = conflictingBlocks.flatMap((signedBlock) => {
            const conflictingBlock =
                this.agreementManager.getDoubleSignedBlock(signedBlock);

            return conflictingBlock
                ? [
                      {
                          block1: signedBlock,
                          block2: conflictingBlock
                      }
                  ]
                : [];
        });

        const doubleSignProofStruct: dt.DoubleSignProofStruct = {
            doubleSigns
        };

        return {
            proofType: ProofType.DoubleSign,
            encodedProof: ProofManager.encodeProof(
                ProofType.DoubleSign,
                doubleSignProofStruct
            )!
        };
    }

    public createIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct
    ): dt.ProofStruct {
        const incorrectBlock = EvmUtils.decodeBlock(
            incorrectBlockSigned.encodedBlock
        );
        const forkCnt = Number(incorrectBlock.transaction.header.forkCnt);
        const transactionCnt = Number(
            incorrectBlock.transaction.header.transactionCnt
        );

        const isGenesisBlock = transactionCnt <= 0;

        const incorrectDataProofStruct = isGenesisBlock
            ? this.createGenesisBlockIncorrectDataProof(
                  incorrectBlockSigned,
                  forkCnt
              )
            : this.createRegularBlockIncorrectDataProof(
                  incorrectBlockSigned,
                  forkCnt,
                  transactionCnt
              );

        return {
            proofType: ProofType.IncorrectData,
            encodedProof: ProofManager.encodeProof(
                ProofType.IncorrectData,
                incorrectDataProofStruct
            )!
        };
    }

    public createNewerStateProof(
        forkCnt: number,
        participantAdr: AddressLike,
        currentTransactionCnt: number
    ): dt.ProofStruct | undefined {
        // Get the latest block signed by the participant
        const signedBlock =
            this.agreementManager.getLatestSignedBlockByParticipant(
                forkCnt,
                participantAdr
            );

        // Early return if no block is found
        if (!signedBlock) return undefined;

        const blockTransactionCnt = Number(
            signedBlock.block.transaction.header.transactionCnt
        );

        // Early return if the block doesn't have a newer transaction count
        if (currentTransactionCnt >= blockTransactionCnt) return undefined;

        // Create the proof struct using the newer state
        const newerStateProofStruct: dt.NewerStateProofStruct = {
            encodedBlock: EvmUtils.encodeBlock(signedBlock.block),
            confirmationSignature: signedBlock.signature as string
        };

        // Return the complete proof
        return {
            proofType: ProofType.NewerState,
            encodedProof: ProofManager.encodeProof(
                ProofType.NewerState,
                newerStateProofStruct
            )!
        };
    }

    // TODO - think more about this
    public static createFoldPriorBlockProof(
        transactionCnt: number
    ): dt.ProofStruct {
        return {
            proofType: ProofType.FoldPriorBlock,
            encodedProof: ProofManager.encodeProof(ProofType.FoldPriorBlock, {
                transactionCnt
            })!
        };
    }

    // TODO - think more about this
    public static createBlockTooFarInFutureProof(
        blockSigned: SignedBlockStruct
    ): dt.ProofStruct {
        const blockTooFarInFutureProofStruct: dt.BlockTooFarInFutureProofStruct =
            {
                block1: blockSigned
            };

        return {
            proofType: ProofType.BlockTooFarInFuture,
            encodedProof: ProofManager.encodeProof(
                ProofType.BlockTooFarInFuture,
                blockTooFarInFutureProofStruct
            )!
        };
    }

    // ===== Static Proof Validation Methods =====

    public static isFoldRechallengeValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const foldRechallengeProof = ProofManager.decodeProof(
            ProofType.FoldRechallenge,
            proof.encodedProof
        ) as dt.FoldRechallengeProofStruct;

        const block = EvmUtils.decodeBlock(foldRechallengeProof.encodedBlock);
        const sameTransactionCnt =
            Number(block.transaction.header.transactionCnt) ===
            dispute.foldedTransactionCnt;
        const sameParticipant =
            block.transaction.header.participant ===
            dispute.timedoutParticipant;

        return sameTransactionCnt && sameParticipant;
    }

    public static isDoubleSignValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const doubleSignProof = ProofManager.decodeProof(
            ProofType.DoubleSign,
            proof.encodedProof
        ) as dt.DoubleSignProofStruct;

        return doubleSignProof.doubleSigns.some((doubleSign) => {
            const block1 = EvmUtils.decodeBlock(doubleSign.block1.encodedBlock);
            return !dispute.slashedParticipants.includes(
                block1.transaction.header.participant
            );
        });
    }

    public static isIncorrectDataValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const incorrectDataProof = ProofManager.decodeProof(
            ProofType.IncorrectData,
            proof.encodedProof
        ) as dt.IncorrectDataProofStruct;

        const block2 = EvmUtils.decodeBlock(
            incorrectDataProof.block2.encodedBlock
        );

        return !dispute.slashedParticipants.includes(
            block2.transaction.header.participant
        );
    }

    public static isNewerStateValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const newerStateProof = ProofManager.decodeProof(
            ProofType.NewerState,
            proof.encodedProof
        ) as dt.NewerStateProofStruct;

        const block = EvmUtils.decodeBlock(newerStateProof.encodedBlock);

        if (dispute.virtualVotingBlocks.length === 0) return false;

        const latestBlock = EvmUtils.decodeBlock(
            dispute.virtualVotingBlocks[dispute.virtualVotingBlocks.length - 1]
                .encodedBlock
        );

        const latestTransactionCnt = Number(
            latestBlock.transaction.header.transactionCnt
        );
        const currentTransactionCnt = Number(
            block.transaction.header.transactionCnt
        );

        return (
            !dispute.slashedParticipants.includes(
                block.transaction.header.participant
            ) &&
            block.transaction.header.participant ===
                dispute.postedStateDisputer &&
            currentTransactionCnt > latestTransactionCnt
        );
    }

    public static isFoldPriorBlockValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const foldPriorBlockProof = ProofManager.decodeProof(
            ProofType.FoldPriorBlock,
            proof.encodedProof
        ) as dt.FoldPriorBlockProofStruct;

        return (
            foldPriorBlockProof.transactionCnt < dispute.foldedTransactionCnt &&
            dispute.timedoutParticipant !== ethers.ZeroAddress
        );
    }

    public static isBlockTooFarInFutureValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const blockTooFarInFutureProof = ProofManager.decodeProof(
            ProofType.BlockTooFarInFuture,
            proof.encodedProof
        ) as dt.BlockTooFarInFutureProofStruct;

        const block = EvmUtils.decodeBlock(
            blockTooFarInFutureProof.block1.encodedBlock
        );
        const blockTimestamp = Number(block.transaction.header.timestamp);

        return (
            blockTimestamp > Clock.getTimeInSeconds() &&
            !dispute.slashedParticipants.includes(
                block.transaction.header.participant
            )
        );
    }

    // ===== Main Filtering Function =====

    /**
     * Filters valid proofs from a list of proofs
     */
    public static filterValidProofs(
        dispute: dt.DisputeStruct,
        proofs?: dt.ProofStruct[]
    ): dt.ProofStruct[] {
        if (!proofs || proofs.length === 0) return [];

        const validatorMap = {
            [ProofType.FoldRechallenge]: ProofManager.isFoldRechallengeValid,
            [ProofType.DoubleSign]: ProofManager.isDoubleSignValid,
            [ProofType.IncorrectData]: ProofManager.isIncorrectDataValid,
            [ProofType.NewerState]: ProofManager.isNewerStateValid,
            [ProofType.FoldPriorBlock]: ProofManager.isFoldPriorBlockValid,
            [ProofType.BlockTooFarInFuture]:
                ProofManager.isBlockTooFarInFutureValid
        };

        return proofs.filter((proof) => {
            const validator = validatorMap[proof.proofType as ProofType];
            if (!validator) {
                throw new Error("Unknown proof type: " + proof.proofType);
            }
            return validator(proof, dispute);
        });
    }

    // ===== Private Helper Methods =====

    private createGenesisBlockIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct,
        forkCnt: number
    ): dt.IncorrectDataProofStruct {
        // For genesis blocks, we use the genesis state
        //TODO! - this only checks current (disputed fork) - prior and future forks are ignored for now

        return {
            block1: incorrectBlockSigned,
            block2: incorrectBlockSigned,
            encodedState:
                this.agreementManager.getForkGenesisStateEncoded(forkCnt) ??
                "0x"
        };
    }

    private createRegularBlockIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct,
        forkCnt: number,
        transactionCnt: number
    ): dt.IncorrectDataProofStruct {
        // For non-genesis blocks, we need to reference the prior block
        const priorBlock = this.agreementManager.getBlock(
            forkCnt,
            transactionCnt - 1
        );

        if (!priorBlock) {
            throw new Error(
                `Prior block not found for fork ${forkCnt}, transaction ${transactionCnt - 1}`
            );
        }

        const priorBlockOriginalSignature =
            this.agreementManager.getOriginalSignature(priorBlock);

        if (!priorBlockOriginalSignature) {
            throw new Error(
                `Prior block signature not found for fork ${forkCnt}, transaction ${transactionCnt - 1}`
            );
        }

        const priorEncodedState = this.agreementManager.getEncodedState(
            forkCnt,
            transactionCnt
        );

        if (!priorEncodedState) {
            throw new Error(
                `Prior encoded state not found for fork ${forkCnt}, transaction ${transactionCnt}`
            );
        }

        return {
            block1: incorrectBlockSigned,
            block2: {
                encodedBlock: EvmUtils.encodeBlock(priorBlock),
                signature: priorBlockOriginalSignature as string
            },
            encodedState: priorEncodedState
        };
    }
}

export default ProofManager;

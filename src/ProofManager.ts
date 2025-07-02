import { ethers, AddressLike, BigNumberish, BytesLike } from "ethers";
import * as dt from "@typechain-types/contracts/V1/types/DisputeTypes";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { getEthersTypeForDisputeProof, FraudProofType } from "@/types/disputes";
import { Codec, Type } from "@/utils";
import Clock from "@/Clock";
import AgreementManager from "@/agreementManager";
import { ForkId } from "./types/types";

class ProofManager {
    readonly agreementManager: AgreementManager;

    constructor(agreementManager: AgreementManager) {
        this.agreementManager = agreementManager;
    }

    // ===== Static Encoding/Decoding Methods =====

    public static encodeProof(
        proofType: FraudProofType,
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
        proofType: FraudProofType,
        encodedProof: BytesLike
    ): any {
        const proofDecoded = ethers.AbiCoder.defaultAbiCoder().decode(
            [getEthersTypeForDisputeProof(proofType)],
            encodedProof
        );
        return Codec.ethersResultToObjectRecursive(proofDecoded[0]);
    }

    // ===== FraudProof Creation Methods =====

    public createFoldRechallengeProof(
        forkId: ForkId,
        transactionCnt: BigNumberish
    ): dt.ProofStruct | undefined {
        const block = this.agreementManager.getBlock(
            forkId,
            Number(transactionCnt)
        );
        if (!block) return undefined;
        if (!this.agreementManager.didEveryoneSignBlock(block))
            return undefined;

        const foldRechallengeProofStruct: dt.FoldRechallengeProofStruct = {
            encodedBlock: Codec.encode(block, Type.Block),
            signatures: this.agreementManager.getSigantures(
                block
            ) as BytesLike[]
        };

        return {
            proofType: FraudProofType.FoldRechallenge,
            encodedProof: ProofManager.encodeProof(
                FraudProofType.FoldRechallenge,
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
            proofType: FraudProofType.DoubleSign,
            encodedProof: ProofManager.encodeProof(
                FraudProofType.DoubleSign,
                doubleSignProofStruct
            )!
        };
    }

    public createIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct
    ): dt.ProofStruct {
        const incorrectBlock = Codec.decode(
            incorrectBlockSigned.encodedBlock,
            Type.Block
        );
        const forkId = incorrectBlock.transaction.header.forkId;
        const transactionCnt = Number(
            incorrectBlock.transaction.header.transactionCnt
        );

        const isGenesisBlock = transactionCnt <= 0;

        const incorrectDataProofStruct = isGenesisBlock
            ? this.createGenesisBlockIncorrectDataProof(
                  incorrectBlockSigned,
                  forkId
              )
            : this.createRegularBlockIncorrectDataProof(
                  incorrectBlockSigned,
                  forkId,
                  transactionCnt
              );

        return {
            proofType: FraudProofType.IncorrectData,
            encodedProof: ProofManager.encodeProof(
                FraudProofType.IncorrectData,
                incorrectDataProofStruct
            )!
        };
    }

    public createNewerStateProof(
        forkId: ForkId,
        participantAdr: AddressLike,
        currentTransactionCnt: number
    ): dt.ProofStruct | undefined {
        // Get the latest block signed by the participant
        const signedBlock =
            this.agreementManager.getLatestSignedBlockByParticipant(
                forkId,
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
            encodedBlock: Codec.encode(signedBlock.block, Type.Block),
            confirmationSignature: signedBlock.signature as string
        };

        // Return the complete proof
        return {
            proofType: FraudProofType.NewerState,
            encodedProof: ProofManager.encodeProof(
                FraudProofType.NewerState,
                newerStateProofStruct
            )!
        };
    }

    // TODO - think more about this
    public static createFoldPriorBlockProof(
        transactionCnt: number
    ): dt.ProofStruct {
        return {
            proofType: FraudProofType.FoldPriorBlock,
            encodedProof: ProofManager.encodeProof(
                FraudProofType.FoldPriorBlock,
                {
                    transactionCnt
                }
            )!
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
            proofType: FraudProofType.BlockTooFarInFuture,
            encodedProof: ProofManager.encodeProof(
                FraudProofType.BlockTooFarInFuture,
                blockTooFarInFutureProofStruct
            )!
        };
    }

    // ===== Static FraudProof Validation Methods =====

    public static isFoldRechallengeValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const foldRechallengeProof = ProofManager.decodeProof(
            FraudProofType.FoldRechallenge,
            proof.encodedProof
        ) as dt.FoldRechallengeProofStruct;

        const block = Codec.decode(
            foldRechallengeProof.encodedBlock,
            Type.Block
        );
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
            FraudProofType.DoubleSign,
            proof.encodedProof
        ) as dt.DoubleSignProofStruct;

        return doubleSignProof.doubleSigns.some((doubleSign) => {
            const block1 = Codec.decode(
                doubleSign.block1.encodedBlock,
                Type.Block
            );
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
            FraudProofType.IncorrectData,
            proof.encodedProof
        ) as dt.IncorrectDataProofStruct;

        const block2 = Codec.decode(
            incorrectDataProof.block2.encodedBlock,
            Type.Block
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
            FraudProofType.NewerState,
            proof.encodedProof
        ) as dt.NewerStateProofStruct;

        const block = Codec.decode(newerStateProof.encodedBlock, Type.Block);

        if (dispute.virtualVotingBlocks.length === 0) return false;

        const latestBlock = Codec.decode(
            dispute.virtualVotingBlocks[dispute.virtualVotingBlocks.length - 1]
                .encodedBlock,
            Type.Block
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
            FraudProofType.FoldPriorBlock,
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
            FraudProofType.BlockTooFarInFuture,
            proof.encodedProof
        ) as dt.BlockTooFarInFutureProofStruct;

        const block = Codec.decode(
            blockTooFarInFutureProof.block1.encodedBlock,
            Type.Block
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
            [FraudProofType.FoldRechallenge]:
                ProofManager.isFoldRechallengeValid,
            [FraudProofType.DoubleSign]: ProofManager.isDoubleSignValid,
            [FraudProofType.IncorrectData]: ProofManager.isIncorrectDataValid,
            [FraudProofType.NewerState]: ProofManager.isNewerStateValid,
            [FraudProofType.FoldPriorBlock]: ProofManager.isFoldPriorBlockValid,
            [FraudProofType.BlockTooFarInFuture]:
                ProofManager.isBlockTooFarInFutureValid
        };

        return proofs.filter((proof) => {
            const validator = validatorMap[proof.proofType as FraudProofType];
            if (!validator) {
                throw new Error("Unknown proof type: " + proof.proofType);
            }
            return validator(proof, dispute);
        });
    }

    // ===== Private Helper Methods =====

    private createGenesisBlockIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct,
        forkId: ForkId
    ): dt.IncorrectDataProofStruct {
        // For genesis blocks, we use the genesis state
        //TODO! - this only checks current (disputed fork) - prior and future forks are ignored for now

        return {
            block1: incorrectBlockSigned,
            block2: incorrectBlockSigned,
            encodedState:
                this.agreementManager.getForkGenesisStateEncoded(forkId) ?? "0x"
        };
    }

    private createRegularBlockIncorrectDataProof(
        incorrectBlockSigned: SignedBlockStruct,
        forkId: ForkId,
        transactionCnt: number
    ): dt.IncorrectDataProofStruct {
        // For non-genesis blocks, we need to reference the prior block
        const priorBlock = this.agreementManager.getBlock(
            forkId,
            transactionCnt - 1
        );

        if (!priorBlock) {
            throw new Error(
                `Prior block not found for fork ${forkId}, transaction ${transactionCnt - 1}`
            );
        }

        const priorBlockOriginalSignature =
            this.agreementManager.getOriginalSignature(priorBlock);

        if (!priorBlockOriginalSignature) {
            throw new Error(
                `Prior block signature not found for fork ${forkId}, transaction ${transactionCnt - 1}`
            );
        }

        const priorEncodedState = this.agreementManager.getEncodedState(
            forkId,
            transactionCnt
        );

        if (!priorEncodedState) {
            throw new Error(
                `Prior encoded state not found for fork ${forkId}, transaction ${transactionCnt}`
            );
        }

        return {
            block1: incorrectBlockSigned,
            block2: {
                encodedBlock: Codec.encode(priorBlock, Type.Block),
                signature: priorBlockOriginalSignature as string
            },
            encodedState: priorEncodedState
        };
    }
}

export default ProofManager;

import { ethers } from "ethers";
import * as dt from "@typechain-types/contracts/V1/types/DisputeTypes";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { getEthersTypeForDisputeProof, FraudProofType } from "@/types/disputes";
import { Codec } from "@/utils";
import Clock from "@/Clock";
import AgreementManager from "@/agreementManager";
import { Address, BlockHeight, Bytes, ForkId } from "./types/types";
import { Block } from "./models";

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
        encodedProof: Bytes
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
        transactionCnt: BlockHeight
    ): dt.ProofStruct | undefined {
        const block = this.agreementManager.getBlock(
            forkId,
            Number(transactionCnt)
        );
        if (!block) return undefined;
        if (!this.agreementManager.didEveryoneSignBlock(block))
            return undefined;

        const foldRechallengeProofStruct: dt.FoldRechallengeProofStruct = {
            encodedBlock: block.encode(),
            signatures: this.agreementManager.getSigantures(block)
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
        const incorrectBlock = Block.decode(incorrectBlockSigned.encodedBlock);

        const isGenesisBlock = incorrectBlock.height <= 0;

        const incorrectDataProofStruct = isGenesisBlock
            ? this.createGenesisBlockIncorrectDataProof(
                  incorrectBlockSigned,
                  incorrectBlock.forkId
              )
            : this.createRegularBlockIncorrectDataProof(
                  incorrectBlockSigned,
                  incorrectBlock.forkId,
                  incorrectBlock.height
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
        participantAdr: Address,
        currentTransactionCnt: BlockHeight
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
            encodedBlock: signedBlock.block.encode(),
            confirmationSignature: signedBlock.signature
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
        transactionCnt: BlockHeight
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

        const block = Block.decode(foldRechallengeProof.encodedBlock);
        const sameTransactionCnt =
            block.height === dispute.foldedTransactionCnt;
        const sameParticipant = block.author === dispute.timedoutParticipant;

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
            const block1 = Block.decode(doubleSign.block1.encodedBlock);
            return !dispute.slashedParticipants.includes(block1.author);
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

        const block2 = Block.decode(incorrectDataProof.block2.encodedBlock);

        return !dispute.slashedParticipants.includes(block2.author);
    }

    public static isNewerStateValid(
        proof: dt.ProofStruct,
        dispute: dt.DisputeStruct
    ): boolean {
        const newerStateProof = ProofManager.decodeProof(
            FraudProofType.NewerState,
            proof.encodedProof
        ) as dt.NewerStateProofStruct;

        const block = Block.decode(newerStateProof.encodedBlock);

        if (dispute.virtualVotingBlocks.length === 0) return false;

        const latestBlock = Block.decode(
            dispute.virtualVotingBlocks[dispute.virtualVotingBlocks.length - 1]
                .encodedBlock
        );

        return (
            !dispute.slashedParticipants.includes(block.author) &&
            block.author === dispute.postedStateDisputer &&
            block.height > latestBlock.height
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

        const block = Block.decode(
            blockTooFarInFutureProof.block1.encodedBlock
        );

        return (
            block.timestamp > Clock.getTimeInSeconds() &&
            !dispute.slashedParticipants.includes(block.author)
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
        transactionCnt: BlockHeight
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
                encodedBlock: priorBlock.encode(),
                signature: priorBlockOriginalSignature
            },
            encodedState: priorEncodedState
        };
    }
}

export default ProofManager;

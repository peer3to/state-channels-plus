import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { ZeroHash } from "ethers";
import { Address, Hash, Signature } from "@/types/types";
import { Codec, FraudStruct } from "@/utils/Codec";
import { SignatureUtils } from "@/utils";
import { FraudProofType } from "@/types";

// ────────────────────── FRAUD PROOF SERVICE ─────────────────────

/**
 * Service class for handling fraud proof creation and validation
 */
export default class FraudProofService {
    constructor(private readonly storage: Storage) {}

    /**
     * Create invalid state transition proof
     */
    createInvalidStateTransitionProof(
        coordinates: BlockCoordinates,
        signedBlock: SignedBlockStruct
    ): Hash {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;
        const previousBlockOrSnapshot =
            this.storage.getPreviousBlockOrSnapshot(coordinates);

        if (previousBlockOrSnapshot.blockConfirmation) {
            // Height > 0 case - we have a previous block
            prevSignedBlock =
                previousBlockOrSnapshot.blockConfirmation.signedBlock;
            const prevBlock = Block.decode(prevSignedBlock!.encodedBlock);
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = ZeroHash as unknown as SignedBlockStruct;
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        }

        const proof: BlockInvalidStateTransitionProofStruct = {
            invalidBlock: signedBlock,
            previousBlock: prevSignedBlock,
            previousBlockStateSnapshot: prevStateSnapshot.toStruct(),
            previousStateStateMachineState:
                this.storage.stateMachineStates.getStateMachineState(
                    prevStateSnapshot.stateMachineStateHash
                )!
        };

        const participant = SignatureUtils.getSignerAddress(
            signedBlock.encodedBlock,
            signedBlock.signature as Signature
        );

        return this.storeFraudProof(participant, {
            type: FraudProofType.BlockInvalidStateTransition,
            struct: proof
        });
    }

    /**
     * Create invalid timestamp proof
     */
    createInvalidTimestampProof(
        coordinates: BlockCoordinates,
        signedBlock: SignedBlockStruct
    ): Hash {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;
        const previousBlockOrSnapshot =
            this.storage.getPreviousBlockOrSnapshot(coordinates);

        if (previousBlockOrSnapshot.blockConfirmation) {
            // Height > 0 case - we have a previous block
            prevSignedBlock =
                previousBlockOrSnapshot.blockConfirmation.signedBlock;
            const prevBlock = Block.decode(prevSignedBlock!.encodedBlock);
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = ZeroHash as unknown as SignedBlockStruct;
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        }

        const proof: InvalidTimestampProofStruct = {
            invalidBlock: signedBlock,
            previousBlock: prevSignedBlock,
            previousStateSnapshot: prevStateSnapshot.toStruct()
        };

        const participant = SignatureUtils.getSignerAddress(
            signedBlock.encodedBlock,
            signedBlock.signature as Signature
        );

        return this.storeFraudProof(participant, {
            type: FraudProofType.InvalidTimestamp,
            struct: proof
        });
    }

    createDoubleSignProof(
        conflictingSignedBlock: SignedBlockStruct,
        signedBlock: SignedBlockStruct
    ): Hash {
        const proof: BlockDoubleSignProofStruct = {
            block1: conflictingSignedBlock,
            block2: signedBlock
        };

        const participant1 = SignatureUtils.getSignerAddress(
            conflictingSignedBlock.encodedBlock,
            conflictingSignedBlock.signature as Signature
        );

        return this.storeFraudProof(participant1, {
            type: FraudProofType.BlockDoubleSign,
            struct: proof
        });
    }

    private storeFraudProof(
        participant: Address,
        proof: { type: FraudProofType; struct: FraudStruct }
    ): Hash {
        const fraudProof: FraudProofStruct = {
            proofType: proof.type,
            participant,
            encodedProof: Codec.encode(proof.struct, proof.type)
        };

        return this.storage.fraudProofs.storeFraudProof(fraudProof);
    }
}

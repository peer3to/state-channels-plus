import Storage from "@/storage";
import { Block, BlockCoordinates, StateSnapshot } from "@/models";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";
import { ZeroHash } from "ethers";

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
    ): BlockInvalidStateTransitionProofStruct {
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

        return {
            invalidBlock: signedBlock,
            previousBlock: prevSignedBlock,
            previousBlockStateSnapshot: prevStateSnapshot.toStruct(),
            previousStateStateMachineState:
                this.storage.stateMachineStates.getStateMachineState(
                    prevStateSnapshot.stateMachineStateHash
                )!
        };
    }

    /**
     * Create invalid timestamp proof
     */
    createInvalidTimestampProof(
        coordinates: BlockCoordinates,
        signedBlock: SignedBlockStruct
    ): InvalidTimestampProofStruct {
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
            prevSignedBlock = NULL as unknown as SignedBlockStruct;
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        }

        return {
            invalidBlock: signedBlock,
            previousBlock: prevSignedBlock,
            previousStateSnapshot: prevStateSnapshot.toStruct()
        };
    }

    createDoubleSignProof(
        conflictingSignedBlock: SignedBlockStruct,
        signedBlock: SignedBlockStruct
    ): BlockDoubleSignProofStruct {
        return {
            block1: conflictingSignedBlock,
            block2: signedBlock
        };
    }
}

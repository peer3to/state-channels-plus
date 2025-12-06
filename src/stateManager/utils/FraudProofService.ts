import Storage from "@/storage";
import { Block, StateSnapshot } from "@/models";
import {
    MessageBlockStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct,
    WrongGenesisProofStruct,
    ForgedInboundMessageBlockProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";
import { FraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { Address, Hash } from "@/types/types";
import { Codec, FraudStruct } from "@/utils/Codec";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";

const createEmptySignedBlock = (): SignedBlockStruct => ({
    encodedBlock: "0x",
    signature: "0x"
});

// ────────────────────── FRAUD PROOF SERVICE ─────────────────────

/**
 * Service class for handling fraud proof creation and validation
 */
export default class FraudProofService {
    constructor(private readonly storage: Storage) {}

    /**
     * Create invalid state transition proof
     */
    createInvalidStateTransitionProof(block: Block): Hash {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            block.coordinates
        );

        if (previousBlockOrSnapshot.block) {
            // Height > 0 case - we have a previous block
            prevSignedBlock = previousBlockOrSnapshot.block.signedBlock;
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    previousBlockOrSnapshot.block.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = createEmptySignedBlock();
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        }

        const proof: BlockInvalidStateTransitionProofStruct = {
            invalidBlock: block.signedBlock,
            previousBlock: prevSignedBlock,
            previousBlockStateSnapshot: prevStateSnapshot.toStruct(),
            previousStateStateMachineState:
                this.storage.stateMachineStates.getStateMachineState(
                    prevStateSnapshot.stateMachineStateHash
                )!
        };

        return this.storeFraudProof(block.signerAddress, {
            type: FraudProofType.BlockInvalidStateTransition,
            struct: proof
        });
    }

    /**
     * Create invalid timestamp proof
     */
    createInvalidTimestampProof(block: Block): Hash {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            block.coordinates
        );

        if (previousBlockOrSnapshot.block) {
            // Height > 0 case - we have a previous block
            const prevBlock = previousBlockOrSnapshot.block;
            prevSignedBlock = prevBlock.signedBlock;
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = createEmptySignedBlock();
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        }

        const proof: InvalidTimestampProofStruct = {
            invalidBlock: block.signedBlock,
            previousBlock: prevSignedBlock,
            previousStateSnapshot: prevStateSnapshot.toStruct()
        };

        return this.storeFraudProof(block.signerAddress, {
            type: FraudProofType.InvalidTimestamp,
            struct: proof
        });
    }

    createDoubleSignProof(conflictingBlock: Block, originalBlock: Block): Hash {
        const proof: BlockDoubleSignProofStruct = {
            block1: conflictingBlock.signedBlock,
            block2: originalBlock.signedBlock
        };

        return this.storeFraudProof(originalBlock.signerAddress, {
            type: FraudProofType.BlockDoubleSign,
            struct: proof
        });
    }
    createWrongGenesisProof(block: Block): Hash {
        const proof: WrongGenesisProofStruct = {
            invalidBlock: block.signedBlock,
            genesisSnapshot:
                this.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                    block.forkId
                )!
        };

        return this.storeFraudProof(block.signerAddress, {
            type: FraudProofType.WrongGenesis,
            struct: proof
        });
    }

    createForgedInboundMessageBlockProof(
        block: Block,
        messageBlock: MessageBlockStruct
    ): Hash {
        const proof: ForgedInboundMessageBlockProofStruct = {
            invalidBlock: block.signedBlock,
            forgedInboundMessageBlock: messageBlock
        };

        return this.storeFraudProof(block.signerAddress, {
            type: FraudProofType.ForgedInboundMessageBlock,
            struct: proof
        });
    }

    private storeFraudProof(
        participant: Address,
        proof: { type: FraudProofType; struct: FraudStruct }
    ): Hash {
        const fraudProof: FraudProofStruct = {
            proofType: toSolidityFraudProofType(proof.type),
            participant,
            encodedProof: Codec.encode(proof.struct, proof.type)
        };

        return this.storage.fraudProofs.storeFraudProof(fraudProof);
    }
}

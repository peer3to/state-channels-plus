import Storage from "@/storage";
import { Block, StateSnapshot } from "@/models";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    BlockDoubleSignProofStruct,
    BlockInvalidStateTransitionProofStruct,
    InvalidTimestampProofStruct
} from "@typechain-types/contracts/V1/types/FraudProofTypes";
import { PreviousEntity } from "./channelValidation";

const NULL = "0x00";

// ────────────────────── CUSTOM EXCEPTIONS ─────────────────────

/**
 * Base class for validation fraud exceptions
 */
export abstract class ValidationFraudException extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class DoubleSignException extends ValidationFraudException {
    constructor(
        public readonly block1: SignedBlockStruct,
        public readonly block2: SignedBlockStruct
    ) {
        super("Double sign fraud detected");
    }
}

export class InvalidStateTransitionException extends ValidationFraudException {
    constructor(
        public readonly previousEntity: PreviousEntity,
        public readonly invalidBlock: SignedBlockStruct
    ) {
        super("Invalid state transition fraud detected");
    }
}

export class InvalidTimestampException extends ValidationFraudException {
    constructor(
        public readonly previousEntity: PreviousEntity,
        public readonly invalidBlock: SignedBlockStruct
    ) {
        super("Invalid timestamp fraud detected");
    }
}

export class InvalidLeaderException extends ValidationFraudException {
    constructor(
        public readonly previousEntity: PreviousEntity,
        public readonly invalidBlock: SignedBlockStruct
    ) {
        super("Invalid leader fraud detected");
    }
}

// ────────────────────── FRAUD PROOF SERVICE ─────────────────────

/**
 * Service class for handling fraud proof creation and validation
 */
export class FraudProofService {
    constructor(private readonly storage: Storage) {}

    /**
     * Create invalid state transition proof
     */
    createInvalidStateTransitionProof(
        previousEntity: PreviousEntity,
        signedBlock: SignedBlockStruct
    ): BlockInvalidStateTransitionProofStruct {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;

        if (previousEntity.blockConfirmation) {
            // Height > 0 case - we have a previous block
            prevSignedBlock = previousEntity.blockConfirmation.signedBlock;
            const prevBlock = Block.decode(prevSignedBlock!.encodedBlock);
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = NULL as unknown as SignedBlockStruct;
            prevStateSnapshot = previousEntity.stateSnapshot!;
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
        previousEntity: PreviousEntity,
        signedBlock: SignedBlockStruct
    ): InvalidTimestampProofStruct {
        let prevSignedBlock: SignedBlockStruct | undefined;
        let prevStateSnapshot: StateSnapshot;

        if (previousEntity.blockConfirmation) {
            // Height > 0 case - we have a previous block
            prevSignedBlock = previousEntity.blockConfirmation.signedBlock;
            const prevBlock = Block.decode(prevSignedBlock!.encodedBlock);
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = NULL as unknown as SignedBlockStruct;
            prevStateSnapshot = previousEntity.stateSnapshot!;
        }

        return {
            invalidBlock: signedBlock,
            previousBlock: prevSignedBlock,
            previousStateSnapshot: prevStateSnapshot.toStruct()
        };
    }

    /**
     * Fraud proof creators mapped by exception name
     */
    private readonly fraudProofCreators = {
        [DoubleSignException.name]: (error: ValidationFraudException) =>
            ({
                block1: (error as DoubleSignException).block1,
                block2: (error as DoubleSignException).block2
            }) as BlockDoubleSignProofStruct,

        [InvalidStateTransitionException.name]: (
            error: ValidationFraudException
        ) =>
            this.createInvalidStateTransitionProof(
                (error as InvalidStateTransitionException).previousEntity,
                (error as InvalidStateTransitionException).invalidBlock
            ),

        [InvalidTimestampException.name]: (error: ValidationFraudException) =>
            this.createInvalidTimestampProof(
                (error as InvalidTimestampException).previousEntity,
                (error as InvalidTimestampException).invalidBlock
            ),

        [InvalidLeaderException.name]: (error: ValidationFraudException) =>
            this.createInvalidStateTransitionProof(
                (error as InvalidLeaderException).previousEntity,
                (error as InvalidLeaderException).invalidBlock
            )
    };

    /**
     * Create a fraud proof from a validation exception
     */
    createFraudProof(error: ValidationFraudException): any {
        const creator = this.fraudProofCreators[error.constructor.name];
        if (!creator) {
            throw new Error(
                `No fraud proof creator found for ${error.constructor.name}`
            );
        }
        return creator(error);
    }
}

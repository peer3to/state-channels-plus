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
import { Logger } from "@/utils";
import { Codec, FraudStruct } from "@/utils/Codec";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import { LoggerUtils } from "@/utils/LoggerUtils";

const createEmptySignedBlock = (): SignedBlockStruct => ({
    encodedBlock: "0x",
    signature: "0x"
});

// ────────────────────── FRAUD PROOF SERVICE ─────────────────────

/**
 * Service class for handling fraud proof creation and validation
 */
export default class FraudProofService {
    constructor(
        private readonly storage: Storage,
        private readonly logger: Logger
    ) {
        this.logger = logger.child({ component: "FraudProofService" });
    }

    private logFraudDetection({
        fraudType,
        reason,
        block,
        additionalFields
    }: {
        fraudType: FraudProofType;
        reason: string;
        block: Block;
        additionalFields?: Record<string, any>;
    }): void {
        const fraudTypeName = LoggerUtils.enumToString(
            FraudProofType,
            fraudType
        );
        this.logger.debug(`Fraud proof created: ${fraudTypeName}`, {
            reason,
            blockHeight: block.height,
            blockAuthor: block.author,
            blockHash: block.hash,
            fraudType: fraudTypeName,
            ...additionalFields
        });
        console.trace(`Fraud detected: ${fraudTypeName}`);
    }

    /**
     * Create invalid state transition proof
     */
    createInvalidStateTransitionProof(block: Block): Hash {
        this.logFraudDetection({
            fraudType: FraudProofType.BlockInvalidStateTransition,
            reason: "Block author is not next leader OR state transition is invalid",
            block
        });

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
        this.logFraudDetection({
            fraudType: FraudProofType.InvalidTimestamp,
            reason: "Block timestamp is invalid or inconsistent with previous block",
            block,
            additionalFields: {
                blockTimestamp: block.timestamp
            }
        });

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
        this.logFraudDetection({
            fraudType: FraudProofType.BlockDoubleSign,
            reason: "Participant signed two conflicting blocks at same height",
            block: conflictingBlock,
            additionalFields: {
                participant: originalBlock.signerAddress,
                originalBlockAuthor: originalBlock.author
            }
        });

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
        this.logFraudDetection({
            fraudType: FraudProofType.WrongGenesis,
            reason: "Block at height 0 doesn't link to correct genesis state",
            block
        });

        const proof: WrongGenesisProofStruct = {
            invalidBlock: block.signedBlock,
            genesisSnapshot: this.storage.stateSnapshots
                .getGenesisSnapshotByForkId(block.forkId)!
                .toStruct()
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
        this.logFraudDetection({
            fraudType: FraudProofType.ForgedInboundMessageBlock,
            reason: "Block references invalid or forged inbound message block",
            block
        });

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

        const proofHash = this.storage.fraudProofs.storeFraudProof(fraudProof);

        return proofHash;
    }
}

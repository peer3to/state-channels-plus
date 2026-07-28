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
import { Address, Bytes, Hash, Signature } from "@/types/types";
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
        // A fraudulent block may lie about its transactionCnt, so the normal
        // coordinate lookup at height - 1 can miss its real predecessor. Fall
        // back to previousBlockHash, which identifies the block the submitted
        // block actually claims to extend.
        const previousBlock =
            previousBlockOrSnapshot.block ??
            (block.height > 0
                ? this.storage.blocks.getBlock(block.previousBlockHash)
                : undefined);

        if (previousBlock) {
            // Height > 0 case - we have a previous block
            prevSignedBlock = previousBlock.signedBlock;
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    previousBlock.stateSnapshotHash
                )!;
        } else if (block.height === 0) {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = createEmptySignedBlock();
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        } else {
            throw new Error(
                `Cannot create invalid state transition proof: previous block ${block.previousBlockHash} is missing`
            );
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

    buildInvalidTimestampProof(block: Block): InvalidTimestampProofStruct {
        let prevSignedBlock: SignedBlockStruct;
        let prevStateSnapshot: StateSnapshot;
        const previousBlockOrSnapshot = this.storage.getPreviousBlockOrSnapshot(
            block.coordinates
        );

        let participantSignatureOnPreviousBlock = "0x" as Signature;
        let previousBlockOnChainTimestamp = 0n;

        if (previousBlockOrSnapshot.block) {
            // Height > 0 case - we have a previous block
            const prevBlock = previousBlockOrSnapshot.block;
            prevSignedBlock = prevBlock.signedBlock;
            prevStateSnapshot =
                this.storage.stateSnapshots.getStateSnapshotByHash(
                    prevBlock.stateSnapshotHash
                )!;
            const authorSignedPrevious = prevBlock.findSignature(block.author);
            if (authorSignedPrevious) {
                participantSignatureOnPreviousBlock = authorSignedPrevious;
            } else if (prevBlock.onChainTimestamp !== undefined) {
                previousBlockOnChainTimestamp = BigInt(
                    prevBlock.onChainTimestamp
                );
            }
        } else {
            // Height === 0 case - we have genesis state snapshot
            prevSignedBlock = createEmptySignedBlock();
            prevStateSnapshot = previousBlockOrSnapshot.stateSnapshot!;
        }

        return {
            invalidBlock: block.signedBlock,
            previousBlock: prevSignedBlock,
            previousStateSnapshot: prevStateSnapshot.toStruct(),
            participantSignatureOnPreviousBlock:
                participantSignatureOnPreviousBlock as Bytes,
            previousBlockOnChainTimestamp
        };
    }

    createInvalidTimestampProof(block: Block): Hash {
        this.logFraudDetection({
            fraudType: FraudProofType.InvalidTimestamp,
            reason: "Block timestamp is invalid or inconsistent with previous block",
            block,
            additionalFields: {
                blockTimestamp: block.timestamp
            }
        });

        const proof = this.buildInvalidTimestampProof(block);

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
        const genesisSnapshot =
            this.storage.stateSnapshots.getGenesisSnapshotByForkId(
                block.forkId
            );
        if (!genesisSnapshot) {
            throw new Error(
                `Missing genesis snapshot for fork ${block.forkId} - cannot build WrongGenesis proof`
            );
        }

        this.logFraudDetection({
            fraudType: FraudProofType.WrongGenesis,
            reason: "Block at height 0 doesn't link to correct genesis state",
            block
        });

        const proof: WrongGenesisProofStruct = {
            invalidBlock: block.signedBlock,
            genesisSnapshot: genesisSnapshot.toStruct()
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

        return this.storage.fraudProofs.storeFraudProof(fraudProof);
    }
}

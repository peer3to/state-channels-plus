import { Block, StateSnapshot } from "@/models";
import Storage from "@/storage";
import type { BlockPredecessor } from "@/storage/QueueStorage";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import { Address, Bytes, Hash, Signature } from "@/types/types";
import { Logger } from "@/utils";
import { Codec, FraudStruct } from "@/utils/Codec";
import { LoggerUtils } from "@/utils/LoggerUtils";
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
     * Create invalid state transition proof: `block` judged from its
     * predecessor - the block it names by previousBlockHash (none at height
     * 0), that block's resulting snapshot and state. The chain replays from
     * that snapshot. Dispute replay passes its predecessor; live gossip reads
     * it from storage by hash, and without it no proof is valid on chain:
     * abstain (undefined).
     */
    createInvalidStateTransitionProof(
        block: Block,
        predecessor = this.getStoredPredecessor(block)
    ): Hash | undefined {
        this.logFraudDetection({
            fraudType: FraudProofType.BlockInvalidStateTransition,
            reason: "Block author is not next leader OR state transition is invalid",
            block
        });

        if (!predecessor) {
            this.logger.warn(
                "Abstaining from an invalid state transition proof: the block's predecessor or its state is not stored",
                { block: LoggerUtils.getBlockMetadata(block) }
            );
            return undefined;
        }

        const proof: BlockInvalidStateTransitionProofStruct = {
            invalidBlock: block.signedBlock,
            previousBlock:
                predecessor.block?.signedBlock ?? createEmptySignedBlock(),
            previousBlockStateSnapshot: predecessor.snapshot.toStruct(),
            previousStateStateMachineState: predecessor.state
        };

        return this.storeFraudProof(block.signerAddress, {
            type: FraudProofType.BlockInvalidStateTransition,
            struct: proof
        });
    }

    buildInvalidTimestampProof(
        block: Block,
        previous: {
            block?: Block;
            snapshot?: StateSnapshot;
        } = this.storage.getPreviousBlockAndSnapshot(block.coordinates)
    ): InvalidTimestampProofStruct {
        let prevSignedBlock: SignedBlockStruct;
        let participantSignatureOnPreviousBlock = "0x" as Signature;
        let previousBlockOnChainTimestamp = 0n;

        if (previous.block) {
            // Height > 0 case - we have a previous block
            const prevBlock = previous.block;
            prevSignedBlock = prevBlock.signedBlock;
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
        }

        return {
            invalidBlock: block.signedBlock,
            previousBlock: prevSignedBlock,
            previousStateSnapshot: previous.snapshot!.toStruct(),
            participantSignatureOnPreviousBlock:
                participantSignatureOnPreviousBlock as Bytes,
            previousBlockOnChainTimestamp
        };
    }

    createInvalidTimestampProof(
        block: Block,
        previous?: { block?: Block; snapshot?: StateSnapshot }
    ): Hash {
        this.logFraudDetection({
            fraudType: FraudProofType.InvalidTimestamp,
            reason: "Block timestamp is invalid or inconsistent with previous block",
            block,
            additionalFields: {
                blockTimestamp: block.timestamp
            }
        });

        const proof = this.buildInvalidTimestampProof(block, previous);

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

    /** The predecessor `block` names, its snapshot and state, from storage by hash. */
    private getStoredPredecessor(block: Block): BlockPredecessor | undefined {
        if (block.height === 0)
            return this.storage.getPredecessor(block.forkId);
        const previousBlock = this.storage.blocks.getBlock(
            block.previousBlockHash
        );
        return (
            previousBlock &&
            this.storage.getPredecessor(block.forkId, previousBlock)
        );
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

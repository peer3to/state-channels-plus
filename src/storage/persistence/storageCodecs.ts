import type { JoinRecord } from "../ForceJoinStorage";
import { Block } from "@/models";
import StateSnapshot from "@/models/StateSnapshot";
import type {
    BlockCalldata,
    BlockHeight,
    Bytes,
    ForkId,
    Hash
} from "@/types/types";
import { Codec, Type } from "@/utils";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeConfirmationStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type {
    DisputeFraudProofStruct,
    FraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";

import { ethers } from "ethers";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export interface PersistedBlockRecord {
    block: Block;
    coordinates: {
        forkId: ForkId;
        height: BlockHeight;
    };
    /** false for a block first stored with `justPersist` */
    advancesTip: boolean;
}

export interface MessageBlockHead {
    hash: Hash;
    height: BlockHeight;
}

type ValueCodec<TValue> = {
    encode(value: TValue): string;
    decode(encodedValue: string): TValue;
};

const BLOCK_TYPES = ["bytes", "bool", "uint256", "bytes32", "uint256", "bool"];
const blockCodec: ValueCodec<PersistedBlockRecord> = {
    encode: (record) =>
        abiCoder.encode(BLOCK_TYPES, [
            Codec.encode(
                record.block.blockConfirmationStruct,
                Type.BlockConfirmation
            ),
            record.block.onChainTimestamp !== undefined,
            record.block.onChainTimestamp ?? 0,
            record.coordinates.forkId,
            record.coordinates.height,
            record.advancesTip
        ]),
    decode: (encodedValue) => {
        const [
            encodedConfirmation,
            hasOnChainTimestamp,
            onChainTimestamp,
            forkId,
            height,
            advancesTip
        ] = abiCoder.decode(BLOCK_TYPES, encodedValue);
        return {
            block: Block.fromBlockConfirmation(
                Codec.decode(encodedConfirmation, Type.BlockConfirmation),
                hasOnChainTimestamp ? Number(onChainTimestamp) : undefined
            ),
            coordinates: { forkId: forkId as ForkId, height: Number(height) },
            advancesTip
        };
    }
};

const messageBlockCodec: ValueCodec<MessageBlockStruct> = {
    encode: (block) => ethers.hexlify(Codec.encode(block, Type.MessageBlock)),
    decode: (encodedValue) => Codec.decode(encodedValue, Type.MessageBlock)
};

const messageHeadCodec: ValueCodec<MessageBlockHead> = {
    encode: (head) =>
        abiCoder.encode(["bytes32", "uint256"], [head.hash, head.height]),
    decode: (encodedValue) => {
        const [hash, height] = abiCoder.decode(
            ["bytes32", "uint256"],
            encodedValue
        );
        return { hash: hash as Hash, height: Number(height) };
    }
};

const hashCodec: ValueCodec<Hash> = {
    encode: (value) => abiCoder.encode(["bytes32"], [value]),
    decode: (encodedValue) => abiCoder.decode(["bytes32"], encodedValue)[0]
};

const boolCodec: ValueCodec<boolean> = {
    encode: (value) => abiCoder.encode(["bool"], [value]),
    decode: (encodedValue) => abiCoder.decode(["bool"], encodedValue)[0]
};

const snapshotCodec: ValueCodec<StateSnapshot> = {
    encode: (snapshot) => ethers.hexlify(snapshot.encode()),
    decode: (encodedValue) => StateSnapshot.decode(encodedValue)
};

const stateCodec: ValueCodec<Bytes> = {
    encode: (encodedState) => ethers.hexlify(encodedState),
    decode: (encodedValue) => encodedValue
};

const changePointsCodec: ValueCodec<Set<BlockHeight>> = {
    encode: (heights) =>
        abiCoder.encode(["uint256[]"], [[...heights].sort((a, b) => a - b)]),
    decode: (encodedValue) => {
        const [heights] = abiCoder.decode(["uint256[]"], encodedValue);
        return new Set((heights as bigint[]).map(Number));
    }
};

const disputeCodec: ValueCodec<DisputeConfirmationStruct> = {
    encode: (confirmation) =>
        ethers.hexlify(Codec.encode(confirmation, Type.DisputeConfirmation)),
    decode: (encodedValue) =>
        Codec.decode(encodedValue, Type.DisputeConfirmation)
};

const FRAUD_PROOF_TYPES = ["uint256", "address", "bytes"];
const fraudProofCodec: ValueCodec<FraudProofStruct> = {
    encode: (proof) =>
        abiCoder.encode(FRAUD_PROOF_TYPES, [
            proof.proofType,
            proof.participant,
            proof.encodedProof
        ]),
    decode: (encodedValue) => {
        const [proofType, participant, encodedProof] = abiCoder.decode(
            FRAUD_PROOF_TYPES,
            encodedValue
        );
        return { proofType, participant, encodedProof };
    }
};

const DISPUTE_FRAUD_PROOF_TYPES = ["uint256", "address", "bytes", "bytes"];
const disputeFraudProofCodec: ValueCodec<DisputeFraudProofStruct> = {
    encode: (proof) =>
        abiCoder.encode(DISPUTE_FRAUD_PROOF_TYPES, [
            proof.proofType,
            proof.participant,
            Codec.encode(proof.dispute, Type.Dispute),
            proof.encodedProof
        ]),
    decode: (encodedValue) => {
        const [proofType, participant, encodedDispute, encodedProof] =
            abiCoder.decode(DISPUTE_FRAUD_PROOF_TYPES, encodedValue);
        return {
            proofType,
            participant,
            dispute: Codec.decode(encodedDispute, Type.Dispute),
            encodedProof
        };
    }
};

const timeoutCodec: ValueCodec<TimeoutStruct> = {
    encode: (timeout) => ethers.hexlify(Codec.encode(timeout, Type.Timeout)),
    decode: (encodedValue) => Codec.decode(encodedValue, Type.Timeout)
};

// each optional field is a presence flag and a value
const JOIN_TYPES = [
    "uint256 id",
    "int256 submissionHeight",
    "uint256 authorizationDeadline",
    "bool hasCountingStartsAt",
    "uint256 countingStartsAt",
    "bool hasCountingFromHeight",
    "int256 countingFromHeight",
    "bool hasLatestCountedHeight",
    "int256 latestCountedHeight",
    "bool isForceJoinDeadlinePassed",
    "bool isDisputeStarted",
    "bool hasIsRetrying",
    "bool isRetrying"
];
const joinCodec: ValueCodec<JoinRecord> = {
    encode: (join) =>
        abiCoder.encode(JOIN_TYPES, [
            join.id,
            join.submissionHeight,
            join.authorizationDeadline,
            join.countingStartsAt !== undefined,
            join.countingStartsAt ?? 0,
            join.countingFromHeight !== undefined,
            join.countingFromHeight ?? 0,
            join.latestCountedHeight !== undefined,
            join.latestCountedHeight ?? 0,
            join.isForceJoinDeadlinePassed,
            join.isDisputeStarted,
            join.isRetrying !== undefined,
            join.isRetrying ?? false
        ]),
    decode: (encodedValue) => {
        const join = abiCoder.decode(JOIN_TYPES, encodedValue);
        return {
            id: Number(join.id),
            submissionHeight: Number(join.submissionHeight),
            authorizationDeadline: Number(join.authorizationDeadline),
            ...(join.hasCountingStartsAt && {
                countingStartsAt: Number(join.countingStartsAt)
            }),
            ...(join.hasCountingFromHeight && {
                countingFromHeight: Number(join.countingFromHeight)
            }),
            ...(join.hasLatestCountedHeight && {
                latestCountedHeight: Number(join.latestCountedHeight)
            }),
            isForceJoinDeadlinePassed: join.isForceJoinDeadlinePassed,
            isDisputeStarted: join.isDisputeStarted,
            ...(join.hasIsRetrying && { isRetrying: join.isRetrying })
        };
    }
};

const blockCalldataCodec: ValueCodec<BlockCalldata> = {
    encode: (calldata) =>
        abiCoder.encode(
            ["bytes", "uint256"],
            [
                Codec.encode(calldata.signedBlock, Type.SignedBlock),
                calldata.onChainTimestamp
            ]
        ),
    decode: (encodedValue) => {
        const [encodedSignedBlock, onChainTimestamp] = abiCoder.decode(
            ["bytes", "uint256"],
            encodedValue
        );
        return {
            signedBlock: Codec.decode(encodedSignedBlock, Type.SignedBlock),
            onChainTimestamp: Number(onChainTimestamp)
        };
    }
};

const blockNumberCodec: ValueCodec<number> = {
    encode: (blockNumber) => abiCoder.encode(["uint256"], [blockNumber]),
    decode: (encodedValue) =>
        Number(abiCoder.decode(["uint256"], encodedValue)[0])
};

/** One codec per persisted collection; its keys are the collection ids. */
export const codecs = {
    blocks: blockCodec,
    inboundMessages: messageBlockCodec,
    outboundMessages: messageBlockCodec,
    inboundMessagesHead: messageHeadCodec,
    outboundMessagesHead: messageHeadCodec,
    stateSnapshots: snapshotCodec,
    genesisSnapshots: hashCodec,
    headFork: hashCodec,
    stateMachineStates: stateCodec,
    participantSetChanges: changePointsCodec,
    disputes: disputeCodec,
    disputedForks: boolCodec,
    fraudProofs: fraudProofCodec,
    disputeFraudProofs: disputeFraudProofCodec,
    timeout: timeoutCodec,
    forceExit: boolCodec,
    forceJoin: joinCodec,
    blockCalldata: blockCalldataCodec,
    eventSync: blockNumberCodec
};

export type CollectionId = keyof typeof codecs;
export type CollectionValue<TId extends CollectionId> = ReturnType<
    (typeof codecs)[TId]["decode"]
>;

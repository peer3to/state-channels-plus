import type { JoinRecord } from "../ForceJoinStorage";
import type { BlockOrigin, QueuedBlockEntry } from "../QueueStorage";
import { Block } from "@/models";

import StateSnapshot from "@/models/StateSnapshot";
import type {
    Address,
    BlockCalldata,
    BlockHeight,
    Bytes,
    ForkId,
    Hash,
    Signature
} from "@/types/types";
import { Codec, Type } from "@/utils";
import { getChecksumAddress } from "@/utils/address";
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
    advancesTip: boolean;
}

export interface PersistedMessageBlockRecord {
    block: MessageBlockStruct;
    advancesTip: boolean;
}

export interface PersistenceValueCodec<TValue> {
    encode(value: TValue): string;
    decode(encodedValue: string): TValue;
}

function blockCodec(): PersistenceValueCodec<PersistedBlockRecord> {
    return {
        encode: (record) => {
            const encodedConfirmation = Codec.encode(
                record.block.blockConfirmationStruct,
                Type.BlockConfirmation
            );
            return abiCoder.encode(
                ["bytes", "bool", "uint256", "bytes32", "uint256", "bool"],
                [
                    encodedConfirmation,
                    record.block.onChainTimestamp !== undefined,
                    record.block.onChainTimestamp ?? 0,
                    record.coordinates.forkId,
                    record.coordinates.height,
                    record.advancesTip
                ]
            );
        },
        decode: (encodedValue) => {
            const [
                encodedConfirmation,
                hasOnChainTimestamp,
                onChainTimestamp,
                forkId,
                height,
                advancesTip
            ] = abiCoder.decode(
                ["bytes", "bool", "uint256", "bytes32", "uint256", "bool"],
                encodedValue
            );
            const block = Block.fromBlockConfirmation(
                Codec.decode(encodedConfirmation, Type.BlockConfirmation),
                hasOnChainTimestamp ? Number(onChainTimestamp) : undefined
            );
            return {
                block,
                coordinates: {
                    forkId: forkId as ForkId,
                    height: Number(height)
                },
                advancesTip
            };
        }
    };
}

function messageCodec(): PersistenceValueCodec<PersistedMessageBlockRecord> {
    return {
        encode: (record) =>
            abiCoder.encode(
                ["bytes", "bool"],
                [
                    Codec.encode(record.block, Type.MessageBlock),
                    record.advancesTip
                ]
            ),
        decode: (encodedValue) => {
            const [encodedBlock, advancesTip] = abiCoder.decode(
                ["bytes", "bool"],
                encodedValue
            );
            return {
                block: Codec.decode(encodedBlock, Type.MessageBlock),
                advancesTip
            };
        }
    };
}

function queueCodec(): PersistenceValueCodec<QueuedBlockEntry> {
    const types = [
        "bytes",
        "uint256",
        "uint8",
        "tuple(address source,bytes[] signatures)[]",
        "bool",
        "uint256"
    ];
    return {
        encode: (entry) =>
            abiCoder.encode(types, [
                Codec.encode(
                    entry.block.blockConfirmationStruct,
                    Type.BlockConfirmation
                ),
                entry.firstSeenAt,
                entry.origin,
                [...entry.sourcesToSignatures].map(([source, signatures]) => ({
                    source,
                    signatures: [...signatures]
                })),
                entry.block.onChainTimestamp !== undefined,
                entry.block.onChainTimestamp ?? 0
            ]),
        decode: (encodedValue) => {
            const [
                encodedConfirmation,
                firstSeenAt,
                origin,
                sourcesToSignatures,
                hasOnChainTimestamp,
                onChainTimestamp
            ] = abiCoder.decode(types, encodedValue);
            return {
                block: Block.fromBlockConfirmation(
                    Codec.decode(encodedConfirmation, Type.BlockConfirmation),
                    hasOnChainTimestamp ? Number(onChainTimestamp) : undefined
                ),
                firstSeenAt: Number(firstSeenAt),
                origin: Number(origin) as BlockOrigin,
                sourcesToSignatures: new Map(
                    sourcesToSignatures.map(
                        (entry: {
                            source: Address;
                            signatures: Signature[];
                        }) => [
                            getChecksumAddress(entry.source),
                            new Set(entry.signatures)
                        ]
                    )
                )
            };
        }
    };
}

function fraudProofCodec(): PersistenceValueCodec<FraudProofStruct> {
    return {
        encode: (proof) =>
            abiCoder.encode(
                ["uint256", "address", "bytes"],
                [proof.proofType, proof.participant, proof.encodedProof]
            ),
        decode: (encodedValue) => {
            const [proofType, participant, encodedProof] = abiCoder.decode(
                ["uint256", "address", "bytes"],
                encodedValue
            );
            return { proofType, participant, encodedProof };
        }
    };
}

function disputeFraudProofCodec(): PersistenceValueCodec<DisputeFraudProofStruct> {
    return {
        encode: (proof) =>
            abiCoder.encode(
                ["uint256", "address", "bytes", "bytes"],
                [
                    proof.proofType,
                    proof.participant,
                    Codec.encode(proof.dispute, Type.Dispute),
                    proof.encodedProof
                ]
            ),
        decode: (encodedValue) => {
            const [proofType, participant, encodedDispute, encodedProof] =
                abiCoder.decode(
                    ["uint256", "address", "bytes", "bytes"],
                    encodedValue
                );
            return {
                proofType,
                participant,
                dispute: Codec.decode(encodedDispute, Type.Dispute),
                encodedProof
            };
        }
    };
}

function blockCalldataCodec(): PersistenceValueCodec<BlockCalldata> {
    return {
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
}

/** One codec per persisted collection; its keys are the collection ids. */
export const codecs = {
    blocks: blockCodec(),
    inboundMessages: messageCodec(),
    outboundMessages: messageCodec(),
    stateSnapshots: {
        encode: (snapshot: StateSnapshot) => ethers.hexlify(snapshot.encode()),
        decode: (encodedValue: string) => StateSnapshot.decode(encodedValue)
    },
    // the fork of the installed state
    headFork: {
        encode: (forkId: ForkId) => abiCoder.encode(["bytes32"], [forkId]),
        decode: (encodedValue: string) =>
            abiCoder.decode(["bytes32"], encodedValue)[0] as ForkId
    },
    stateMachineStates: {
        encode: (encodedState: Bytes) => ethers.hexlify(encodedState),
        decode: (encodedValue: string) => encodedValue as Bytes
    },
    participantSetChanges: {
        encode: (heights: Set<BlockHeight>) =>
            abiCoder.encode(
                ["uint256[]"],
                [[...heights].sort((a, b) => a - b)]
            ),
        decode: (encodedValue: string) => {
            const [heights] = abiCoder.decode(["uint256[]"], encodedValue);
            return new Set(
                (heights as bigint[]).map((height) => Number(height))
            );
        }
    },
    queues: queueCodec(),
    disputes: {
        encode: (confirmation: DisputeConfirmationStruct) =>
            ethers.hexlify(
                Codec.encode(confirmation, Type.DisputeConfirmation)
            ),
        decode: (encodedValue: string) =>
            Codec.decode(encodedValue, Type.DisputeConfirmation)
    },
    disputedForks: {
        encode: (value: boolean) => abiCoder.encode(["bool"], [value]),
        decode: (encodedValue: string): boolean =>
            abiCoder.decode(["bool"], encodedValue)[0]
    },
    fraudProofs: fraudProofCodec(),
    disputeFraudProofs: disputeFraudProofCodec(),
    timeout: {
        encode: (timeout: TimeoutStruct) =>
            ethers.hexlify(Codec.encode(timeout, Type.Timeout)),
        decode: (encodedValue: string) =>
            Codec.decode(encodedValue, Type.Timeout)
    },
    forceExit: {
        encode: (value: boolean) => abiCoder.encode(["bool"], [value]),
        decode: (encodedValue: string): boolean =>
            abiCoder.decode(["bool"], encodedValue)[0]
    },
    // hex: the record envelope holds bytes
    forceJoin: {
        encode: (join: JoinRecord) =>
            ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(join))),
        decode: (encodedValue: string) =>
            JSON.parse(ethers.toUtf8String(encodedValue)) as JoinRecord
    },
    blockCalldata: blockCalldataCodec(),
    eventSync: {
        encode: (value: number) => abiCoder.encode(["uint256"], [value]),
        decode: (encodedValue: string) =>
            Number(abiCoder.decode(["uint256"], encodedValue)[0])
    }
};

export type CollectionId = keyof typeof codecs;

import { ethers } from "ethers";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    DisputeConfirmationStruct,
    TimeoutStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import type {
    DisputeFraudProofStruct,
    FraudProofStruct
} from "@typechain-types/contracts/V1/types/ProofTypes";

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

import type { QueuedBlockEntry } from "../QueueStorage";
import {
    PersistenceRecordCodec,
    type PersistenceValueCodec
} from "./PersistenceRecordCodec";

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

export interface RuntimeMetadata {
    activeForkId?: ForkId;
    headHash?: Hash;
    snapshotHash?: Hash;
    stateHash?: Hash;
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
    return {
        encode: (entry) =>
            abiCoder.encode(
                [
                    "bytes",
                    "uint256",
                    "address[]",
                    "tuple(bytes signature,address[] peers)[]",
                    "bool",
                    "bool",
                    "uint256"
                ],
                [
                    Codec.encode(
                        entry.block.blockConfirmationStruct,
                        Type.BlockConfirmation
                    ),
                    entry.firstSeenAt,
                    [...entry.sourcePeers],
                    [...entry.signatureSources].map(([signature, peers]) => ({
                        signature,
                        peers: [...peers]
                    })),
                    entry.overflowedSources ?? false,
                    entry.block.onChainTimestamp !== undefined,
                    entry.block.onChainTimestamp ?? 0
                ]
            ),
        decode: (encodedValue) => {
            const [
                encodedConfirmation,
                firstSeenAt,
                sourcePeers,
                signatureSources,
                overflowedSources,
                hasOnChainTimestamp,
                onChainTimestamp
            ] = abiCoder.decode(
                [
                    "bytes",
                    "uint256",
                    "address[]",
                    "tuple(bytes signature,address[] peers)[]",
                    "bool",
                    "bool",
                    "uint256"
                ],
                encodedValue
            );
            return {
                block: Block.fromBlockConfirmation(
                    Codec.decode(encodedConfirmation, Type.BlockConfirmation),
                    hasOnChainTimestamp ? Number(onChainTimestamp) : undefined
                ),
                firstSeenAt: Number(firstSeenAt),
                sourcePeers: new Set(sourcePeers),
                signatureSources: new Map(
                    signatureSources.map(
                        (entry: { signature: string; peers: string[] }) => [
                            entry.signature,
                            new Set(entry.peers)
                        ]
                    )
                ),
                overflowedSources
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

function runtimeMetadataCodec(): PersistenceValueCodec<RuntimeMetadata> {
    return {
        encode: (value) =>
            abiCoder.encode(
                [
                    "bool",
                    "bytes32",
                    "bool",
                    "bytes32",
                    "bool",
                    "bytes32",
                    "bool",
                    "bytes32"
                ],
                [
                    value.activeForkId !== undefined,
                    value.activeForkId ?? ethers.ZeroHash,
                    value.headHash !== undefined,
                    value.headHash ?? ethers.ZeroHash,
                    value.snapshotHash !== undefined,
                    value.snapshotHash ?? ethers.ZeroHash,
                    value.stateHash !== undefined,
                    value.stateHash ?? ethers.ZeroHash
                ]
            ),
        decode: (encodedValue) => {
            const [
                hasActiveForkId,
                activeForkId,
                hasHeadHash,
                headHash,
                hasSnapshotHash,
                snapshotHash,
                hasStateHash,
                stateHash
            ] = abiCoder.decode(
                [
                    "bool",
                    "bytes32",
                    "bool",
                    "bytes32",
                    "bool",
                    "bytes32",
                    "bool",
                    "bytes32"
                ],
                encodedValue
            );
            return {
                activeForkId: hasActiveForkId
                    ? (activeForkId as ForkId)
                    : undefined,
                headHash: hasHeadHash ? (headHash as Hash) : undefined,
                snapshotHash: hasSnapshotHash
                    ? (snapshotHash as Hash)
                    : undefined,
                stateHash: hasStateHash ? (stateHash as Hash) : undefined
            };
        }
    };
}

export function createStorageRecordCodec(): PersistenceRecordCodec {
    const registry = new PersistenceRecordCodec();
    registry.register("blocks", blockCodec());
    registry.register("inboundMessages", messageCodec());
    registry.register("outboundMessages", messageCodec());
    registry.register<StateSnapshot>("stateSnapshots", {
        encode: (snapshot) => ethers.hexlify(snapshot.encode()),
        decode: (encodedValue) => StateSnapshot.decode(encodedValue)
    });
    registry.register<Bytes>("stateMachineStates", {
        encode: (encodedState) => ethers.hexlify(encodedState),
        decode: (encodedValue) => encodedValue as Bytes
    });
    registry.register<Set<BlockHeight>>("participantSetChanges", {
        encode: (heights) =>
            abiCoder.encode(
                ["uint256[]"],
                [[...heights].sort((a, b) => a - b)]
            ),
        decode: (encodedValue) => {
            const [heights] = abiCoder.decode(["uint256[]"], encodedValue);
            return new Set(
                (heights as bigint[]).map((height) => Number(height))
            );
        }
    });
    registry.register("queues", queueCodec());
    registry.register<DisputeConfirmationStruct>("disputes", {
        encode: (confirmation) =>
            ethers.hexlify(
                Codec.encode(confirmation, Type.DisputeConfirmation)
            ),
        decode: (encodedValue) =>
            Codec.decode(encodedValue, Type.DisputeConfirmation)
    });
    registry.register<boolean>("disputedForks", {
        encode: (value) => abiCoder.encode(["bool"], [value]),
        decode: (encodedValue) => abiCoder.decode(["bool"], encodedValue)[0]
    });
    registry.register("fraudProofs", fraudProofCodec());
    registry.register("disputeFraudProofs", disputeFraudProofCodec());
    registry.register<TimeoutStruct>("timeout", {
        encode: (timeout) =>
            ethers.hexlify(Codec.encode(timeout, Type.Timeout)),
        decode: (encodedValue) => Codec.decode(encodedValue, Type.Timeout)
    });
    registry.register<boolean>("forceExit", {
        encode: (value) => abiCoder.encode(["bool"], [value]),
        decode: (encodedValue) => abiCoder.decode(["bool"], encodedValue)[0]
    });
    registry.register<number>("forceJoin", {
        encode: (value) => abiCoder.encode(["int256"], [value]),
        decode: (encodedValue) =>
            Number(abiCoder.decode(["int256"], encodedValue)[0])
    });
    registry.register("blockCalldata", blockCalldataCodec());
    registry.register<number>("eventSync", {
        encode: (value) => abiCoder.encode(["uint256"], [value]),
        decode: (encodedValue) =>
            Number(abiCoder.decode(["uint256"], encodedValue)[0])
    });
    registry.register<RuntimeMetadata>(
        "runtimeMetadata",
        runtimeMetadataCodec()
    );
    return registry;
}

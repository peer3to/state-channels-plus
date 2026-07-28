import { ethers } from "ethers";

import type { Block } from "@/models";
import type Storage from "@/storage";
import type { Bytes, ChannelId } from "@/types/types";

import type { RuntimeMetadata } from "./storageCodecs";

export interface PersistedRuntimeState {
    metadata: Required<
        Pick<RuntimeMetadata, "activeForkId" | "snapshotHash" | "stateHash">
    > &
        Pick<RuntimeMetadata, "headHash">;
    encodedState: Bytes;
}

export function validatePersistedRuntimeState(
    storage: Storage,
    channelId: ChannelId
): PersistedRuntimeState | undefined {
    try {
        return validateUnchecked(storage, channelId);
    } catch (error) {
        const normalized =
            error instanceof Error ? error : new Error(String(error));
        const location = storage.getPersistenceLocation();
        if (!location || normalized.message.includes("(persistence:")) {
            throw normalized;
        }
        throw new Error(`${normalized.message} (persistence: ${location})`);
    }
}

function validateUnchecked(
    storage: Storage,
    channelId: ChannelId
): PersistedRuntimeState | undefined {
    const metadata = storage.getRuntimeMetadata();
    if (!metadata) return undefined;

    if (
        !metadata.activeForkId ||
        !metadata.snapshotHash ||
        !metadata.stateHash
    ) {
        throw new Error("Persisted runtime metadata is incomplete");
    }
    const completeMetadata = {
        ...metadata,
        activeForkId: metadata.activeForkId,
        snapshotHash: metadata.snapshotHash,
        stateHash: metadata.stateHash
    };
    const snapshot = storage.stateSnapshots.getStateSnapshotByHash(
        completeMetadata.snapshotHash
    );
    if (!snapshot) {
        throw new Error(
            `Persisted runtime metadata references missing snapshot ${completeMetadata.snapshotHash}`
        );
    }
    const encodedState = storage.stateMachineStates.getStateMachineState(
        completeMetadata.stateHash
    );
    if (!encodedState) {
        throw new Error(
            `Persisted runtime metadata references missing state ${completeMetadata.stateHash}`
        );
    }
    if (snapshot.forkID !== completeMetadata.activeForkId) {
        throw new Error(
            "Persisted runtime metadata snapshot belongs to another fork"
        );
    }
    if (
        completeMetadata.headHash &&
        !storage.blocks.getBlock(completeMetadata.headHash)
    ) {
        throw new Error(
            `Persisted runtime metadata references missing head ${completeMetadata.headHash}`
        );
    }
    if (completeMetadata.headHash) {
        const head = storage.blocks.getBlock(completeMetadata.headHash)!;
        if (head.forkId !== completeMetadata.activeForkId) {
            throw new Error(
                "Persisted runtime metadata head belongs to another fork"
            );
        }
        if (
            ethers.hexlify(head.stateSnapshotHash) !==
            ethers.hexlify(completeMetadata.snapshotHash)
        ) {
            throw new Error(
                "Persisted runtime metadata head and snapshot disagree"
            );
        }
        if (
            ethers.hexlify(snapshot.stateMachineStateHash) !==
            ethers.hexlify(completeMetadata.stateHash)
        ) {
            throw new Error(
                "Persisted runtime metadata snapshot and state disagree"
            );
        }
        let previousBlock: Block | undefined;
        for (let height = 0; height <= head.height; height++) {
            const block = storage.blocks.getBlock(
                completeMetadata.activeForkId,
                height
            );
            if (!block) {
                throw new Error(
                    `Persisted canonical block missing at height ${height}`
                );
            }
            if (
                previousBlock &&
                ethers.hexlify(block.previousBlockHash) !==
                    ethers.hexlify(previousBlock.hash)
            ) {
                throw new Error(
                    `Persisted canonical block linkage is broken at height ${height}`
                );
            }
            const blockSnapshot = storage.stateSnapshots.getStateSnapshotByHash(
                block.stateSnapshotHash
            );
            if (!blockSnapshot) {
                throw new Error(
                    `Persisted block ${block.hash} references a missing snapshot`
                );
            }
            if (
                !storage.stateMachineStates.getStateMachineState(
                    blockSnapshot.stateMachineStateHash
                )
            ) {
                throw new Error(
                    `Persisted snapshot ${blockSnapshot.hash} references a missing state`
                );
            }
            previousBlock = block;
        }
    }
    for (const entry of storage.queues.getEntries()) {
        if (
            String(entry.block.channelId).toLowerCase() !==
            String(channelId).toLowerCase()
        ) {
            throw new Error(
                `Persisted queue entry ${entry.block.hash} belongs to another channel`
            );
        }
    }

    return { metadata: completeMetadata, encodedState };
}

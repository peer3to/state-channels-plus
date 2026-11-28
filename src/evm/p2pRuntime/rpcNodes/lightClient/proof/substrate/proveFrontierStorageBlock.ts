import FrontierStorageProofVerifier from "./FrontierStorageProofVerifier";
import SubstrateHeader from "./SubstrateHeader";
import type { LightClientStorageBlock } from "../../lightClientWire";
import StorageProofError from "../StorageProofError";
import type { ChecksumAddress } from "@/types/types";
import { isHexString, ZeroHash } from "ethers";

const verifier = new FrontierStorageProofVerifier();
const HASH_LENGTH = 32;

function isHash(value: unknown): value is string {
    return isHexString(value, HASH_LENGTH);
}

function isHexList(value: unknown): value is string[] {
    return (
        Array.isArray(value) && value.every((item) => isHexString(item, true))
    );
}

/**
 * Whether what a node pushed has the shape of a pushed block, so that every
 * later check reads only hex of the lengths it expects.
 */
function isStorageBlock(pushed: unknown): pushed is LightClientStorageBlock {
    const block = pushed as Partial<LightClientStorageBlock> | null;
    if (typeof block !== "object" || block === null) return false;
    const header = block.header;
    return (
        typeof header === "object" &&
        header !== null &&
        isHash(header.parentHash) &&
        isHexString(header.number) &&
        isHash(header.stateRoot) &&
        isHash(header.extrinsicsRoot) &&
        isHexList(header.digest?.logs) &&
        Array.isArray(block.writes) &&
        block.writes.every(
            (write) =>
                isHash(write?.slot) &&
                (write.value === null || isHash(write.value))
        ) &&
        isHexList(block.proofNodes) &&
        Array.isArray(block.logs) &&
        block.logs.every((log) => isHash(log?.blockHash))
    );
}

/**
 * Checks a block a Frontier node pushed for the contract at `address` and
 * returns its header and its writes as 32-byte values, zero for a cleared
 * slot. Throws {@link StorageProofError} when the block is malformed, when a
 * written value is not what the header's state root commits to, or when a log
 * is not of the header's Ethereum block. A log's content is not checked.
 */
export default function proveFrontierStorageBlock(
    block: unknown,
    address: ChecksumAddress
) {
    if (!isStorageBlock(block))
        throw new StorageProofError("The pushed block is malformed");
    const header = new SubstrateHeader(block.header);
    const ethereumBlockHash = header.ethereumBlockHash();
    for (const log of block.logs)
        if (log.blockHash.toLowerCase() !== ethereumBlockHash)
            throw new StorageProofError(
                `A pushed log is of block ${log.blockHash}, not of the header's block ${ethereumBlockHash}`
            );
    const proven = verifier.provenStorage(
        header.stateRoot,
        address,
        block.writes.map(({ slot }) => slot),
        block.proofNodes
    );
    const writes = block.writes.map(({ slot, value }, index) => {
        const pushed = (value ?? ZeroHash).toLowerCase();
        if (pushed !== proven[index])
            throw new StorageProofError(
                `Slot ${slot} was pushed as ${pushed} and is proven as ${proven[index]}`
            );
        return { slot, value: proven[index] };
    });
    return { header, ethereumBlockHash, writes };
}

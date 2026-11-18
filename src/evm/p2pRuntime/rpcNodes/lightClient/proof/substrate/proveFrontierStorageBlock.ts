import FrontierStorageProofVerifier from "./FrontierStorageProofVerifier";
import SubstrateHeader from "./SubstrateHeader";
import type { LightClientStorageBlock } from "../../lightClientWire";
import StorageProofError from "../StorageProofError";
import type { ChecksumAddress } from "@/types/types";
import { ZeroHash } from "ethers";

const verifier = new FrontierStorageProofVerifier();

/**
 * Checks a block a Frontier node pushed for the contract at `address` and
 * returns its header and its writes as 32-byte values, zero for a cleared
 * slot. Throws {@link StorageProofError} when a written value is not what the
 * header's state root commits to, or when a log is not of the header's
 * Ethereum block.
 */
export default function proveFrontierStorageBlock(
    block: LightClientStorageBlock,
    address: ChecksumAddress
) {
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

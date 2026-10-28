import {
    parseHeader,
    toQuantity,
    type AccountAddress
} from "../blockStorageDiff";
import ABackfillBlockSource, {
    ChainMovedError,
    type BackfillUpstream,
    type BlockListing
} from "./ABackfillBlockSource";

/** Blocks asked for in one batch when listing which ones have transactions. */
const BLOCK_BATCH = 100;

/**
 * Lists every block of the range and traces those that have transactions.
 * Linear in the range: for dev chains and short histories. The default.
 */
export class ListedBlockSource extends ABackfillBlockSource {
    public async listBlocks(
        upstream: BackfillUpstream,
        _address: AccountAddress,
        from: bigint,
        tip: { number: bigint; hash: string },
        parentHash?: string
    ): Promise<BlockListing> {
        const numbers: bigint[] = [];
        let blocks = 0;
        let blockReads = 0;
        let roundTrips = 0;
        let previousHash = parentHash;
        for (
            let start = from;
            start <= tip.number;
            start += BigInt(BLOCK_BATCH)
        ) {
            const end =
                start + BigInt(BLOCK_BATCH) - 1n < tip.number
                    ? start + BigInt(BLOCK_BATCH) - 1n
                    : tip.number;
            const wanted: bigint[] = [];
            for (let n = start; n <= end; n++) wanted.push(n);
            blockReads += wanted.length;
            roundTrips++;
            const listed = await Promise.all(
                upstream.requestBatch(
                    wanted.map((number) => ({
                        method: "eth_getBlockByNumber",
                        params: [toQuantity(number), false]
                    }))
                )
            );
            for (const block of listed) {
                const header = parseHeader(block);
                // the listing must be one chain, or it was read across a reorg
                if (
                    previousHash !== undefined &&
                    header.parentHash !== previousHash
                )
                    throw new ChainMovedError(
                        "The chain moved while its blocks were listed"
                    );
                previousHash = header.hash;
                blocks++;
                if (header.txCount > 0) numbers.push(header.number);
            }
        }
        if (previousHash !== tip.hash)
            throw new ChainMovedError(
                "The range does not end at the expected block"
            );
        return { numbers, blocks, blockReads, rootReads: 0, roundTrips };
    }

    public async countStorageEntries(): Promise<undefined> {
        return undefined;
    }

    public close(): void {}
}

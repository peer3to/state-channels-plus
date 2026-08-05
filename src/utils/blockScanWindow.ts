import { BlockNumber, Timestamp } from "@/types/types";

/** Inclusive `[fromBlock, toBlock]` range for a chain log scan. */
export type BlockScanRange = {
    fromBlock: BlockNumber;
    toBlock: BlockNumber;
};

export type BlockScanRangeEstimate = {
    latestBlockNumber: BlockNumber;
    latestTimestamp: Timestamp;
    /** Chain average block time in seconds (`Clock.getAverageOnChainBlockTime`). */
    averageBlockTime: number;
    lowTimestamp: Timestamp;
    highTimestamp: Timestamp;
    /** Symmetric padding applied to both ends of the estimated range. */
    bufferBlocks: number;
};

export type BlockScanStartCorrection = {
    /** The estimated start block that was read back from the chain. */
    probedBlockNumber: BlockNumber;
    probedTimestamp: Timestamp;
    latestBlockNumber: BlockNumber;
    latestTimestamp: Timestamp;
    lowTimestamp: Timestamp;
    bufferBlocks: number;
};

// How many blocks fit in `seconds` at `averageBlockTime`, with 50% slack and 2
// blocks of jitter on top. A chain with no measurable rate yet falls back to one
// block per second.
export function estimateBlocksForSeconds(
    seconds: number,
    averageBlockTime: number
): number {
    const elapsed = Math.max(0, seconds);
    const blocks = averageBlockTime > 0 ? elapsed / averageBlockTime : elapsed;
    return Math.ceil(blocks * 1.5) + 2;
}

// Map a timestamp window onto a bounded block range from the chain's average
// block time - O(1), no search over the chain, and never anchored to the head so
// the range stays put however far the head advances. Irregular block spacing
// makes the estimate drift, hence `bufferBlocks` on both sides; a caller that
// still misses must treat the miss as retryable, never as proof the event was
// never emitted.
export function estimateBlockScanRange(
    estimate: BlockScanRangeEstimate
): BlockScanRange {
    const {
        latestBlockNumber,
        latestTimestamp,
        averageBlockTime,
        lowTimestamp,
        highTimestamp,
        bufferBlocks
    } = estimate;
    // No measurable rate yet (fresh chain): the chain is short, scan all of it.
    if (averageBlockTime <= 0) {
        return { fromBlock: 0, toBlock: Math.max(0, latestBlockNumber) };
    }
    const blocksSince = (timestamp: Timestamp) =>
        Math.round((latestTimestamp - timestamp) / averageBlockTime);
    const fromBlock = clampBlock(
        latestBlockNumber - blocksSince(lowTimestamp) - bufferBlocks,
        latestBlockNumber
    );
    const toBlock = clampBlock(
        latestBlockNumber - blocksSince(highTimestamp) + bufferBlocks,
        latestBlockNumber
    );
    return { fromBlock, toBlock: Math.max(fromBlock, toBlock) };
}

// One cheap correction, for when reading back the estimated start block shows it
// already sits inside the window (its timestamp is past `lowTimestamp`) - the
// average over-stated the block rate and the range started too late. Re-derive
// the start from the rate actually observed between that block and the head.
// With no observable rate there is nothing to extrapolate from, so the scan
// falls back to genesis rather than guessing again.
export function correctBlockScanStart(
    correction: BlockScanStartCorrection
): BlockNumber {
    const {
        probedBlockNumber,
        probedTimestamp,
        latestBlockNumber,
        latestTimestamp,
        lowTimestamp,
        bufferBlocks
    } = correction;
    const blocksAhead = latestBlockNumber - probedBlockNumber;
    const observedBlockTime =
        blocksAhead > 0 ? (latestTimestamp - probedTimestamp) / blocksAhead : 0;
    if (observedBlockTime <= 0) return 0;
    const blocksBack = estimateBlocksForSeconds(
        probedTimestamp - lowTimestamp,
        observedBlockTime
    );
    return clampBlock(
        probedBlockNumber - blocksBack - bufferBlocks,
        latestBlockNumber
    );
}

function clampBlock(
    blockNumber: number,
    latestBlockNumber: BlockNumber
): BlockNumber {
    return Math.max(
        0,
        Math.min(Math.max(0, latestBlockNumber), Math.floor(blockNumber))
    );
}

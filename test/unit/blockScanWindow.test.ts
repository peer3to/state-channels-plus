import { expect } from "chai";

import {
    correctBlockScanStart,
    estimateBlockScanRange,
    estimateBlocksForSeconds
} from "@/utils/blockScanWindow";

// Pure math over chain coordinates, so these run without a session.
//
// The estimate maps a block's validity window onto a block range from the
// chain's average block time. It is anchored on the window, never on the chain
// head, and it is a guess: irregular block spacing can push it off, which is why
// callers must read a miss as "retry", never as "the event was never emitted".

// A regular chain: 2s blocks, head at block 1_000_000.
const REGULAR_CHAIN = {
    latestBlockNumber: 1_000_000,
    latestTimestamp: 1_800_000_000,
    averageBlockTime: 2
};
// A block validity window of p2pTime + agreementTime + chainFallbackTime.
const WINDOW_SECONDS = 40;

// The anchor sits an hour behind the head, so a head-anchored look-back would
// have moved on long ago.
const ANCHOR_TIMESTAMP = REGULAR_CHAIN.latestTimestamp - 3600;
const REGULAR_BUFFER_BLOCKS = estimateBlocksForSeconds(
    WINDOW_SECONDS,
    REGULAR_CHAIN.averageBlockTime
);

const regularRange = () =>
    estimateBlockScanRange({
        ...REGULAR_CHAIN,
        lowTimestamp: ANCHOR_TIMESTAMP - WINDOW_SECONDS,
        highTimestamp: ANCHOR_TIMESTAMP + WINDOW_SECONDS,
        bufferBlocks: REGULAR_BUFFER_BLOCKS
    });

describe("Unit: blockScanWindow", function () {
    describe("estimateBlocksForSeconds", function () {
        it("converts seconds to blocks at the average rate, with slack", function () {
            // 40s / 2s per block = 20 blocks, +50% slack, +2 blocks of jitter
            expect(estimateBlocksForSeconds(40, 2)).to.equal(32);
        });

        it("falls back to one block per second when no rate is known", function () {
            expect(estimateBlocksForSeconds(10, 0)).to.equal(17);
        });

        it("treats a negative span as no span at all", function () {
            expect(estimateBlocksForSeconds(-10, 2)).to.equal(2);
        });
    });

    describe("estimateBlockScanRange", function () {
        it("brackets a post made inside the window, far behind the head", function () {
            // posted 10s after the anchor => 1795 blocks behind the head
            const postBlockNumber =
                REGULAR_CHAIN.latestBlockNumber -
                (REGULAR_CHAIN.latestTimestamp - (ANCHOR_TIMESTAMP + 10)) /
                    REGULAR_CHAIN.averageBlockTime;

            const range = regularRange();

            expect(range.fromBlock).to.be.at.most(postBlockNumber);
            expect(range.toBlock).to.be.at.least(postBlockNumber);
        });

        it("stays bounded instead of scanning to the head", function () {
            const range = regularRange();

            expect(range.fromBlock).to.be.greaterThan(0);
            expect(range.toBlock).to.be.lessThan(
                REGULAR_CHAIN.latestBlockNumber
            );
            // one window on each side of the anchor, plus both buffers
            expect(range.toBlock - range.fromBlock).to.equal(
                (2 * WINDOW_SECONDS) / REGULAR_CHAIN.averageBlockTime +
                    2 * REGULAR_BUFFER_BLOCKS
            );
        });

        it("clamps the end to the head when the window reaches into the future", function () {
            const range = estimateBlockScanRange({
                ...REGULAR_CHAIN,
                lowTimestamp: REGULAR_CHAIN.latestTimestamp - WINDOW_SECONDS,
                highTimestamp: REGULAR_CHAIN.latestTimestamp + WINDOW_SECONDS,
                bufferBlocks: REGULAR_BUFFER_BLOCKS
            });

            expect(range.toBlock).to.equal(REGULAR_CHAIN.latestBlockNumber);
        });

        it("clamps the start to genesis when the window predates the chain", function () {
            const range = estimateBlockScanRange({
                ...REGULAR_CHAIN,
                lowTimestamp: REGULAR_CHAIN.latestTimestamp - 10_000_000,
                highTimestamp: REGULAR_CHAIN.latestTimestamp - 9_999_000,
                bufferBlocks: REGULAR_BUFFER_BLOCKS
            });

            expect(range.fromBlock).to.equal(0);
        });

        it("scans the whole chain when no block rate is measurable yet", function () {
            const range = estimateBlockScanRange({
                latestBlockNumber: 12,
                latestTimestamp: 1_800_000_000,
                averageBlockTime: 0,
                lowTimestamp: 1_799_999_960,
                highTimestamp: 1_800_000_040,
                bufferBlocks: 8
            });

            expect(range).to.deep.equal({ fromBlock: 0, toBlock: 12 });
        });

        it("misses the event when block spacing is far denser than the average", function () {
            // the average says 12s, the last 300 blocks were mined 1s apart
            const range = estimateBlockScanRange({
                latestBlockNumber: 5000,
                latestTimestamp: 1_800_000_000,
                averageBlockTime: 12,
                lowTimestamp: 1_799_999_660,
                highTimestamp: 1_799_999_740,
                bufferBlocks: estimateBlocksForSeconds(WINDOW_SECONDS, 12)
            });

            // the real post is at block 4700 - outside the estimate, which is
            // why a miss must degrade to a retry and never to "never posted"
            expect(range.fromBlock).to.be.greaterThan(4700);
        });
    });

    describe("correctBlockScanStart", function () {
        it("widens past the event using the rate observed at the probed block", function () {
            // reading back block 4965 shows 1s spacing, not the 12s average
            const correctedFromBlock = correctBlockScanStart({
                probedBlockNumber: 4965,
                probedTimestamp: 1_799_999_965,
                latestBlockNumber: 5000,
                latestTimestamp: 1_800_000_000,
                lowTimestamp: 1_799_999_660,
                bufferBlocks: estimateBlocksForSeconds(WINDOW_SECONDS, 12)
            });

            expect(correctedFromBlock).to.be.at.most(4700);
        });

        it("never returns a start beyond genesis", function () {
            const correctedFromBlock = correctBlockScanStart({
                probedBlockNumber: 40,
                probedTimestamp: 1_800_000_000,
                latestBlockNumber: 100,
                latestTimestamp: 1_800_000_600,
                lowTimestamp: 1_000_000_000,
                bufferBlocks: 8
            });

            expect(correctedFromBlock).to.equal(0);
        });

        it("falls back to genesis when the probe shows no observable rate", function () {
            const correctedFromBlock = correctBlockScanStart({
                probedBlockNumber: 4965,
                probedTimestamp: 1_800_000_000,
                latestBlockNumber: 5000,
                latestTimestamp: 1_800_000_000,
                lowTimestamp: 1_799_999_660,
                bufferBlocks: 8
            });

            expect(correctedFromBlock).to.equal(0);
        });
    });
});

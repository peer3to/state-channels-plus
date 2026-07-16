import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import { OnChainPostTiming } from "@/stateManager/ValidationService";
import { Codec, Type } from "@/utils";
import {
    MathTestSession as TestSession,
    MIN_TEST_TIME_CONFIG
} from "@test/harness";
import { expect } from "chai";

const TIME = MIN_TEST_TIME_CONFIG;

// This test deliberately starts authoring after the ordinary deadline. Keep
// enough grace for interval mining and three-peer signature collection under
// parallel load; the default three-second evidence window is too narrow for
// that boundary scenario.
const FIRST_BLOCK_AUTHORING_TIME = {
    ...MIN_TEST_TIME_CONFIG,
    evidenceTime: 12
};

describe("E2E: First block timestamp grace", function () {
    it("adds evidenceTime only to the height 0 participant timeout", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 0);

        const timeoutWindows = await h.execOnHost(h.peers[0], (sm) => ({
            heightZero: sm.getTimeoutWaitTimeSeconds(0),
            heightOne: sm.getTimeoutWaitTimeSeconds(1)
        }));
        const normalWindow =
            TIME.p2pTime + TIME.agreementTime + TIME.chainFallbackTime;
        expect(timeoutWindows.heightZero).to.equal(
            normalWindow + TIME.evidenceTime
        );
        expect(timeoutWindows.heightOne).to.equal(normalWindow);
    });

    it("authors height 0 after the old participant deadline and every peer finalizes it", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0, {
            timeConfig: FIRST_BLOCK_AUTHORING_TIME
        });

        const forkId = h.activeForkId!;
        const genesisResult = await h
            .control(h.peers[0])
            .dispute.getGenesisSnapshotStruct(forkId)
            .request();
        expect(genesisResult).to.not.be.null;
        const genesis = StateSnapshot.decode(genesisResult!.encodedSnapshot);
        const normalTimestampCap =
            genesis.timestamp + FIRST_BLOCK_AUTHORING_TIME.p2pTime;
        const normalParticipantDeadline =
            genesis.timestamp +
            FIRST_BLOCK_AUTHORING_TIME.p2pTime +
            FIRST_BLOCK_AUTHORING_TIME.agreementTime +
            FIRST_BLOCK_AUTHORING_TIME.chainFallbackTime;
        const targetTimestamp = normalParticipantDeadline + 1;
        const graceDeadline =
            genesis.timestamp +
            FIRST_BLOCK_AUTHORING_TIME.p2pTime +
            FIRST_BLOCK_AUTHORING_TIME.agreementTime +
            FIRST_BLOCK_AUTHORING_TIME.chainFallbackTime +
            FIRST_BLOCK_AUTHORING_TIME.evidenceTime;

        expect(
            Clock.getTimeInSeconds(),
            "setup consumed the first-block grace window"
        ).to.be.lessThan(graceDeadline - 1);
        await h.event.waitUntilTimestamp(targetTimestamp);
        await h.transition.advanceState({
            count: 1,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2],
            waitForFinalization: true
        });

        const bundles = await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).query.getLatestBlockBundle(forkId).request()
            )
        );
        expect(bundles.every((bundle) => bundle !== null)).to.equal(true);
        const blocks = bundles.map((bundle) =>
            Block.fromBlockConfirmation({
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: bundle!.confirmationSignatures
            })
        );
        expect(blocks.every((block) => block.hash === blocks[0].hash)).to.equal(
            true
        );
        expect(blocks[0].height).to.equal(0);
        expect(blocks[0].timestamp).to.be.greaterThan(normalTimestampCap);
        expect(blocks[0].timestamp).to.be.at.most(
            genesis.timestamp +
                FIRST_BLOCK_AUTHORING_TIME.evidenceTime +
                FIRST_BLOCK_AUTHORING_TIME.p2pTime
        );
        expect(
            blocks.every((block) => block.allSignerAddresses.size === 3)
        ).to.equal(true);
        await h.assert.dispute.didNotInitiate({ peers: [0, 1, 2] });
    });

    it("caps height 1 without evidenceTime grace and every peer finalizes it", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);

        await h.transition.advanceState({
            count: 1,
            waitForFinalization: true
        });
        const forkId = h.activeForkId!;
        const heightZeroBundle = await h
            .control(h.peers[0])
            .query.getLatestBlockBundle(forkId)
            .request();
        expect(heightZeroBundle).to.not.be.null;
        const heightZeroBlock = Block.fromBlockConfirmation({
            signedBlock: Codec.decode(
                heightZeroBundle!.encodedSignedBlock,
                Type.SignedBlock
            ),
            signatures: heightZeroBundle!.confirmationSignatures
        });

        const heightOneCap = heightZeroBlock.timestamp + TIME.p2pTime;
        await h.event.waitUntilTimestamp(heightOneCap + 1);
        await h.transition.advanceState({
            count: 1,
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2],
            waitForFinalization: true
        });
        const heightOneBundles = await Promise.all(
            h.peers.map((peer) =>
                h.control(peer).query.getLatestBlockBundle(forkId).request()
            )
        );
        const heightOneBlocks = heightOneBundles.map((bundle) =>
            Block.fromBlockConfirmation({
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: bundle!.confirmationSignatures
            })
        );
        expect(heightOneBlocks.every((block) => block.height === 1)).to.equal(
            true
        );
        expect(
            heightOneBlocks.every((block) => block.timestamp === heightOneCap)
        ).to.equal(true);
        expect(
            heightOneBlocks.every(
                (block) => block.allSignerAddresses.size === 3
            )
        ).to.equal(true);
    });

    it("applies first-block grace to the on-chain post timing boundary", async function () {
        this.timeout(90000);
        const h = TestSession.getHarness();
        await h.lifecycle.start(2, 2);

        const forkId = h.activeForkId!;
        const timings = await h.execOnHost(
            h.peers[0],
            async (sm, args) => {
                const genesis =
                    sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        args.forkId
                    );
                if (!genesis) throw new Error("missing genesis snapshot");
                const block0 = sm.storage.blocks.getBlock(args.forkId, 0);
                if (!block0) throw new Error("missing block at height 0");

                const probe = async (
                    height: number,
                    previousTimestamp: number,
                    onChainTimestamp: number
                ) => {
                    const block = sm.storage.blocks.getBlock(
                        args.forkId,
                        height
                    );
                    if (!block)
                        throw new Error(`missing block at height ${height}`);
                    const original = block.onChainTimestamp;
                    block.onChainTimestamp = onChainTimestamp;
                    const timing = await sm.validationService[
                        "getOnChainPostTiming"
                    ](previousTimestamp, block);
                    block.onChainTimestamp = original;
                    return timing;
                };

                const heightZeroDeadline = genesis.timestamp + args.h0Window;
                const heightOneDeadline = block0.timestamp + args.h1Window;
                return {
                    h0AtDeadline: await probe(
                        0,
                        genesis.timestamp,
                        heightZeroDeadline
                    ),
                    h0PastDeadline: await probe(
                        0,
                        genesis.timestamp,
                        heightZeroDeadline + 1
                    ),
                    h1AtDeadline: await probe(
                        1,
                        block0.timestamp,
                        heightOneDeadline
                    ),
                    h1PastDeadline: await probe(
                        1,
                        block0.timestamp,
                        heightOneDeadline + 1
                    )
                };
            },
            {
                forkId,
                h0Window:
                    TIME.p2pTime +
                    TIME.agreementTime +
                    TIME.chainFallbackTime +
                    TIME.evidenceTime,
                h1Window:
                    TIME.p2pTime + TIME.agreementTime + TIME.chainFallbackTime
            }
        );

        expect(timings.h0AtDeadline).to.equal(OnChainPostTiming.ON_TIME);
        expect(timings.h0PastDeadline).to.equal(OnChainPostTiming.TOO_LATE);
        expect(timings.h1AtDeadline).to.equal(OnChainPostTiming.ON_TIME);
        expect(timings.h1PastDeadline).to.equal(OnChainPostTiming.TOO_LATE);
    });

    it("does not time out height 0 inside the grace window and times out after it", async function () {
        this.timeout(120000);
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(3, 0);

        const forkId = h.activeForkId!;
        const genesisResult = await h
            .control(h.peers[0])
            .dispute.getGenesisSnapshotStruct(forkId)
            .request();
        expect(genesisResult).to.not.be.null;
        const genesis = StateSnapshot.decode(genesisResult!.encodedSnapshot);
        const graceParticipantDeadline =
            genesis.timestamp +
            TIME.p2pTime +
            TIME.agreementTime +
            TIME.chainFallbackTime +
            TIME.evidenceTime;

        expect(
            Clock.getTimeInSeconds(),
            "setup consumed the height-0 grace window"
        ).to.be.lessThan(graceParticipantDeadline - 1);
        // past the normal deadline, one second before the grace deadline: no dispute yet
        await h.event.waitUntilTimestamp(graceParticipantDeadline - 1);
        await h.assert.dispute.didNotInitiate({ peers: [0, 1, 2] });

        await h.assert.dispute.initiatedWait({
            peersIndices: [1, 2],
            timeoutMs: 15000
        });
        await h.assert.dispute.didNotInitiate({ peers: [0] });
    });
});

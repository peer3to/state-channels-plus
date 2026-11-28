import { StateSnapshot } from "@/models";
import { Codec, Type } from "@/utils";
import {
    heldHistoryAt,
    holdsForkGenesis,
    stagePrunedChannel,
    stagePrunedChannelPastAnchor,
    waitForMirroredDispute
} from "@test/fixtures/PruningStaging";
import { disputeOnHost } from "@test/fixtures/ReplayGasLimitStaging";
import { storedProofView } from "@test/fixtures/StoredProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

const PRUNED = 0;
const REFERENCE = 2;

describe("Unit: AgreementManager history pruning", function () {
    it("pruning on, final points advance over several blocks → the blocks and states between the anchor and the final point are gone; their snapshots, the final-point block with its state and the tail stay", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stagePrunedChannel(h, {
            blockCount: 5,
            referenceIndex: REFERENCE,
            pruned: true
        });
        const stored = (await storedProofView(h, PRUNED, forkId))!;
        // premise - no snapshot posted: rooted at the fork genesis, with at
        // least two blocks below the final point
        expect(stored.finalized.height).to.be.greaterThan(1);

        const held = await heldHistoryAt(h, PRUNED, REFERENCE, forkId);

        const finalHeight = stored.finalized.height;
        for (const point of held) {
            const isSkipped = point.height < finalHeight;
            expect(point, `height ${point.height}`).to.deep.equal({
                height: point.height,
                block: !isSkipped,
                snapshot: true,
                state: !isSkipped
            });
        }
        expect(stored.isStateHeld, "the stored final state").to.equal(true);
        expect(await holdsForkGenesis(h, PRUNED, forkId)).to.equal(true);
    });

    it("pruning off (the default), final points advance over several blocks → every block, snapshot and state stays", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stagePrunedChannel(h, {
            blockCount: 5,
            referenceIndex: REFERENCE,
            pruned: false
        });
        const stored = (await storedProofView(h, PRUNED, forkId))!;
        expect(stored.finalized.height).to.be.greaterThan(1);

        const held = await heldHistoryAt(h, PRUNED, REFERENCE, forkId);

        expect(held).to.have.length.greaterThan(stored.finalized.height);
        expect(
            held.filter((point) => !point.block || !point.state),
            "pruned heights"
        ).to.deep.equal([]);
    });

    it("pruning on, a snapshot update moves the chain anchor → below it the blocks, snapshots and states are gone; the anchor block with its snapshot and state and the fork genesis with its state stay", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stagePrunedChannel(h, {
            blockCount: 3,
            referenceIndex: REFERENCE,
            pruned: true
        });
        h.event.resetEventSpies();
        const posted = await h.transition.postSnapshot();
        expect(posted, "the posted snapshot").to.not.equal(undefined);
        await h.event.waitForEventCounts(
            "onStateSnapshotUpdated",
            [{ peerId: PRUNED, expectedCount: 1 }],
            h.event.protocolEventTimeoutMs(),
            { mode: "atLeast" }
        );
        const stored = (await storedProofView(h, PRUNED, forkId))!;
        expect(stored.anchor.hash, "re-rooted at the posted snapshot").to.equal(
            String(posted!.hash)
        );
        const anchorHeight = stored.anchor.height;
        expect(anchorHeight).to.be.greaterThan(0);

        const held = await heldHistoryAt(h, PRUNED, REFERENCE, forkId);

        for (const point of held.filter(({ height }) => height < anchorHeight))
            expect(point, `height ${point.height}`).to.deep.equal({
                height: point.height,
                block: false,
                snapshot: false,
                state: false
            });
        expect(held[anchorHeight]).to.deep.equal({
            height: anchorHeight,
            block: true,
            snapshot: true,
            state: true
        });
        expect(await holdsForkGenesis(h, PRUNED, forkId)).to.equal(true);
    });

    it("pruning on, a re-root while the local diamond mirrors a dispute on the fork → nothing below the new anchor is deleted", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stagePrunedChannel(h, {
            blockCount: 3,
            referenceIndex: REFERENCE,
            pruned: false
        });
        const before = (await storedProofView(h, PRUNED, forkId))!;
        const anchorHeight = before.finalized.height - 1;
        expect(anchorHeight).to.be.greaterThan(0);
        const encoded = await h
            .control(h.getPeer(PRUNED))
            .query.getStateSnapshotStructAt(forkId, anchorHeight)
            .request();
        const anchor = String(
            StateSnapshot.from(
                Codec.decode(encoded!.encodedSnapshot, Type.StateSnapshot)
            ).hash
        );
        await h.control(h.getPeer(1)).dispute.setForceExit(true).request();
        await disputeOnHost(h, 1, forkId);
        await waitForMirroredDispute(h, PRUNED, forkId);
        await h
            .control(h.getPeer(PRUNED))
            .stub.setHistoryPruning(true)
            .request();

        await h.execOnHost(
            h.getPeer(PRUNED),
            async (sm, args) => {
                const snapshot =
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        args.anchor
                    )!;
                await sm.agreementManager.reRootStoredProof(snapshot);
            },
            { anchor }
        );
        const after = (await storedProofView(h, PRUNED, forkId))!;
        const held = await heldHistoryAt(h, PRUNED, REFERENCE, forkId);

        expect(after.anchor.hash, "the re-root passed").to.equal(anchor);
        expect(
            held
                .filter(({ height }) => height < anchorHeight)
                .filter((point) => !point.block || !point.snapshot),
            "deleted below the anchor"
        ).to.deep.equal([]);
    });

    it("pruning on, a re-root with no dispute mirrored on the fork → the history below the new anchor is deleted", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stagePrunedChannel(h, {
            blockCount: 3,
            referenceIndex: REFERENCE,
            pruned: false
        });
        const before = (await storedProofView(h, PRUNED, forkId))!;
        const anchorHeight = before.finalized.height - 1;
        expect(anchorHeight).to.be.greaterThan(0);
        const encoded = await h
            .control(h.getPeer(PRUNED))
            .query.getStateSnapshotStructAt(forkId, anchorHeight)
            .request();
        const anchor = String(
            StateSnapshot.from(
                Codec.decode(encoded!.encodedSnapshot, Type.StateSnapshot)
            ).hash
        );
        await h
            .control(h.getPeer(PRUNED))
            .stub.setHistoryPruning(true)
            .request();

        await h.execOnHost(
            h.getPeer(PRUNED),
            async (sm, args) => {
                const snapshot =
                    sm.storage.stateSnapshots.getStateSnapshotByHash(
                        args.anchor
                    )!;
                await sm.agreementManager.reRootStoredProof(snapshot);
            },
            { anchor }
        );
        const held = await heldHistoryAt(h, PRUNED, REFERENCE, forkId);

        expect(
            held
                .filter(({ height }) => height < anchorHeight)
                .filter((point) => point.block || point.snapshot),
            "held below the anchor"
        ).to.deep.equal([]);
        expect(held[anchorHeight].block, "the anchor block").to.equal(true);
    });

    it("pruning on, a dispute moves the chain anchor from a fork it was adopted on to a reduced fork → the left fork, still disputed in the mirror, keeps its history at every honest peer", async function () {
        const h = TestSession.getHarness();
        // a same-fork adoption first: the mirror's anchor is on the fork
        // before the dispute moves it
        const { forkId: originalForkId } = await stagePrunedChannelPastAnchor(
            h,
            { peerCount: 4, blocksBefore: 2, blocksAfter: 1 }
        );
        const maliciousPeerIndex = (await h.query.getNextPeerToWrite()).index;
        const { newForkId, honestPeerIndices } =
            await h.scenario.disputeWithReduction({ maliciousPeerIndex });
        await h.assert.snapshot.localSnapshotsChangedWait({
            expectedForkId: newForkId as string
        });

        for (const peerIndex of honestPeerIndices) {
            await waitForMirroredDispute(h, peerIndex, originalForkId);
            const kept = await h.execOnHost(
                h.getPeer(peerIndex),
                async (sm, args) => {
                    // its read waits for the queued stored-proof writes
                    await sm.agreementManager.getLocalFinalizedSnapshot(
                        args.newForkId
                    );
                    return {
                        activeForkId: String(sm.forkId),
                        hasGenesis:
                            sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                                args.originalForkId
                            ) !== undefined,
                        latestHeight: sm.storage.blocks.getLatestBlockHeight(
                            args.originalForkId
                        )
                    };
                },
                { originalForkId, newForkId }
            );

            expect(kept.activeForkId, `peer ${peerIndex} moved`).to.equal(
                newForkId
            );
            expect(kept.hasGenesis, "the left fork's genesis").to.equal(true);
            expect(kept.latestHeight, "the left fork's blocks").to.be.at.least(
                0
            );
        }
    });
});

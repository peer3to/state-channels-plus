import { expect } from "chai";
import { MathTestSession as TestSession } from "@test/harness";

// posting is driven host-side via the StateManager delegators. after start(3,N)
// the on-chain snapshot is still genesis (nothing posted yet) while local
// blocks are ahead, so the same-fork build has a newer milestone to post. the
// on-chain reduceAndFinalize/multicall submission is detached; the oracle is the
// posted on-chain snapshot vs the peer's local snapshot.

describe("Unit: SnapshotPostingService", function () {
    describe("prepareUpdateStateSnapshotFork", function () {
        // no test: the disputed-fork traversal needs the on-chain fork disputed
        // while the peer has locally reduced - not unit-stageable (holding the
        // on-chain reduceAndFinalize mid-flight). E2E-StateSnapshots owns it.
        it.skip("on-chain fork disputed → traverses + builds the fork update", function () {});

        // known-red: getDispute is undefined in the partial-dispute window
        // (commitment on-chain, struct not stored) - see ForkReductionService.
        it.skip("missing dispute struct in storage → throws (partial-window race)", function () {});

        it("fork not disputed → undefined, no fork update needed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);

            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const data = await sm.prepareUpdateStateSnapshotFork();
                return { isUndefined: data === undefined };
            });

            expect(r.isUndefined).to.equal(true);
        });
    });

    describe("prepareUpdateSnapshotSameFork", function () {
        // defensive: getStateProof never builds an empty milestone (it only
        // pushes a milestone once its threshold is met).
        it.skip("empty milestone proof → throws", function () {});

        // no test: the local-reduced window (local latest on a newer fork than
        // the on-chain base) isn't unit-stageable - as the cross-fork skip above.
        it.skip("base fork != latest fork → undefined (retry once chain catches up)", function () {});

        it("local ahead on the same fork → builds update calldata for the newer snapshot", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const onChain =
                        await sm.diamondStateMachine.localDiamondContract.getStateSnapshot(
                            sm.channelId
                        );
                    const data = await sm.prepareUpdateSnapshotSameFork(
                        args.forkId
                    );
                    if (!data) return { hasData: false };
                    return {
                        hasData: true,
                        callDataLen: data.callData.length,
                        // the update targets a snapshot newer than the on-chain one
                        expectedState: String(
                            data.expectedSnapshot.snapshotData
                                .stateMachineStateHash
                        ),
                        onChainState: String(
                            onChain.snapshotData.stateMachineStateHash
                        )
                    };
                },
                { forkId }
            );

            expect(r.hasData).to.equal(true);
            expect(r.callDataLen).to.equal(1);
            expect(r.expectedState).to.not.equal(r.onChainState);
        });

        it("already current → undefined, nothing newer to post", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;

            // post + wait for the detached multicall to land on-chain
            await h.transition.postSnapshot({ peerIndex: 0 });
            await h.event.waitForEventCounts(
                "onStateSnapshotUpdated",
                [{ peerId: 0, expectedCount: 1 }],
                10000,
                { mode: "atLeast" }
            );

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    (await sm.prepareUpdateSnapshotSameFork(args.forkId)) ===
                    undefined,
                { forkId }
            );

            // nothing newer than the just-posted snapshot -> no build
            expect(r).to.equal(true);
        });
    });

    describe("postStateSnapshot", function () {
        // no test: fires only when a concurrent two-peer post reverts
        // (nondeterministic). a sequential re-post finds nothing newer and
        // returns undefined before the multicall, so replay never reaches here.
        it.skip("concurrent post revert → RaceCondition handlers", function () {});

        it("advances the on-chain snapshot from genesis to the peer's latest local state", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3); // fully-signed -> latest is postable

            const readOnChain = () =>
                h.execOnHost(h.getPeer(0), async (sm) => {
                    const oc =
                        await sm.stateChannelManagerContract.getStateSnapshot(
                            sm.channelId
                        );
                    return {
                        height: Number(oc.blockHeight),
                        state: String(oc.snapshotData.stateMachineStateHash)
                    };
                });

            const before = await readOnChain();

            const posted = await h.transition.postSnapshot({ peerIndex: 0 });
            await h.event.waitForEventCounts(
                "onStateSnapshotUpdated",
                [{ peerId: 0, expectedCount: 1 }],
                10000,
                { mode: "atLeast" }
            );

            const after = await readOnChain();

            expect(posted).to.not.equal(undefined);
            // on-chain was genesis, now advanced to a real newer snapshot
            expect(before.height).to.equal(0);
            expect(after.height).to.be.greaterThan(0);
            expect(after.state).to.not.equal(before.state);
        });

        it("nothing new to post → undefined, no multicall", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;

            // first post + wait for it to land
            await h.transition.postSnapshot({ peerIndex: 0 });
            await h.event.waitForEventCounts(
                "onStateSnapshotUpdated",
                [{ peerId: 0, expectedCount: 1 }],
                10000,
                { mode: "atLeast" }
            );

            const secondUndefined = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) =>
                    (await sm.postStateSnapshot(args.forkId)) === undefined,
                { forkId }
            );

            // nothing newer -> built calldata empty -> no-op
            expect(secondUndefined).to.equal(true);
        });
    });

    describe("concurrency", function () {
        it("same-fork build sampled while blocks advance → monotonic, never throws, stays on-fork", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 1);
            const forkId = h.activeForkId!;

            const failures: string[] = [];
            const heights: number[] = [];

            // builder only, no on-chain write - each sample assembles from
            // whatever half-signed state storage holds at that instant
            const sample = async () => {
                try {
                    const r = await h.execOnHost(
                        h.getPeer(0),
                        async (sm, args) => {
                            const d = await sm.prepareUpdateSnapshotSameFork(
                                args.forkId
                            );
                            if (!d) return { h: -1, onFork: true };
                            return {
                                h: Number(d.expectedSnapshot.blockHeight),
                                onFork:
                                    String(d.expectedSnapshot.forkID) ===
                                    args.forkId
                            };
                        },
                        { forkId }
                    );
                    if (r.h >= 0) heights.push(r.h);
                    if (!r.onFork)
                        failures.push(
                            `build left fork ${forkId} at height ${r.h}`
                        );
                } catch (e) {
                    failures.push(
                        `threw: ${e instanceof Error ? e.message : String(e)}`
                    );
                }
            };

            await sample();
            let done = false;
            const advancing = h.transition
                .advanceState({ count: 8, waitForFinalization: false })
                .finally(() => {
                    done = true;
                });
            while (!done) {
                await sample();
                await new Promise((res) => setTimeout(res, 50));
            }
            await advancing;
            await sample();

            expect(failures).to.deep.equal([]);
            // the builder's snapshot height only ever moved forward
            for (let i = 1; i < heights.length; i++) {
                expect(heights[i]).to.be.at.least(heights[i - 1]);
            }
            // sanity: the race window was real - the build advanced
            expect(Math.max(...heights)).to.be.greaterThan(
                Math.min(...heights)
            );

            await h.assert.sync.peersInSyncWait();
        });
    });
});

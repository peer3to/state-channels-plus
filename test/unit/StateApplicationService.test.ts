import { expect } from "chai";
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

// unsafeSetLatestState is driven through transition.runSetLatestState (the
// peer's own latest snapshot/state re-applied), so every assertion is about
// the service's own decisions: the status recompute and the timeAdjustment
// folded into the scheduled timeout check.

describe("Unit: StateApplicationService", function () {
    it("applying a snapshot that lists me → PARTICIPATING recomputed from a wrong SYNCED", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        // stage a wrong status so the recompute is observable
        await h.rpcStub.setPeerStatus(0, Status.SYNCED);
        const status = await h.transition.runSetLatestState({
            peerIndex: 0,
            forkId
        });
        expect(status).to.equal(Status.PARTICIPATING);
    });

    it("applying a snapshot that does not list me → SYNCED recomputed from a wrong PARTICIPATING", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;
        const { index: spectatorIndex } = await h.join.addSpectatorWait();

        // stage a wrong status so the recompute is observable
        await h.rpcStub.setPeerStatus(spectatorIndex, Status.PARTICIPATING);
        const status = await h.transition.runSetLatestState({
            peerIndex: spectatorIndex,
            forkId
        });
        expect(status).to.equal(Status.SYNCED);
    });

    it("an older snapshot timestamp shortens the scheduled timeout check by exactly that offset", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const recorder = await h.rpcStub.recordScheduledTasks(0, {
            suppressPrefix: "participantTimeout("
        });
        await h.transition.runSetLatestState({ peerIndex: 0, forkId });
        await h.transition.runSetLatestState({
            peerIndex: 0,
            forkId,
            timestampOffsetSeconds: -500
        });
        const tasks = (await recorder.tasks()).filter((t) =>
            t.taskName.startsWith("participantTimeout(setState)")
        );
        await recorder.restore();

        expect(tasks.length).to.equal(2);
        const shortenedBy = tasks[0].delayMs - tasks[1].delayMs;
        // both applies read the clock within the same couple of seconds
        expect(shortenedBy).to.be.greaterThan(498_000);
        expect(shortenedBy).to.be.lessThan(502_000);
    });

    it("a snapshot timestamp far in the past → the scheduled delay goes negative (unclamped, pinned)", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const recorder = await h.rpcStub.recordScheduledTasks(0, {
            suppressPrefix: "participantTimeout("
        });
        await h.transition.runSetLatestState({
            peerIndex: 0,
            forkId,
            timestampOffsetSeconds: -100_000
        });
        const tasks = (await recorder.tasks()).filter((t) =>
            t.taskName.startsWith("participantTimeout(setState)")
        );
        await recorder.restore();

        expect(tasks.length).to.equal(1);
        // pinned current behavior: the timeAdjustment is folded in unclamped,
        // so a stale snapshot yields a negative delay (fires immediately)
        expect(tasks[0].delayMs).to.be.lessThan(0);
    });

    it("unsafeSetGenesisState stores a height-0 snapshot for the fork and swaps the active fork", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const recorder = await h.rpcStub.recordScheduledTasks(0, {
            suppressPrefix: "participantTimeout("
        });
        const r = await h.execOnHost(
            h.getPeer(0),
            async (sm, args) => {
                const next = sm.storage.blocks.getNextBlockHeight(args.forkId);
                const model =
                    sm.snapshotAssemblyService.getPreviousStateSnapshotOrThrow({
                        forkId: args.forkId,
                        height: next
                    });
                const encodedState =
                    sm.storage.stateMachineStates.getStateMachineState(
                        model.stateMachineStateHash
                    )!;
                // a genesis fork id IS the hash of its snapshot data - derive
                // it the way reduction does
                const newForkId = model.snapshotDataHash;
                await sm.stateApplicationService.unsafeSetGenesisState(
                    model.snapshotData,
                    encodedState,
                    newForkId,
                    Number(model.timestamp)
                );
                const genesis =
                    sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                        newForkId
                    );
                return {
                    activeForkId: String(sm.forkId),
                    newForkId: String(newForkId),
                    previousForkId: String(args.forkId),
                    genesisHeight: genesis ? Number(genesis.blockHeight) : null
                };
            },
            { forkId }
        );
        await recorder.restore();

        expect(r.activeForkId).to.equal(r.newForkId);
        expect(r.activeForkId).to.not.equal(r.previousForkId);
        expect(r.genesisHeight).to.equal(0);
    });
});

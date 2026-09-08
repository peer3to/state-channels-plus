import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("StateManager.isActiveFork", function () {
    it("rejects the current fork after disposal", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const result = await h.execOnHost(h.getPeer(0), async (sm) => {
            const forkId = sm.forkId;
            const before = sm.isActiveFork(forkId);
            await sm.dispose();
            return { before, after: sm.isActiveFork(forkId) };
        });
        expect(result).to.deep.equal({ before: true, after: false });
    });

    it("rejects an older fork after a real reduction", async function () {
        const h = TestSession.getHarness();
        const { sourceForkId } = await h.scenario.stageReducibleDisputedFork();
        await h
            .control(h.getPeer(0))
            .stub.startTryReduce(sourceForkId)
            .request();
        await h.dispute.resolveDisputeWait({ forkId: sourceForkId });
        const result = await h.execOnHost(
            h.getPeer(0),
            (sm, args) => ({
                current: sm.isActiveFork(sm.forkId),
                old: sm.isActiveFork(args.oldFork)
            }),
            { oldFork: sourceForkId }
        );
        expect(result).to.deep.equal({ current: true, old: false });
    });
});

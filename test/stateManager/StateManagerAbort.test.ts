import { expect } from "chai";

import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

describe("StateManager abort", function () {
    it("cancels session-owned timeout work", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);

        const result = await h.execOnHost(
            h.getPeer(0),
            async (sm) => {
                let taskRan = false;
                sm.timeoutManager.scheduleTask(
                    () => {
                        taskRan = true;
                    },
                    100,
                    "StateManagerAbort.test"
                );

                sm.abort();
                await new Promise((resolve) => setTimeout(resolve, 200));
                return {
                    status: sm.status,
                    taskRan,
                    connectedPeerCount: sm.p2pManager.getConnectedPeers().size
                };
            },
            {}
        );

        await h.event.waitForPeers("onAbort", [0], 1);
        expect(result.status).to.equal(Status.OPENED);
        expect(result.taskRan).to.equal(false);
        expect(result.connectedPeerCount).to.equal(0);
    });
});

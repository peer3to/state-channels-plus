import { expect } from "chai";

import { sleep } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

describe("StateManager timeout", function () {
    it("does not submit a timeout when the existing dispute window predates its deadline", async function () {
        const h = TestSession.getHarness();
        const evidenceTime = 8;
        await h.scenario.preDisputeSetup({
            timeConfig: { evidenceTime }
        });
        h.contextApi.markAfkPeer({ afkPeerIndex: 2 });

        // The opener needs its own reason before a dispute window exists.
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        await h.tamper.postTamperedDispute(0, () => {}, {
            markMalicious: false
        });
        await h.assert.dispute.committedWait({
            peersIndices: [0],
            expectedCount: 1
        });

        await sleep((evidenceTime - 1) * 1000);
        const timeout = await h
            .control(h.getPeer(1))
            .query.getTimeout(h.activeForkId!)
            .request();

        expect(timeout).to.equal(null);
    });
});

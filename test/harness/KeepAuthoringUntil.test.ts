// @spec-test-coverage-ignore: harness helper contract test; the helper is test infrastructure with no specification or implementation IDs
import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

describe("keepAuthoringUntil helper", function () {
    it("ends in its diagnostic when the next writer stays excluded", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const next = await h.query.getNextPeerToWrite();
        let failure: unknown;
        try {
            // The excluded writer never exits, so no block can ever be
            // authored; the bound must still end the wait.
            await h.transition.keepAuthoringUntil({
                until: () => false,
                waitForPeers: [0, 1, 2],
                excludePeerIndices: [next.index],
                maximumBlocks: 2
            });
            expect.fail("the bound must fire");
        } catch (error) {
            failure = error;
        }
        const message = (failure as Error).message;
        expect(message).to.include(
            "Condition not met within 2 keep-alive windows"
        );
        expect(message).to.include("0 authored, 2 waiting");
        expect(message).to.match(/peer 0: [A-Z_]+ at height \d+/);
    });

    it("ends in its diagnostic when no host confirms the next writer's turn", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        // Every host denies its turn, so the next-writer answer is never
        // confirmed and no block can be written; the waiting windows must
        // still reach the bound.
        await Promise.all(
            h.peers.map((peer) => h.control(peer).stub.stubDenyTurn().request())
        );
        let failure: unknown;
        try {
            await h.transition.keepAuthoringUntil({
                until: () => false,
                waitForPeers: [0, 1, 2],
                maximumBlocks: 2
            });
            expect.fail("the bound must fire");
        } catch (error) {
            failure = error;
        } finally {
            await Promise.all(
                h.peers.map((peer) =>
                    h.control(peer).stub.restoreDenyTurn().request()
                )
            );
        }
        const message = (failure as Error).message;
        expect(message).to.include("0 authored, 2 waiting");
        expect(message).to.match(/peer 0: [A-Z_]+ at height \d+/);
    });

    it("counts authored blocks toward the same bound", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        let failure: unknown;
        try {
            await h.transition.keepAuthoringUntil({
                until: () => false,
                waitForPeers: [0, 1, 2],
                maximumBlocks: 2
            });
            expect.fail("the bound must fire");
        } catch (error) {
            failure = error;
        }
        expect((failure as Error).message).to.include("2 authored, 0 waiting");
    });
});

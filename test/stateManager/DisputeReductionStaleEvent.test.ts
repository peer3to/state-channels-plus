import { expect } from "chai";

import { MathTestSession as TestSession } from "@test/harness";

/**
 * Race regression: a DisputeReducedResultCommitted chain event can be
 * DELIVERED AGAIN after local dispute state moved on (the reduction was
 * consumed and the fork windows pruned). The handler used to pass the
 * resulting EMPTY dispute set to the Solidity reducer, which reverts with
 * ErrorNoDisputesProvided and surfaced as a fatal detached error at teardown.
 * The handler must treat such an event as already processed.
 *
 * Staging: run a REAL dispute + reduction (the four-peer scenario), capture
 * the REAL committed-reduction event arguments from the mirrored
 * EventHandler notification, let the peers consume the reduction, then
 * redeliver the exact same event through the real handler entry — the same
 * shape a delayed chain-event delivery produces.
 */
describe("Dispute reduction stale event", function () {
    it("treats a redelivered reduced-result event as consumed after the reduction was applied", async function () {
        this.timeout(240000);
        const h = TestSession.getHarness();

        await h.scenario.fourPeersDisputeResolutionAndSnapshotUpdateDetached();
        // The reduction commits DETACHED after the scenario returns: wait for
        // the real chain event to reach ANY peer's mirrored handler (the
        // scenario picks the malicious peer dynamically, so no fixed index is
        // safe). The harness spies record every delivery since peer creation.
        const findObserverIndex = () =>
            h.peers.findIndex(
                (peer) =>
                    (peer.eventSpies.onDisputeReducedResultCommitted
                        ?.callCount ?? 0) > 0
            );
        const deadline = Date.now() + 60000;
        while (findObserverIndex() < 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const observerIndex = findObserverIndex();
        expect(
            observerIndex,
            "no peer observed a committed-reduction event"
        ).to.be.greaterThanOrEqual(0);
        await h.transition.fromHonestPeersOnly((c) => c.add(1));
        await h.assert.sync.onlyHonestPeersInSync();

        const eventArgs =
            h.getPeer(observerIndex).eventSpies.onDisputeReducedResultCommitted
                ?.firstCall?.args;
        expect(
            eventArgs,
            "no committed-reduction event was observed"
        ).to.not.equal(undefined);

        const result = await h.execOnHost(
            h.getPeer(observerIndex),
            async (sm, args) => {
                let errorMessage = "";
                try {
                    await (
                        sm.eventHandler.onDisputeReducedResultCommitted as (
                            ...handlerArgs: unknown[]
                        ) => Promise<void>
                    )(...(args.eventArgs as unknown[]));
                } catch (error) {
                    errorMessage =
                        error instanceof Error ? error.message : String(error);
                }
                return { errorMessage, forkId: String(sm.forkId) };
            },
            { eventArgs },
            { timeoutMs: 60000 }
        );

        // No ErrorNoDisputesProvided revert, no fatal error, fork unchanged.
        expect(result.errorMessage).to.equal("");
        const forkAfter = await h.execOnHost(
            h.getPeer(observerIndex),
            (sm) => String(sm.forkId),
            {},
            { timeoutMs: 30000 }
        );
        expect(forkAfter).to.equal(result.forkId);
    });
});

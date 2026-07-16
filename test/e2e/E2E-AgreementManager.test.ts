import { MathTestSession as TestSession } from "@test/harness";

/**
 * E2E Tests for the dispute-storage race condition.
 *
 * Maps to: src/agreementManager/AgreementManager.ts (getForkDisputes)
 *          src/stateManager/StateManager.ts (reduceLocally / performLocalReduction,
 *                                            tryReduce, prepareUpdateStateSnapshotFork)
 *
 * A dispute commitment lands on-chain before our onDisputeCommitted handler
 * stores the struct locally. Any code reading the window then sees the on-chain
 * commitment but no local struct ("Missing Dispute in storage"). Both readers
 * must treat this as "nothing to do yet" and wait for the struct, not throw:
 *  - reduceLocally (via getForkDisputes) discards — else the fire-and-forget
 *    tryReduce path leaks an unhandled rejection.
 *  - prepareUpdateStateSnapshotFork (via postStateSnapshot on the exit path)
 *    stops traversal — else the exit snapshot post throws.
 */

/**
 * Drive four peers to a committed, kill-period-expired dispute in which no peer
 * ever stored the dispute struct locally: no-op storeDisputeConfirmation (the
 * only writer of the struct map) on every peer before the dispute, so the
 * commitment lands on-chain but the struct never does — and, since no struct
 * means no reduction, every peer stays on the disputed fork (deterministic).
 * Returns an honest observer to exercise the window readers on.
 */
async function setupPartialDisputeWindow() {
    const h = TestSession.getHarness();

    // Short evidence window so the on-chain kill period expires quickly.
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 6 }
    });

    // Reproduce the race on every peer: no-op the ONLY writer of the
    // dispute-struct map (EventHandler.onDisputeCommitted ->
    // storage.disputes.storeDisputeConfirmation). The on-chain commitment still
    // lands, but no peer ever stores the struct — so no peer reduces and there
    // is no reduced fork to adopt (keeps the scenario deterministic).
    await Promise.all(
        h.peers.map((peer) =>
            h.execOnHost(peer, (sm) => {
                sm.storage.disputes.storeDisputeConfirmation = () =>
                    "0x0000000000000000000000000000000000000000000000000000000000000000";
                return true;
            })
        )
    );

    // Malicious peer authors an invalid block; the honest peers dispute it and
    // commit on-chain.
    const malicious = await h.query.getNextPeerToWrite();
    await h.byzantine.submitInvalidStateTransitionBlock(malicious.index);

    // An honest observer processes the on-chain commitment (its struct write is
    // a no-op), so its dispute window holds a commitment with no local struct.
    const observer = h.peers.find((p) => p.index !== malicious.index)!;
    await h.event.waitForPeers("onDisputeCommitted", [observer.index], 1, {
        mode: "atLeast",
        timeoutMs: 20000
    });

    // Wait for the on-chain kill period to expire. Poll at the test level with
    // fast host calls — a single scenario.exec RPC must stay under its 2s
    // timeout, so the wait can't live inside one exec body.
    const killDeadline = Date.now() + 60000;
    let killExpired = false;
    while (Date.now() < killDeadline) {
        killExpired = await h.execOnHost(observer, async (sm) => {
            const { isExpired } =
                await sm.stateChannelManagerContract.isKillPeriodExpired(
                    sm.channelId,
                    sm.forkId
                );
            return isExpired;
        });
        if (killExpired) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!killExpired) {
        throw new Error("kill period did not expire within timeout");
    }

    return { h, observer };
}

describe("E2E: Agreement Manager", function () {
    it("partial dispute window (commitment on-chain, struct not yet stored) → reduceLocally discards, not throws", async function () {
        this.timeout(90000);
        const { h, observer } = await setupPartialDisputeWindow();

        // reduceLocally reaches getForkDisputes -> "Missing Dispute in storage"
        // and must discard (return undefined), not throw.
        const result = await h.execOnHost(observer, async (sm) => {
            const forkId = sm.forkId;

            // Confirm the scenario is genuine: an on-chain commitment exists but
            // its struct is absent locally (getForkDisputes would throw).
            const commitments = Array.from(
                await sm.stateChannelManagerContract.getWindowCommitments(
                    sm.channelId,
                    forkId
                )
            );
            const anyStructPresent = commitments.some(
                (commitment) =>
                    sm.storage.disputes.getDispute(commitment) !== undefined
            );

            let threw = false;
            let discarded = false;
            let message = "";
            try {
                const reduction = await sm.reduceLocally(forkId);
                discarded = reduction === undefined;
            } catch (error) {
                threw = true;
                message =
                    error instanceof Error ? error.message : String(error);
            }

            return {
                commitmentCount: commitments.length,
                anyStructPresent,
                threw,
                discarded,
                message
            };
        });

        // The reproduction must be genuine, or the assertion below is vacuous.
        if (result.commitmentCount === 0) {
            throw new Error(
                "expected at least one on-chain dispute commitment"
            );
        }
        if (result.anyStructPresent) {
            throw new Error(
                "expected the dispute struct to be absent from local storage"
            );
        }

        // The fix: reduceLocally must discard the not-yet-stored dispute rather
        // than throwing (which the fire-and-forget tryReduce path would leak).
        if (result.threw) {
            throw new Error(
                `reduceLocally threw instead of discarding: ${result.message}`
            );
        }
        if (!result.discarded) {
            throw new Error(
                "reduceLocally did not discard (expected undefined return)"
            );
        }
    });

    it("partial dispute window (commitment on-chain, struct not yet stored) → prepareUpdateStateSnapshotFork stops traversal, not throws", async function () {
        this.timeout(90000);
        const { h, observer } = await setupPartialDisputeWindow();

        // prepareUpdateStateSnapshotFork (reached via postStateSnapshot on the
        // exit path) traverses the disputed fork and reads the same window. With
        // a commitment on-chain but no local struct it must stop traversal and
        // wait for more data, not throw. The observer stayed on the disputed
        // fork (no reduction happened), so sm.forkId is the on-chain fork the
        // traversal starts from.
        const result = await h.execOnHost(observer, async (sm) => {
            const forkId = sm.forkId;
            const isDisputed =
                await sm.stateChannelManagerContract.isForkDisputed(
                    sm.channelId,
                    forkId
                );
            const commitments = Array.from(
                await sm.stateChannelManagerContract.getWindowCommitments(
                    sm.channelId,
                    forkId
                )
            );
            const anyStructPresent = commitments.some(
                (commitment) =>
                    sm.storage.disputes.getDispute(commitment) !== undefined
            );

            let threw = false;
            let message = "";
            try {
                await sm.prepareUpdateStateSnapshotFork();
            } catch (error) {
                threw = true;
                message =
                    error instanceof Error ? error.message : String(error);
            }

            return {
                isDisputed,
                commitmentCount: commitments.length,
                anyStructPresent,
                threw,
                message
            };
        });

        // The reproduction must be genuine: the fork is disputed with a
        // commitment whose struct is absent locally (else the traversal never
        // reaches the struct read).
        if (!result.isDisputed) {
            throw new Error("expected the fork to be disputed on-chain");
        }
        if (result.commitmentCount === 0) {
            throw new Error(
                "expected at least one on-chain dispute commitment"
            );
        }
        if (result.anyStructPresent) {
            throw new Error(
                "expected the dispute struct to be absent from local storage"
            );
        }

        // The fix: prepareUpdateStateSnapshotFork must stop traversal on the
        // not-yet-stored dispute rather than throwing "Missing Dispute in
        // storage" out of the exit-path postStateSnapshot caller.
        if (result.threw) {
            throw new Error(
                `prepareUpdateStateSnapshotFork threw instead of stopping traversal: ${result.message}`
            );
        }
    });
});

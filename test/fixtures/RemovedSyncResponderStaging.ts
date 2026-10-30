// @spec-test-coverage-ignore: shared staging for the removed-sync-responder recovery case
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeIsClosed } from "./RuntimeRootObservation";
import { Status } from "@/types";
import { ForkId } from "@/types/types";
import { addressesEqual } from "@/utils";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * A self-removed peer the held chain snapshot still lists answers a new
 * observer's initial sync with the successor genesis only, while the
 * survivors have advanced; the observer then reaches the survivors' state.
 */
export async function assertObserverRecoversFromRemovedResponder(
    h: MathPeerTestHarness
): Promise<void> {
    const staging = await stageObserverSyncedFromRemovedResponder(h);
    const { observer, survivors, newForkId, channelId } = staging;
    try {
        await h.network.joinSelectedKey(survivors, channelId);
        // survivors keep authoring -> an idle slot would time out the next
        // writer and open a second dispute on the reduced fork
        const heightOf = async (index: number) =>
            Number(
                (await h
                    .control(h.getPeer(index))
                    .query.getLatestBlockHeight(newForkId)
                    .request()) ?? -1
            );
        await h.transition.keepAuthoringUntil({
            until: async () =>
                (await heightOf(observer.index)) > 0 &&
                (await heightOf(observer.index)) ===
                    (await heightOf(survivors[0]!)),
            waitForPeers: survivors,
            maximumBlocks: 10
        });
        await assertObserverCaughtUp(
            h,
            { ...staging, observerIndex: observer.index },
            newForkId
        );
    } finally {
        await staging.releaseReductionHolds();
    }
}

/**
 * The same genesis-only observer, but the survivors stay idle: the next
 * writer times out and the survivors dispute the reduced fork, whose window
 * reduces to a head the observer never received. The observer, a
 * non-participant, aborts cleanly at its reduction; nobody blacklists it and
 * the survivors resolve the dispute.
 */
export async function assertBehindObserverAbortsOnIdleDispute(
    h: MathPeerTestHarness
): Promise<void> {
    const staging = await stageObserverSyncedFromRemovedResponder(h);
    const { observer, survivors, newForkId, channelId } = staging;
    const observerHeight = Number(
        (await h
            .control(observer)
            .query.getLatestBlockHeight(newForkId)
            .request()) ?? -1
    );
    let released = false;
    try {
        // the reduced fork's reduction must land this time
        await staging.releaseReductionHolds();
        released = true;
        h.event.resetEventSpies();
        await h.network.joinSelectedKey(survivors, channelId);

        // nobody authors -> the next writer times out on the reduced fork
        await h.assert.dispute.committedWait({
            peersIndices: survivors,
            expectedCount: 1
        });
        // premise - the window reduces to a head the observer never received
        expect(
            await h.query.reducedHeadHeight(newForkId, survivors[0]!)
        ).to.be.greaterThan(observerHeight);

        await waitFor(
            () => runtimeIsClosed(observer.p2pInstance),
            h.event.protocolEventTimeoutMs() * 2
        );
        await h.dispute.resolveDisputeWait({
            forkId: newForkId,
            honestPeerIndices: survivors,
            assertMaliciousRemoved: false
        });
        for (const index of survivors) {
            expect(
                await h
                    .control(h.getPeer(index))
                    .query.isBlacklisted(observer.address)
                    .request(),
                `peer ${index} blacklisted the observer`
            ).to.equal(false);
        }
    } finally {
        if (!released) await staging.releaseReductionHolds();
    }
}

/**
 * Self-removes peer 0 without a reduction or snapshot post, isolates it from
 * the survivors, lets the survivors advance on the reduced fork, then syncs a
 * new observer from the leaver only: it holds the reduced fork's genesis
 * while the survivors are ahead. The survivors stay off the channel key and
 * every peer's reduction submit stays held until `releaseReductionHolds`.
 */
async function stageObserverSyncedFromRemovedResponder(h: MathPeerTestHarness) {
    await h.lifecycle.start(4, 0, {
        timeConfig: {
            p2pTime: 5,
            agreementTime: 2,
            chainFallbackTime: 2,
            evidenceTime: 4
        }
    });
    const leaverIndex = 0;
    const survivors = [1, 2, 3];
    const leaver = h.getPeer(leaverIndex);
    const forkId = h.activeForkId!;
    const channelId = h.channelId!.toString();

    // nobody posts the reduction or a snapshot -> the chain snapshot stays on
    // the old fork, which still lists the leaver
    const reductionHolds = await Promise.all(
        [leaverIndex, ...survivors].map((peerIndex) =>
            h.rpcStub.holdReductionAttempt(peerIndex, "submit")
        )
    );
    const releaseReductionHolds = async () => {
        await Promise.all(reductionHolds.map((hold) => hold.release()));
    };
    try {
        await h.dispute.selfRemoveViaDisputeWait({ leaverIndex });
        // the leaver stays reachable for newcomers but no longer hears the
        // survivors -> it keeps the successor genesis while they advance
        await h.network.blacklistAndDisconnectPeer(leaverIndex);
        const { newForkId } = await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: survivors,
            assertMaliciousRemoved: false
        });
        // the leaver installs the successor genesis on its own; until then its
        // next-writer answer is the old fork's and the harness could pick it
        await waitFor(
            async () => (await h.peerForkIds([leaver]))[0] === newForkId,
            h.event.protocolEventTimeoutMs()
        );
        await h.transition.advanceState({ count: 2, waitForPeers: survivors });
        expect(
            await h.scenario.finalizeReductionOnChainOnly(1, forkId)
        ).to.equal(true);
        // removed without a slash -> the chain still accepts the leaver as a
        // sync responder
        expect(
            await h.channelManager.canParticipateInDisputes(
                h.channelId!,
                leaver.address
            )
        ).to.equal(true);

        const { peer: observer } = await h.join.addSpectatorAuthoring({
            beforeConnect: async (peer) => {
                // the leaver is the only peer the observer can reach first
                for (const index of survivors) {
                    await h
                        .control(h.getPeer(index))
                        .network.leaveSelectedKey(channelId)
                        .request();
                }
                await h
                    .control(peer)
                    .stub.recordSyncReductionWindows()
                    .request();
            },
            authoringPeerIndices: survivors,
            minimumBlocks: 1,
            maximumBlocks: 20
        });
        const syncs = await h
            .control(observer)
            .stub.getSyncReductionWindows()
            .request();
        const initial = syncs[0]!;
        expect(addressesEqual(initial.responder, leaver.address)).to.equal(
            true
        );
        expect(initial.synced).to.equal(true);
        expect(initial.latestForkId).to.equal(newForkId);
        expect(initial.milestoneCount).to.equal(0);
        expect(
            Number(
                await h
                    .control(h.getPeer(survivors[0]!))
                    .query.getLatestBlockHeight(newForkId)
                    .request()
            )
        ).to.be.greaterThan(0);
        return {
            leaverIndex,
            survivors,
            observer,
            newForkId,
            channelId,
            releaseReductionHolds
        };
    } catch (error) {
        await releaseReductionHolds();
        throw error;
    }
}

/**
 * The observer stays up, SYNCED, in sync with the survivors and unblacklisted,
 * and a later sync a survivor answered carried `latestForkId`.
 */
async function assertObserverCaughtUp(
    h: MathPeerTestHarness,
    staging: {
        observerIndex: number;
        survivors: number[];
        leaverIndex: number;
    },
    latestForkId: ForkId
): Promise<void> {
    const { survivors, leaverIndex } = staging;
    const observer = h.getPeer(staging.observerIndex);
    await h.assert.sync.peersInSyncWait({
        peerIndices: [...survivors, observer.index]
    });
    const syncsAfter = await h
        .control(observer)
        .stub.getSyncReductionWindows()
        .request();
    await h.control(observer).stub.restoreSyncReductionWindows().request();

    expect(runtimeIsClosed(observer.p2pInstance)).to.equal(false);
    expect(await h.control(observer).query.getStatus().request()).to.equal(
        Status.SYNCED
    );
    for (const index of [leaverIndex, ...survivors]) {
        // the leaver-survivor pairs stay isolated by the staging above
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(h.getPeer(index).address)
                .request(),
            `observer blacklisted peer ${index}`
        ).to.equal(false);
        expect(
            await h
                .control(h.getPeer(index))
                .query.isBlacklisted(observer.address)
                .request(),
            `peer ${index} blacklisted the observer`
        ).to.equal(false);
    }
    expect(syncsAfter.every((entry) => entry.synced)).to.equal(true);
    // the catch-up is a later sync a survivor answered on the latest fork
    const catchUp = syncsAfter.slice(1);
    expect(
        catchUp.some(
            (entry) =>
                entry.latestForkId === latestForkId &&
                survivors.some((index) =>
                    addressesEqual(entry.responder, h.getPeer(index).address)
                )
        ),
        JSON.stringify(syncsAfter)
    ).to.equal(true);
}

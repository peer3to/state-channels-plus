// @spec-test-coverage-ignore: offline-auditor staging shared by dispute commit and reduction tests
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { readMathPeer } from "./OffChainPromotionFixture";
import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { waitFor } from "@test/utils/waitFor";

/**
 * Four peers on the calldata path. One peer (never the next writer) is cut
 * off with its dispute commits and subscribed block-calldata logs held and
 * its own disputes suppressed; the others author a block it never sees (nor
 * its posted calldata), then peer 1 double-signs and a
 * connected peer disputes: the dispute's head is above the offline peer's
 * head. Reductions are held by `holdReductions`: `"everyPeer"` holds every
 * peer's `reduction-*` tasks, so the fork stays current everywhere;
 * `"connectedPeers"` holds every reduction entry point of the connected peers
 * (`connectedRaces`), so the offline peer is the only reducer. Resolves once
 * the dispute is initiated. `headState` reads the head's state on the offline
 * peer (null while it misses it); `waitUntilKillPeriodExpired` resolves once
 * the dispute's kill period expired; `honestIndices` are the connected peers
 * but the double signer.
 */
export async function stageAuditorOfflineThroughKillPeriod(
    h: MathPeerTestHarness,
    holdReductions: "everyPeer" | "connectedPeers"
) {
    await h.scenario.preDisputeSetupCalldataPath({
        timeConfig: { evidenceTime: 3 }
    });
    const forkId = h.activeForkId!;
    const nextPeer = await h.query.getNextPeerToWrite();
    // the next writer stays connected so the missed block is authored
    const offlineIndex = [2, 3, 0].find((index) => index !== nextPeer.index)!;
    const connected = h.peers
        .map((peer) => peer.index)
        .filter((index) => index !== offlineIndex);
    const connectedRaces = [];
    if (holdReductions === "everyPeer") {
        for (const peer of h.peers)
            await h.control(peer).stub.stubHoldReductionTasks().request();
    } else {
        for (const index of connected)
            connectedRaces.push(await h.rpcStub.holdReductionRace(index));
    }
    const restoreCommits = await h.rpcStub.holdDisputeCommittedEvents(
        offlineIndex,
        { passFirst: false }
    );
    // the author posts the block the offline peer never signs as calldata
    await h
        .control(h.getPeer(offlineIndex))
        .stub.stubHoldCalldataPostedEvents()
        .request();
    await h.dispute.suppressDisputeInitiation([offlineIndex]);
    await h.network.blacklistAndDisconnectPeer(offlineIndex);
    await h.transition.advanceState({ waitForPeers: connected });
    const doubleSignerIndex = 1;
    await h.byzantine.submitDoubleSignBlock(doubleSignerIndex);
    await h.event.waitForDisputeFromAnyPeer(connected);
    const initiating = connected
        .map((index) => h.getPeer(index))
        .find(
            (peer) => (peer.eventSpies.onInitiatingDispute?.callCount ?? 0) > 0
        )!;
    const dispute = initiating.eventSpies.onInitiatingDispute!.lastCall.args[1];
    const head = await readMathPeer(h, initiating.index);
    const offline = h.control(h.getPeer(offlineIndex)).query;
    const headState = async () => {
        const snapshot = await offline
            .getStateSnapshotStructByHash(
                dispute.input.latestStateSnapshotHash as Hash
            )
            .request();
        return (
            snapshot &&
            (await offline
                .getStateMachineState(
                    Codec.decode(snapshot.encodedSnapshot, Type.StateSnapshot)
                        .snapshotData.stateMachineStateHash as Hash
                )
                .request())
        );
    };
    const waitUntilKillPeriodExpired = () =>
        waitFor(
            async () =>
                (await h.query.killPeriod(forkId, initiating.index)).isExpired,
            h.event.protocolEventTimeoutMs()
        );
    return {
        forkId,
        offlineIndex,
        honestIndices: connected.filter((index) => index !== doubleSignerIndex),
        connectedRaces,
        restoreCommits,
        headState,
        waitUntilKillPeriodExpired,
        headSum: head.state.number
    };
}

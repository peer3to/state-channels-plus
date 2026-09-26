// @spec-test-coverage-ignore: covered self-removal staging for mapped leave cases
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types/types";
import { Codec, sleep, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/** Forks of the self-removal disputes among recorded submissions. */
function selfRemovalForks(
    submissions: { encodedDispute: string | null }[]
): string[] {
    return submissions
        .filter(
            (submission) =>
                !!submission.encodedDispute &&
                submission.encodedDispute !== "0x"
        )
        .map(
            (submission) =>
                Codec.decode(submission.encodedDispute!, Type.Dispute).input
        )
        .filter((input) => input.selfRemoval)
        .map((input) => String(input.forkId));
}

/**
 * Park the leaver's uploads until the covering window's evidence period has
 * closed on chain, then send them for real. Every refusal the leaver then gets
 * is the contract's own `RaceConditionDisputeEvidencePeriodExpired`: the race
 * is lost to a real window, not to a staged revert.
 */
async function releaseAfterEvidencePeriod(
    h: MathPeerTestHarness,
    forkId: ForkId,
    held: { release: () => Promise<void>; restore: () => Promise<void> }
) {
    await waitFor(() => h.channelManager.isForkDisputed(h.channelId, forkId));
    await sleep(h.event.evidencePeriodWaitMs(1));
    await held.release();
}

/**
 * Two participants leave. The first one's self-removal opens the window that
 * covers the fork; the second one's reaches the chain only after that window
 * stopped taking evidence and loses the race. The second leave waits for the
 * window to settle, then retries its self-removal once on the fork the
 * settlement produced.
 *
 * `before-settlement`: the second leave starts once the evidence period has
 * closed, with every reduction held, so its self-removal is its only upload and
 * the refusal comes back while the window is still unsettled. The leave must
 * wait for it.
 * `after-settlement`: both leave together and the second one's upload stays
 * parked until the settlement has re-armed the leave on the new fork, so the
 * refusal belongs to a fork the leave already left and must not decide it.
 */
export async function assertLeaveAwaitsCoveringWindowThenRetries(
    refusalLands: "before-settlement" | "after-settlement"
) {
    const h = TestSession.getHarness();
    await h.lifecycle.start(4, 0, {
        timeConfig: { evidenceTime: 4 },
        configOverrides: { LEAVE_CHANNEL_WATCHDOG_MS: 50 }
    });
    const first = h.getPeer(0);
    const leaver = h.getPeer(1);
    const forkId = h.activeForkId!;
    const beforeSettlement = refusalLands === "before-settlement";
    if (beforeSettlement) {
        for (const peer of h.peers)
            await h.control(peer).stub.stubHoldReductionTasks().request();
    }
    const recorder = await h.rpcStub.recordDisputeSubmissions(leaver.index, {
        hold: !beforeSettlement,
        forward: true
    });
    let released = beforeSettlement;
    const firstLeave = first.p2pInstance.leaveChannel().then(
        () => null,
        (error) => String(error)
    );
    try {
        let outcome: Promise<string | null>;
        if (beforeSettlement) {
            await waitFor(() =>
                h.channelManager.isForkDisputed(h.channelId, forkId)
            );
            await sleep(h.event.evidencePeriodWaitMs(1));
            outcome = leaver.p2pInstance.leaveChannel().then(
                () => null,
                (error) => String(error)
            );
            await h.event.waitUntilLeavePhase(
                leaver.index,
                "awaiting-settlement"
            );
            expect(selfRemovalForks(await recorder.submissions())).to.include(
                String(forkId)
            );
            for (const peer of h.peers)
                await h
                    .control(peer)
                    .stub.restoreReductionTasks(true)
                    .request();
        } else {
            outcome = leaver.p2pInstance.leaveChannel().then(
                () => null,
                (error) => String(error)
            );
            await h.event.waitUntilLeavePhase(leaver.index, "disputing");
            await waitFor(
                async () =>
                    String(
                        (
                            await h
                                .control(leaver)
                                .query.getLeaveChannelState()
                                .request()
                        )?.forkId
                    ) !== String(forkId)
            );
            await recorder.release();
            released = true;
        }

        // The recorder forwards every upload for real, so the retry on the
        // settled fork lands and is recorded here too.
        await waitFor(async () =>
            selfRemovalForks(await recorder.submissions()).some(
                (retriedFork) => retriedFork !== String(forkId)
            )
        );
        const retriedForks = selfRemovalForks(
            await recorder.submissions()
        ).filter((retriedFork) => retriedFork !== String(forkId));

        expect({
            first: await firstLeave,
            leave: await outcome,
            retriedForks: retriedForks.length
        }).to.deep.equal({
            first: null,
            leave: null,
            retriedForks: 1
        });
        const participants = await h.channelManager.getParticipants(
            h.channelId
        );
        expect(participants).to.not.include(leaver.address);
        expect(participants).to.not.include(first.address);
    } finally {
        if (!released) await recorder.release();
    }
}

/**
 * The authored exit's fallback loses its self-removal race to a window another
 * participant's voluntary self-removal opened on the fork. The leave waits for
 * that window instead of failing, and completes on the fork its settlement
 * produces.
 */
export async function assertAuthoredLeaveAwaitsCoveringWindow() {
    const h = TestSession.getHarness();
    // agreementTime outlasts the evidence period, so the authored exit's
    // fallback runs after the covering window has stopped taking evidence.
    await h.lifecycle.start(4, 0, {
        timeConfig: { agreementTime: 8, evidenceTime: 4 }
    });
    const coverer = h.getPeer(0);
    const leaver = h.getPeer(1);
    const forkId = h.activeForkId!;
    // The authored exit's snapshot post fails, so its fallback is the
    // self-removal dispute; the window stays unsettled until the assertions ran.
    await h.control(leaver).stub.failPostStateSnapshotWait().request();
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
    let authored: Promise<unknown> | undefined;
    leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
        authored = leaver.p2pInstance.p2pContractInstance.leaveChannel();
    });
    const outcome = leaver.p2pInstance.leaveChannel().then(
        () => null,
        (error) => String(error)
    );
    const held = await h.rpcStub.recordDisputeSubmissions(leaver.index, {
        hold: true,
        forward: true
    });
    let released = false;
    try {
        await h.transition.advanceState({ waitForSync: false });
        await h.event.waitForPeers("onLeaveTurn", [leaver.index], 1);
        await authored;
        await h.event.waitUntilLeavePhase(leaver.index, "exit-authored");

        await h.execOnHost(
            coverer,
            async (sm, args) => {
                await sm.membershipService.startSelfRemovalDispute(args.forkId);
            },
            { forkId }
        );
        await releaseAfterEvidencePeriod(h, forkId, held);
        released = true;
        await h.event.waitUntilLeavePhase(leaver.index, "awaiting-settlement");
        expect(selfRemovalForks(await held.submissions())).to.include(
            String(forkId)
        );

        for (const peer of h.peers)
            await h.control(peer).stub.restoreReductionTasks(true).request();
        expect(await outcome).to.equal(null);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(leaver.address);
    } finally {
        if (!released) await held.release();
    }
}

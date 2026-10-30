// @spec-test-coverage-ignore: shared staging for a lone participant's leave that falls back to its self-removal dispute
import { exitOnLeaveTurn } from "@test/fixtures/BotConnectionFixesStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { expect } from "chai";

/**
 * Two founders open the channel. Founder 0 leaves with its exit block, and
 * its posted exit leaves founder 1 as the lone participant. Founder 1 then
 * leaves and never sends its exit, so its leave falls back to the
 * self-removal dispute: its leave watchdog is held, and `expireWatchdog`
 * runs it as its expiry does.
 */
export async function stageLoneLeaverSelfRemoval(h: MathPeerTestHarness) {
    await h.lifecycle.start(2, 0);
    const first = h.getPeer(0);
    const lone = h.getPeer(1);
    const firstExit = exitOnLeaveTurn(first);
    await first.p2pInstance.p2pSigner.leaveChannel();
    await h.transition.keepAuthoringUntil({
        until: () => firstExit() !== undefined,
        waitForPeers: [first.index, lone.index],
        maximumBlocks: 6
    });
    await firstExit();
    await h.event.waitUntilLeftChannel(first.index);
    expect(await h.channelManager.getParticipants(h.channelId)).to.deep.equal([
        lone.address
    ]);

    const watchdog = await h.rpcStub.holdScheduledTasks(
        lone.index,
        "channel leave watchdog"
    );
    await lone.p2pInstance.p2pSigner.leaveChannel();
    return {
        lone,
        expireWatchdog: async () => {
            expect(await watchdog.heldCount()).to.equal(1);
            await watchdog.release(true);
        }
    };
}
